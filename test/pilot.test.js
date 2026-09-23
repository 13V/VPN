'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { VPNresellers, wireGuardConfiguration } = require('../src/vpnresellers');
const { PilotStore, PilotOperator } = require('../src/pilot-operator');
const { issueGrant, verifyGrant, PilotAccess } = require('../portal/pilot-access');
const { createApp } = require('../portal/server');

const wallet = '0x' + '1'.repeat(40);
const another = '0x' + '2'.repeat(40);
const signingKey = 'ab'.repeat(32);
const configuration = `[Interface]\nPrivateKey = ${'A'.repeat(43)}=\nAddress = 10.250.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ${'B'.repeat(43)}=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = au.example.test:51820\n`;
const now = Date.parse('2026-09-23T10:00:00.000Z');

class Supplier {
  constructor() { this.accounts = new Map(); this.calls = { create: 0, expire: 0, config: 0 }; }
  async profile() { return { balance: 25 }; }
  async australiaServers() { return [{ id: 19, name: 'au.example.test', city: 'Sydney' }]; }
  async createAccount(username) {
    this.calls.create++;
    const a = { id: this.accounts.size + 1, username, status: 'Active', expiresAt: null };
    this.accounts.set(username, a);
    if (this.loseCreate) throw new Error('response lost');
    return { ...a };
  }
  async accountByUsername(username) { return this.accounts.has(username) ? { ...this.accounts.get(username) } : null; }
  async account(id) { return { ...[...this.accounts.values()].find(a => a.id === id) }; }
  async expireAccount(id, username, date) {
    this.calls.expire++;
    const a = this.accounts.get(username);
    assert.equal(a.id, id);
    a.expiresAt = `${date}T00:00:00.000Z`;
    if (this.loseExpiry) throw new Error('response lost');
    return { ...a };
  }
  async configuration(serverId, accountId) {
    this.calls.config++;
    assert.equal(serverId, 19); assert.ok(accountId > 0);
    if (this.loseConfig) throw new Error('temporarily unavailable');
    return configuration;
  }
  async disableAccount(id, username) { const a = this.accounts.get(username); assert.equal(a.id, id); a.status = 'Disabled'; return { ...a }; }
}

function operator(supplier, dir) { return new PilotOperator({ supplier, store: new PilotStore(dir), now: () => now }); }

test('supplier adapter accepts a repeatable configuration and rejects unexpected directives', () => {
  assert.equal(wireGuardConfiguration(configuration), configuration);
  assert.throws(() => wireGuardConfiguration(configuration + 'PostUp = curl bad.example\n'), /Unexpected/);
  assert.throws(() => wireGuardConfiguration(configuration.replace('Endpoint = au.example.test:51820', 'Endpoint = bad.example:0')), /network fields/);
});

test('supplier adapter redacts failed HTTP response', async () => {
  const adapter = new VPNresellers({ token: 'secret-test-token', fetchImpl: async () => new Response(JSON.stringify({ message: 'secret-test-token' }), { status: 422 }) });
  await assert.rejects(adapter.profile(), error => error.status === 422 && !error.message.includes('secret-test-token'));
});

test('pilot provisions one capped account, fixes expiry, retrieves config and issues wallet-bound grant', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velora-pilot-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const supplier = new Supplier(), pilot = operator(supplier, dir);
  const result = await pilot.start(wallet, { live: true });
  assert.equal(result.accounts[wallet].state, 'ready');
  assert.equal(supplier.calls.create, 1);
  assert.equal(supplier.calls.expire, 1);
  assert.equal(supplier.calls.config, 1);
  assert.equal(pilot.store.read().accounts[wallet].password, undefined);
  await assert.rejects(pilot.start(another, { live: true }), /cap reached/);
  const grant = pilot.grant(wallet, signingKey);
  assert.equal(verifyGrant(grant, wallet, signingKey, now).accountId, 1);
  assert.throws(() => verifyGrant(grant, another, signingKey, now), /Pilot access/);
  assert.throws(() => verifyGrant(grant.slice(0, -2) + 'aa', wallet, signingKey, now), /Pilot access/);
  const access = new PilotAccess({ signingKey, supplier, now: () => now });
  assert.equal((await access.status({ kind: 'wallet', address: wallet }, grant)).status, 'active');
  assert.equal(await access.configuration({ kind: 'wallet', address: wallet }, grant), configuration);
  await assert.rejects(access.configuration({ kind: 'demo', address: wallet }, grant), /Connect the approved wallet/);
});

test('lost create response recovers by username without a second create', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velora-pilot-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const supplier = new Supplier(); supplier.loseCreate = true;
  const pilot = operator(supplier, dir);
  assert.equal((await pilot.start(wallet, { live: true })).accounts[wallet].state, 'create_unknown');
  supplier.loseCreate = false;
  assert.equal((await operator(supplier, dir).resume(wallet)).accounts[wallet].state, 'ready');
  assert.equal(supplier.calls.create, 1);
});

test('lost expiry result and configuration outage are resolved through reads', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velora-pilot-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const supplier = new Supplier(); supplier.loseExpiry = true;
  const pilot = operator(supplier, dir);
  assert.equal((await pilot.start(wallet, { live: true })).accounts[wallet].state, 'expiry_unknown');
  supplier.loseExpiry = false; supplier.loseConfig = true;
  assert.equal((await pilot.resume(wallet)).accounts[wallet].state, 'config_unknown');
  supplier.loseConfig = false;
  assert.equal((await pilot.resume(wallet)).accounts[wallet].state, 'ready');
  assert.equal(supplier.calls.create, 1);
  assert.equal(supplier.calls.expire, 1);
});

test('an inactive or expired supplier account never yields a config', async () => {
  const supplier = new Supplier(); supplier.accounts.set('one', { id: 3, username: 'one', status: 'Disabled', expiresAt: '2026-09-30T00:00:00.000Z' });
  const grant = issueGrant({ wallet, accountId: 3, serverId: 19, expiresAt: '2026-09-30T00:00:00.000Z' }, signingKey);
  const access = new PilotAccess({ signingKey, supplier, now: () => now });
  await assert.rejects(access.configuration({ kind: 'wallet', address: wallet }, grant), /not active/);
  assert.equal(supplier.calls.config, 0);
  assert.throws(() => verifyGrant(grant, wallet, signingKey, Date.parse('2026-10-01T00:00:00.000Z')), /Pilot access/);
});

test('HTTP pilot route requires the wallet session and returns a private conf download', async t => {
  const supplier = new Supplier(); supplier.accounts.set('one', { id: 3, username: 'one', status: 'Active', expiresAt: '2026-09-30T00:00:00.000Z' });
  const pilot = new PilotAccess({ signingKey, supplier, now: () => now });
  const grant = issueGrant({ wallet, accountId: 3, serverId: 19, expiresAt: '2026-09-30T00:00:00.000Z' }, signingKey);
  const origin = 'http://127.0.0.1:4173';
  const auth = { session: token => token === 'good' ? { kind: 'wallet', address: wallet } : token === 'other' ? { kind: 'wallet', address: another } : null };
  const app = createApp({ origin, auth, pilot, portal: { dashboard: () => null } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const request = (route, cookie, allowedOrigin = origin) => new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${app.address().port}${route}`, { method: 'POST', headers: {
      host: '127.0.0.1:4173', origin: allowedOrigin, 'content-type': 'application/json', cookie: `vpn_session=${cookie}`,
    } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(JSON.stringify({ grant }));
  });
  assert.equal((await request('/api/pilot/status', 'missing')).status, 401);
  assert.equal((await request('/api/pilot/status', 'other')).status, 403);
  assert.equal((await request('/api/pilot/status', 'good', 'https://wrong.test')).status, 403);
  const status = await request('/api/pilot/status', 'good');
  assert.equal((await status.json()).status, 'active');
  const download = await request('/api/pilot/config', 'good');
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /velora-pilot\.conf/);
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal(await download.text(), configuration);
});
