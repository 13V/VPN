'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const { Auth } = require('../portal/auth');

const wallet = Wallet.createRandom();
const origin = 'http://localhost:3000';
const start = Date.UTC(2026, 8, 18, 12);

function fixture(options = {}) {
  let current = start;
  return { auth: new Auth({ origin, now: () => current, ...options }), advance: ms => { current += ms; } };
}

test('wallet challenge binds the server origin, checksummed address, chain, nonce, and expiry', () => {
  const { auth } = fixture();
  const result = auth.challenge(wallet.address.toLowerCase());
  assert.match(result.nonce, /^[a-f0-9]{32}$/);
  assert.equal(result.message, [
    `${origin} wants you to sign in with your Ethereum account:`, wallet.address, '',
    'Sign in to the VPN preview for up to 8 hours. This does not authorize a payment.', '',
    `URI: ${origin}`, 'Version: 1', 'Chain ID: 4663', `Nonce: ${result.nonce}`,
    'Issued At: 2026-09-18T12:00:00.000Z', 'Expiration Time: 2026-09-18T12:05:00.000Z'
  ].join('\n'));
  assert.notEqual(auth.challenge(wallet.address).nonce, result.nonce);
});

test('a real wallet signature creates an opaque session and cannot be replayed', async () => {
  const { auth } = fixture();
  const { nonce, message } = auth.challenge(wallet.address);
  const signature = await wallet.signMessage(message);
  const result = auth.verify({ nonce, signature });
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.session, { address: wallet.address, kind: 'wallet' });
  assert.equal(result.expiresAt, start + 8 * 60 * 60 * 1000);
  assert.deepEqual(auth.session(result.token), result.session);
  assert.throws(() => auth.verify({ nonce, signature }), { status: 401, code: 'CHALLENGE_INVALID' });
});

test('verification uses the stored message, ignoring a client-provided replacement', async () => {
  const { auth } = fixture();
  const { nonce, message } = auth.challenge(wallet.address);
  const altered = message.replace('Chain ID: 4663', 'Chain ID: 1');
  const signature = await wallet.signMessage(altered);
  assert.throws(() => auth.verify({ nonce, signature, message: altered }), { code: 'SIGNATURE_INVALID' });
  assert.throws(() => auth.verify({ nonce, signature }), { code: 'CHALLENGE_INVALID' });
});

test('a signature for another address is rejected and consumes its challenge', async () => {
  const { auth } = fixture();
  const { nonce, message } = auth.challenge(wallet.address);
  const wrong = await Wallet.createRandom().signMessage(message);
  const correct = await wallet.signMessage(message);
  assert.throws(() => auth.verify({ nonce, signature: wrong }), { code: 'SIGNATURE_INVALID' });
  assert.throws(() => auth.verify({ nonce, signature: correct }), { code: 'CHALLENGE_INVALID' });
});

test('a challenge expires exactly five minutes after creation', async () => {
  const { auth, advance } = fixture();
  const { nonce, message } = auth.challenge(wallet.address);
  const signature = await wallet.signMessage(message);
  advance(5 * 60 * 1000);
  assert.throws(() => auth.verify({ nonce, signature }), { status: 401, code: 'CHALLENGE_INVALID' });
});

test('malformed signatures are rejected safely and consume their challenge', () => {
  const { auth } = fixture();
  for (const signature of [undefined, null, {}, '0x1234', '0x' + '00'.repeat(65), 'secret-data']) {
    const { nonce } = auth.challenge(wallet.address);
    assert.throws(() => auth.verify({ nonce, signature }), error => error.code === 'SIGNATURE_INVALID' && !error.message.includes('secret-data'));
    assert.throws(() => auth.verify({ nonce, signature }), { code: 'CHALLENGE_INVALID' });
  }
  assert.throws(() => auth.verify(null), { code: 'CHALLENGE_INVALID' });
});

test('invalid addresses and origins do not enter authentication state', () => {
  const { auth } = fixture();
  for (const address of [null, {}, 'demo', wallet.address + '\n', '0x1234']) {
    assert.throws(() => auth.challenge(address), { status: 400, code: 'ADDRESS_INVALID' });
  }
  for (const badOrigin of ['data:text/plain,test', 'https://example.com/path', 'https://user:password@example.com', 'https://example.com/?other']) {
    assert.throws(() => new Auth({ origin: badOrigin }));
  }
  assert.throws(() => new Auth({ origin, chainId: '4663' }));
});

test('demo sessions are isolated and are never wallet sessions', () => {
  const { auth } = fixture();
  const a = auth.demo();
  const b = auth.demo();
  assert.match(a.session.address, /^demo:[a-f0-9]{32}$/);
  assert.equal(a.session.kind, 'demo');
  assert.notEqual(a.session.address, b.session.address);
  assert.notEqual(a.token, b.token);
  assert.deepEqual(auth.session(a.token), a.session);
});

test('demo sign-in can be disabled', () => {
  const { auth } = fixture({ demoEnabled: false });
  assert.throws(() => auth.demo(), { status: 403, code: 'DEMO_DISABLED' });
});

test('sessions expire after eight hours without sliding expiry', () => {
  const { auth, advance } = fixture();
  const { token } = auth.demo();
  advance(8 * 60 * 60 * 1000 - 1);
  assert.ok(auth.session(token));
  advance(1);
  assert.equal(auth.session(token), null);
});

test('logout, restart, malformed tokens, and caller mutations cannot preserve or elevate a session', () => {
  const { auth } = fixture();
  const { token, session } = auth.demo();
  session.kind = 'wallet';
  auth.session(token).address = wallet.address;
  assert.equal(auth.session(token).kind, 'demo');
  assert.match(auth.session(token).address, /^demo:/);
  assert.equal(fixture().auth.session(token), null);
  for (const badToken of [undefined, null, {}, 'a'.repeat(63), token.toUpperCase()]) assert.equal(auth.session(badToken), null);
  auth.logout(token);
  auth.logout(token);
  assert.equal(auth.session(token), null);
});

test('challenge storage is bounded and expiry restores capacity', () => {
  const { auth, advance } = fixture();
  for (let i = 0; i < 1000; i++) auth.challenge(wallet.address);
  assert.throws(() => auth.challenge(wallet.address), { status: 429, code: 'AUTH_CAPACITY' });
  advance(5 * 60 * 1000);
  assert.match(auth.challenge(wallet.address).nonce, /^[a-f0-9]{32}$/);
});

test('session storage is bounded; logout and expiry restore capacity', () => {
  const { auth, advance } = fixture();
  let token;
  for (let i = 0; i < 1000; i++) token = auth.demo().token;
  assert.throws(() => auth.demo(), { status: 429, code: 'AUTH_CAPACITY' });
  auth.logout(token);
  assert.ok(auth.demo().token);
  advance(8 * 60 * 60 * 1000);
  assert.ok(auth.demo().token);
});
