'use strict';

const { randomBytes, createHash } = require('node:crypto');
const { getAddress, verifyMessage } = require('ethers');

const CHALLENGE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_CHALLENGES = 1000;
const MAX_SESSIONS = 1000;

class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);

// EOA personal_sign only. Message layout follows https://eips.ethereum.org/EIPS/eip-4361.
// The HTTP layer must enforce its configured origin and protect session cookies.
class Auth {
  #challenges = new Map();
  #sessions = new Map();

  constructor({ origin, chainId = 4663, now = Date.now, demoEnabled = true }) {
    let url;
    try { url = new URL(origin); } catch { throw new Error('An HTTP or HTTPS authentication origin is required'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Authentication origin must contain only scheme, host, and port');
    }
    if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('Authentication chain ID must be a positive integer');
    if (typeof now !== 'function') throw new Error('Authentication clock must be a function');
    this.origin = url.origin;
    this.chainId = chainId;
    this.now = now;
    this.demoEnabled = demoEnabled === true;
  }

  #cleanup() {
    const now = this.now();
    for (const [nonce, item] of this.#challenges) if (item.expiresAt <= now) this.#challenges.delete(nonce);
    for (const [hash, item] of this.#sessions) if (item.expiresAt <= now) this.#sessions.delete(hash);
    return now;
  }

  challenge(address) {
    const now = this.#cleanup();
    let canonical;
    try {
      if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error();
      canonical = getAddress(address);
    } catch { throw new AuthError(400, 'ADDRESS_INVALID', 'Enter a valid Ethereum wallet address'); }
    if (this.#challenges.size >= MAX_CHALLENGES) {
      throw new AuthError(429, 'AUTH_CAPACITY', 'Too many sign-in requests; try again shortly');
    }
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = now + CHALLENGE_TTL;
    const message = [
      `${this.origin} wants you to sign in with your Ethereum account:`,
      canonical,
      '',
      'Sign in to the VPN preview for up to 8 hours. This does not authorize a payment.',
      '',
      `URI: ${this.origin}`,
      'Version: 1',
      `Chain ID: ${this.chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`
    ].join('\n');
    this.#challenges.set(nonce, { address: canonical, message, expiresAt });
    return { nonce, message };
  }

  verify(input = {}) {
    this.#cleanup();
    const { nonce, signature } = input || {};
    const challenge = typeof nonce === 'string' && /^[a-f0-9]{32}$/.test(nonce) && this.#challenges.get(nonce);
    // Consume before all verification, including malformed or incorrect signatures.
    if (challenge) this.#challenges.delete(nonce);
    if (!challenge) throw new AuthError(401, 'CHALLENGE_INVALID', 'Sign-in request expired or was already used; request another');
    let address;
    try {
      if (typeof signature !== 'string' || !/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/.test(signature)) throw new Error();
      address = verifyMessage(challenge.message, signature);
    } catch { throw new AuthError(401, 'SIGNATURE_INVALID', 'Wallet signature could not be verified'); }
    if (address !== challenge.address) throw new AuthError(401, 'SIGNATURE_INVALID', 'Wallet signature could not be verified');
    return this.#issue({ address: challenge.address, kind: 'wallet' });
  }

  #issue(session) {
    const now = this.#cleanup();
    if (this.#sessions.size >= MAX_SESSIONS) {
      throw new AuthError(429, 'AUTH_CAPACITY', 'Sign-in is temporarily at capacity; try again shortly');
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + SESSION_TTL;
    this.#sessions.set(tokenHash(token), { session: { ...session }, expiresAt });
    return { token, session: { ...session }, expiresAt };
  }

  demo() {
    if (!this.demoEnabled) throw new AuthError(403, 'DEMO_DISABLED', 'Demo sign-in is disabled');
    return this.#issue({ address: `demo:${randomBytes(16).toString('hex')}`, kind: 'demo' });
  }

  session(token) {
    this.#cleanup();
    if (!validToken(token)) return null;
    const item = this.#sessions.get(tokenHash(token));
    return item ? { ...item.session } : null;
  }

  logout(token) {
    this.#cleanup();
    if (validToken(token)) this.#sessions.delete(tokenHash(token));
  }
}

module.exports = { Auth, AuthError };
