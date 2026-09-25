'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Wallet } = require('ethers');
const { BlobPreconditionFailedError } = require('@vercel/blob');
const { Auth } = require('../portal/auth');
const { HostedState, HostedAuth, HostedPortal } = require('../portal/hosted-state');

const origin = 'https://vpn.example.com';
const start = Date.UTC(2026, 8, 19, 12);
const wallet = Wallet.createRandom();
const create = (name = 'Phone') => ({ requestId: randomUUID(), name, country: 'AU', planId: 'day' });

function fixture() {
  let body = null, revision = 0, clock = start;
  const calls = { get: 0, put: 0 };
  const blob = {
    BlobPreconditionFailedError,
    async get(pathname, options) {
      calls.get++;
      assert.equal(pathname, 'vpn/portal-state-v1.json');
      assert.equal(options.access, 'private');
      assert.equal(options.useCache, false);
      assert.equal(options.headers['accept-encoding'], 'identity');
      if (body === null) return null;
      return { statusCode: 200, stream: new Blob([body]).stream(), blob: { etag: `"${revision}"`, size: Buffer.byteLength(body) } };
    },
    async put(pathname, next, options) {
      calls.put++;
      assert.equal(options.access, 'private');
      assert.equal(options.addRandomSuffix, false);
      if (body === null) {
        assert.equal(options.allowOverwrite, false);
        assert.equal(options.ifMatch, undefined);
      } else {
        if (options.allowOverwrite === false || options.ifMatch !== `"${revision}"`) throw new BlobPreconditionFailedError();
        assert.equal(options.allowOverwrite, true);
      }
      body = next; revision++;
      return { etag: `"${revision}"` };
    }
  };
  return {
    blob, calls,
    instance(options = {}) {
      const state = new HostedState({ origin, token: 'offline-test-token', now: () => clock, blob, ...options });
      return { state, auth: new HostedAuth(state), portal: new HostedPortal(state) };
    },
    read: () => JSON.parse(body), raw: () => body,
    corrupt: value => { body = value; revision++; },
    advance: ms => { clock += ms; }
  };
}

test('sessions, sample tunnels and downloads survive entirely new serverless instances without storing bearer tokens', async () => {
  const f = fixture(), first = f.instance();
  const issued = await first.auth.demo();
  assert.equal(f.raw().includes(issued.token), false);
  const cold = f.instance();
  assert.deepEqual(await cold.auth.session(issued.token), issued.session);
  const { tunnel } = await cold.portal.provision(issued.session, create());
  const another = f.instance();
  assert.equal((await another.portal.dashboard(issued.session)).allowance.spentCents, 50);
  assert.match(await another.portal.configuration(issued.session, tunnel.id), /sample download, not a working VPN/);
  await another.auth.logout(issued.token);
  assert.equal(await f.instance().auth.session(issued.token), null);
  assert.deepEqual(f.read().portal.accounts, {});
  assert.deepEqual(f.read().portal.requests, {});
});

test('anonymous or malformed cookies do not access private storage', async () => {
  const f = fixture(), { auth } = f.instance();
  for (const token of [undefined, null, {}, 'invalid', 'A'.repeat(64)]) {
    assert.equal(await auth.session(token), null);
    await auth.logout(token);
  }
  assert.equal(f.calls.get, 0);
  assert.equal(f.calls.put, 0);
});

test('a weak compressed ETag cannot authorize a state write or reset the saved state', async () => {
  const f = fixture();
  await f.instance().auth.demo();
  const saved = f.raw(), writes = f.calls.put;
  const get = f.blob.get;
  f.blob.get = async (...args) => { const result = await get(...args); result.blob.etag = `W/${result.blob.etag}`; return result; };
  await assert.rejects(f.instance().auth.demo(), { code: 'HOSTED_STATE_UNAVAILABLE' });
  assert.equal(f.raw(), saved);
  assert.equal(f.calls.put, writes);
});

test('simultaneous first writes never overwrite another newly created session', async () => {
  const f = fixture();
  const results = await Promise.all([f.instance().auth.demo(), f.instance().auth.demo()]);
  assert.notEqual(results[0].token, results[1].token);
  assert.equal(f.read().auth.sessions.length, 2);
  for (const issued of results) assert.deepEqual(await f.instance().auth.session(issued.token), issued.session);
});

test('wallet nonce verification racing on separate instances issues exactly one session', async () => {
  const f = fixture();
  const { nonce, message } = await f.instance().auth.challenge(wallet.address);
  const signature = await wallet.signMessage(message);
  const outcomes = await Promise.allSettled([f.instance().auth.verify({ nonce, signature }), f.instance().auth.verify({ nonce, signature })]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(o => o.status === 'rejected');
  assert.equal(rejected.reason.code, 'CHALLENGE_INVALID');
  assert.equal(f.read().auth.sessions.length, 1);
  assert.equal(f.read().auth.challenges.length, 0);
  assert.equal((await f.instance().auth.session(outcomes.find(o => o.status === 'fulfilled').value.token)).address, wallet.address);
});

test('an invalid signature consumes its persisted challenge across cold instances', async () => {
  const f = fixture();
  const { nonce, message } = await f.instance().auth.challenge(wallet.address);
  await assert.rejects(f.instance().auth.verify({ nonce, signature: 'malformed' }), { code: 'SIGNATURE_INVALID' });
  await assert.rejects(f.instance().auth.verify({ nonce, signature: await wallet.signMessage(message) }), { code: 'CHALLENGE_INVALID' });
  assert.equal(f.read().auth.challenges.length, 0);
});

test('simultaneous duplicate creates return the same tunnel and simultaneous distinct creates preserve every debit', async () => {
  const f = fixture(), { session } = await f.instance().auth.demo();
  const input = create();
  const duplicate = await Promise.all([f.instance().portal.provision(session, input), f.instance().portal.provision(session, input)]);
  assert.equal(duplicate[0].tunnel.id, duplicate[1].tunnel.id);
  assert.equal(duplicate.filter(r => r.replayed).length, 1);
  await Promise.all([f.instance().portal.provision(session, create('Laptop')), f.instance().portal.provision(session, create('Tablet'))]);
  const dashboard = await f.instance().portal.dashboard(session);
  assert.equal(dashboard.allowance.spentCents, 150);
  assert.equal(dashboard.tunnels.length, 3);
  assert.equal(Object.keys(f.read().portal.requests).length, 3);
});

test('a lost successful write response fails closed and the same request recovers without another debit', async () => {
  const f = fixture(), { session } = await f.instance().auth.demo();
  const input = create();
  const realPut = f.blob.put;
  f.blob.put = async (...args) => { await realPut(...args); throw new Error('Response interrupted'); };
  const writes = f.calls.put;
  await assert.rejects(f.instance().portal.provision(session, input), { code: 'HOSTED_STATE_UNAVAILABLE' });
  assert.equal(f.calls.put, writes + 1);
  f.blob.put = realPut;
  const result = await f.instance().portal.provision(session, input);
  assert.equal(result.replayed, true);
  const renewal = { requestId: randomUUID() };
  const extended = await f.instance().portal.provision(session, renewal, result.tunnel.id);
  assert.equal(extended.tunnel.bandwidthGb, 100);
  assert.equal(Date.parse(extended.tunnel.expiresAt) - Date.parse(result.tunnel.expiresAt), 86400000);
  assert.equal((await f.instance().portal.provision(session, renewal, result.tunnel.id)).replayed, true);
  assert.equal((await f.instance().portal.dashboard(session)).allowance.spentCents, 100);
  assert.match(await f.instance().portal.configuration(session, result.tunnel.id), /100 GB/);
});

test('read failures and corrupt storage never reset or overwrite existing state', async () => {
  const f = fixture(), { token } = await f.instance().auth.demo();
  const original = f.raw(), get = f.blob.get, puts = f.calls.put;
  f.blob.get = async () => { throw new Error('Storage unavailable with sensitive diagnostic'); };
  await assert.rejects(f.instance().auth.session(token), error => error.code === 'HOSTED_STATE_UNAVAILABLE' && !error.message.includes('sensitive'));
  assert.equal(f.raw(), original);
  f.blob.get = get;
  for (const corrupt of ['{broken', JSON.stringify({ version: 1, auth: {}, portal: {} }), JSON.stringify({ ...JSON.parse(original), portal: { version: 1, accounts: {}, requests: { broken: {} } } })]) {
    f.corrupt(corrupt);
    await assert.rejects(f.instance().auth.demo(), { code: 'HOSTED_STATE_UNAVAILABLE' });
    assert.equal(f.raw(), corrupt);
  }
  assert.equal(f.calls.put, puts);
});

test('expiry cleanup removes demo accounts and request history, and stale session objects cannot provision', async () => {
  const f = fixture(), issued = await f.instance().auth.demo();
  await f.instance().portal.provision(issued.session, create());
  f.advance(8 * 60 * 60 * 1000);
  assert.equal(await f.instance().auth.session(issued.token), null);
  assert.deepEqual(f.read().auth.sessions, []);
  assert.deepEqual(f.read().portal.accounts, {});
  assert.deepEqual(f.read().portal.requests, {});
  await assert.rejects(f.instance().portal.provision(issued.session, create()), { code: 'SESSION_REQUIRED' });
});

test('auth snapshot import rejects foreign origin, malformed entries and duplicate hashes without clearing existing sessions', () => {
  const auth = new Auth({ origin, now: () => start }), { token } = auth.demo();
  const snapshot = auth.exportState();
  for (const invalid of [null, { ...snapshot, origin: 'https://attacker.example' }, { ...snapshot, sessions: [snapshot.sessions[0], snapshot.sessions[0]] }, { ...snapshot, sessions: [['raw-bearer-token', {}]] }, { ...snapshot, challenges: [['a'.repeat(32), { address: wallet.address, expiresAt: start + 300000, message: 'foreign' }]] }]) {
    assert.throws(() => auth.importState(invalid), /Invalid authentication state/);
    assert.ok(auth.session(token));
  }
  const copy = new Auth({ origin, now: () => start });
  copy.importState(snapshot);
  snapshot.sessions[0][1].session.kind = 'wallet';
  assert.equal(copy.session(token).kind, 'demo');
});

test('persistent contention stops after the configured attempt limit', async () => {
  const f = fixture();
  await f.instance().auth.demo();
  let attempted = 0;
  f.blob.put = async () => { attempted++; throw new BlobPreconditionFailedError(); };
  await assert.rejects(f.instance({ maxAttempts: 3 }).auth.demo(), { code: 'HOSTED_BUSY' });
  assert.equal(attempted, 3);
  assert.equal(f.read().auth.sessions.length, 1);
});

test('hosted real-wallet access still has no allowance or live provisioning and demo sign-in stays disabled in preview mode', async () => {
  const f = fixture(), app = f.instance();
  const { nonce, message } = await app.auth.challenge(wallet.address);
  const { session } = await app.auth.verify({ nonce, signature: await wallet.signMessage(message) });
  assert.equal((await app.portal.dashboard(session)).allowance.totalCents, 0);
  await assert.rejects(app.portal.provision(session, create()), { code: 'LIVE_PROVISIONING_BLOCKED' });
  await assert.rejects(f.instance({ mode: 'preview' }).auth.demo(), { code: 'DEMO_DISABLED' });
});

test('oversized private state fails closed before parsing or writing', async () => {
  const f = fixture();
  const oversized = ' '.repeat(4 * 1024 * 1024 + 1);
  f.corrupt(oversized);
  await assert.rejects(f.instance().auth.demo(), { code: 'HOSTED_STATE_UNAVAILABLE' });
  assert.equal(f.calls.put, 0);
});
