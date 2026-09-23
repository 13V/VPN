'use strict';

const crypto = require('node:crypto');
const { VPNresellers } = require('../src/vpnresellers');
const { problem } = require('./model');

function validWallet(value) { return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value); }
function validId(value) { return Number.isSafeInteger(value) && value > 0; }
function validExpiry(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }

function issueGrant({ wallet, accountId, serverId, expiresAt }, signingKey) {
  if (!validWallet(wallet) || !validId(accountId) || !validId(serverId) || !validExpiry(expiresAt) ||
      typeof signingKey !== 'string' || !/^[a-f0-9]{64}$/i.test(signingKey)) throw new Error('Invalid pilot grant input');
  const payload = Buffer.from(JSON.stringify({ v: 1, wallet: wallet.toLowerCase(), accountId, serverId, expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', Buffer.from(signingKey, 'hex')).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyGrant(token, wallet, signingKey, now = Date.now()) {
  if (!validWallet(wallet) || typeof token !== 'string' || token.length > 512 ||
      typeof signingKey !== 'string' || !/^[a-f0-9]{64}$/i.test(signingKey)) throw problem(403, 'PILOT_GRANT_INVALID', 'Pilot access is unavailable.');
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) throw problem(403, 'PILOT_GRANT_INVALID', 'Pilot access is unavailable.');
  const expected = crypto.createHmac('sha256', Buffer.from(signingKey, 'hex')).update(match[1]).digest();
  const actual = Buffer.from(match[2], 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw problem(403, 'PILOT_GRANT_INVALID', 'Pilot access is unavailable.');
  let grant;
  try { grant = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); }
  catch { throw problem(403, 'PILOT_GRANT_INVALID', 'Pilot access is unavailable.'); }
  if (grant?.v !== 1 || grant.wallet !== wallet.toLowerCase() || !validId(grant.accountId) ||
      !validId(grant.serverId) || !validExpiry(grant.expiresAt) || Date.parse(grant.expiresAt) <= now) {
    throw problem(403, 'PILOT_GRANT_INVALID', 'Pilot access is unavailable.');
  }
  return grant;
}

class PilotAccess {
  constructor({ signingKey = process.env.VPN_PILOT_SIGNING_KEY, supplier = new VPNresellers(), now = Date.now } = {}) {
    if (typeof signingKey !== 'string' || !/^[a-f0-9]{64}$/i.test(signingKey)) throw new Error('VPN_PILOT_SIGNING_KEY must be a 32-byte hex secret');
    this.signingKey = signingKey; this.supplier = supplier; this.now = now;
  }

  async status(session, token) {
    if (session?.kind !== 'wallet') throw problem(403, 'WALLET_REQUIRED', 'Connect the approved wallet for pilot access.');
    const grant = verifyGrant(token, session.address, this.signingKey, this.now());
    let account;
    try { account = await this.supplier.account(grant.accountId, undefined); }
    catch { throw problem(503, 'PILOT_SUPPLIER_UNAVAILABLE', 'Pilot status is temporarily unavailable.'); }
    const supplierExpiry = Date.parse(account.expiresAt);
    if (account.status !== 'Active' || !Number.isFinite(supplierExpiry) || supplierExpiry <= this.now()) {
      throw problem(403, 'PILOT_ACCOUNT_INACTIVE', 'This pilot account is not active.');
    }
    return { status: 'active', expiresAt: new Date(Math.min(supplierExpiry, Date.parse(grant.expiresAt))).toISOString(), location: 'Australia' };
  }

  async configuration(session, token) {
    const grant = verifyGrant(token, session?.address, this.signingKey, this.now());
    await this.status(session, token);
    try { return await this.supplier.configuration(grant.serverId, grant.accountId); }
    catch { throw problem(503, 'PILOT_CONFIG_UNAVAILABLE', 'The configuration is temporarily unavailable. Retry without creating another account.'); }
  }
}

module.exports = { issueGrant, verifyGrant, PilotAccess };
