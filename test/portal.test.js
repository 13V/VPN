'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { Wallet } = require('ethers');
const { Portal, PortalStore, week, snapshot } = require('../portal/model');
const { createApp } = require('../portal/server');

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-portal-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new PortalStore(dir);
  const portal = new Portal({ store, ...options });
  const session = { address: 'demo:test-account', kind: 'demo' };
  return { dir, store, portal, session };
}
const input = () => ({ requestId: randomUUID(), country: 'AU', planId: 'day', name: 'My phone' });

test('demo create, renew and download persist across reopening without supplier payments', async t => {
  const { store, portal, session } = fixture(t);
  const { tunnel } = await portal.provision(session, input());
  assert.equal(portal.dashboard(session).allowance.remainingCents, 300);
  const { tunnel: renewed } = await portal.provision(session, { requestId: randomUUID() }, tunnel.id);
  assert.equal(Date.parse(renewed.expiresAt) - Date.parse(tunnel.expiresAt), 86400000);
  assert.equal(renewed.bandwidthGb, 100);
  const reopened = new Portal({ store: new PortalStore(store.dir) });
  assert.equal(reopened.dashboard(session).allowance.spentCents, 100);
  assert.match(reopened.configuration(session, tunnel.id), /not a working VPN configuration/);
  assert.equal(reopened.dashboard(session).activity.length, 2);
});

test('lost response retry returns original result and debits allowance only once', async t => {
  const { portal, session } = fixture(t); const request = input();
  const first = await portal.provision(session, request);
  const again = await portal.provision(session, request);
  assert.deepEqual(again.tunnel, first.tunnel); assert.equal(again.replayed, true);
  assert.equal(portal.dashboard(session).allowance.spentCents, 50);
  await assert.rejects(portal.provision(session, { ...request, name: 'Different' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('concurrent claims cannot double spend and can retry with original request ID', async t => {
  const { portal, session } = fixture(t); const request = input();
  const results = await Promise.allSettled([portal.provision(session, request), portal.provision(session, request)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /locked/);
  await portal.provision(session, request);
  assert.equal(portal.dashboard(session).allowance.spentCents, 50);
});

test('allowance cap, weekly reset, and old-request replay do not double charge', async t => {
  let now = Date.parse('2026-09-20T23:59:00Z');
  const { portal, session } = fixture(t, { now: () => now });
  const old = input(); await portal.provision(session, old);
  for (let i = 0; i < 6; i++) await portal.provision(session, input());
  await assert.rejects(portal.provision(session, input()), { code: 'ALLOWANCE_EXHAUSTED' });
  now += 120000;
  assert.equal(portal.dashboard(session).allowance.remainingCents, 350);
  await portal.provision(session, old);
  assert.equal(portal.dashboard(session).allowance.spentCents, 0);
  await portal.provision(session, input());
  assert.equal(portal.dashboard(session).allowance.remainingCents, 300);
  assert.equal(week(now).startsAt, '2026-09-21T00:00:00.000Z');
});

test('another account cannot view or extend a tunnel', async t => {
  const { portal, session } = fixture(t);
  const { tunnel } = await portal.provision(session, input());
  const other = { address: 'demo:other', kind: 'demo' };
  assert.throws(() => portal.configuration(other, tunnel.id), { code: 'TUNNEL_NOT_FOUND' });
  await assert.rejects(portal.provision(other, { requestId: randomUUID() }, tunnel.id), { code: 'TUNNEL_NOT_FOUND' });
  assert.equal(portal.dashboard(other).allowance.spentCents, 0);
});

test('wallet sessions and preview mode cannot provision even with demo state', async t => {
  const { store, portal } = fixture(t);
  await assert.rejects(portal.provision({ address: Wallet.createRandom().address, kind: 'wallet' }, input()), { code: 'LIVE_PROVISIONING_BLOCKED' });
  await assert.rejects(new Portal({ store, mode: 'preview' }).provision({ address: 'demo:test', kind: 'demo' }, input()), { code: 'LIVE_PROVISIONING_BLOCKED' });
  assert.equal(fs.existsSync(store.file), false);
  assert.throws(() => new Portal({ mode: 'live' }), /live mode is unavailable/);
});

test('invalid plan and malformed request cannot debit allowance', async t => {
  const { portal, session } = fixture(t);
  await assert.rejects(portal.provision(session, { ...input(), country: 'US' }), { code: 'INVALID_PLAN' });
  await assert.rejects(portal.provision(session, { ...input(), name: '\nBad' }), { code: 'INVALID_PLAN' });
  await assert.rejects(portal.provision(session, { ...input(), requestId: 'random' }), { code: 'REQUEST_ID_REQUIRED' });
  assert.equal(portal.dashboard(session).allowance.spentCents, 0);
});

test('funded snapshot rejects stale, wrong-chain and overallocated inputs', t => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'snapshot.json'), address = Wallet.createRandom().address.toLowerCase();
  const valid = { version: 1, chainId: 4663, tokenAddress: Wallet.createRandom().address, blockNumber: 123,
    startsAt: '2026-09-14T00:00:00Z', endsAt: '2026-09-21T00:00:00Z', fundedBudgetCents: 200, allocations: { [address]: 100 } };
  const now = Date.parse('2026-09-19T00:00:00Z');
  fs.writeFileSync(file, JSON.stringify(valid));
  assert.equal(snapshot(file, now, address).totalCents, 100);
  assert.throws(() => snapshot(file, now + 7 * 86400000, address), { code: 'SNAPSHOT_INVALID' });
  fs.writeFileSync(file, JSON.stringify({ ...valid, fundedBudgetCents: 50 }));
  assert.throws(() => snapshot(file, now, address), { code: 'SNAPSHOT_UNFUNDED' });
  fs.writeFileSync(file, JSON.stringify({ ...valid, chainId: 1 }));
  assert.throws(() => snapshot(file, now, address), { code: 'SNAPSHOT_INVALID' });
});

async function httpFixture(t, mode = 'demo') {
  const { portal, store } = mode === 'launch' ? {} : fixture(t, { mode });
  const origin = 'http://127.0.0.1:4173';
  const app = createApp({ origin, mode, portal });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  const base = `http://127.0.0.1:${app.address().port}`;
  // Native HTTP lets the test explicitly send the canonical Host on an ephemeral port.
  const request = (route, opts = {}) => new Promise((resolve, reject) => {
    const req = http.request(base + route, { method: opts.method || 'GET', headers: { host: '127.0.0.1:4173', origin, 'content-type': 'application/json', ...opts.headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(opts.body);
  });
  return { request, store, origin };
}

test('HTTP demo journey sets private cookie, enforces ownership, and redacts errors', async t => {
  const { request } = await httpFixture(t);
  const initial = await request('/api/bootstrap'); assert.equal((await initial.json()).session, null);
  const unauthorized = await request('/api/tunnels', { method: 'POST', body: JSON.stringify(input()) }); assert.equal(unauthorized.status, 401);
  const login = await request('/api/auth/demo', { method: 'POST', body: '{}' });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const creation = await request('/api/tunnels', { method: 'POST', headers: { cookie }, body: JSON.stringify(input()) });
  const { tunnel } = await creation.json(); assert.ok(tunnel.id);
  const download = await request(`/api/tunnels/${tunnel.id}/config`, { headers: { cookie } });
  assert.match(await download.text(), /DEMO SETUP PREVIEW/); assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition'), /\.txt/);
  const rejected = await request('/api/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://other.example' }, body: '{}' });
  assert.equal(rejected.status, 403);
  const logout = await request('/api/auth/logout', { method: 'POST', headers: { cookie }, body: '{}' }); assert.equal(logout.status, 200);
  assert.equal((await request(`/api/tunnels/${tunnel.id}/config`, { headers: { cookie } })).status, 401);
});

test('HTTP rejects wrong host, missing origin, malformed JSON, and oversized body', async t => {
  const { request } = await httpFixture(t);
  assert.equal((await request('/api/bootstrap', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await request('/api/auth/demo', { method: 'POST', headers: { origin: '' }, body: '{}' })).status, 403);
  assert.equal((await request('/api/auth/demo', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request('/api/auth/demo', { method: 'POST', body: JSON.stringify({ x: 'a'.repeat(9000) }) })).status, 413);
  assert.equal((await request('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
});

test('HTTP real wallet login never grants a demo allowance or purchasing permission', async t => {
  const { request } = await httpFixture(t); const wallet = Wallet.createRandom();
  const challenge = await (await request('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ address: wallet.address }) })).json();
  const signature = await wallet.signMessage(challenge.message);
  const login = await request('/api/auth/verify', { method: 'POST', body: JSON.stringify({ nonce: challenge.nonce, signature }) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
  const state = await (await request('/api/bootstrap', { headers: { cookie } })).json();
  assert.equal(state.session.kind, 'wallet'); assert.equal(state.dashboard.allowance.totalCents, 0);
  const order = await request('/api/tunnels', { method: 'POST', headers: { cookie }, body: JSON.stringify(input()) }); assert.equal(order.status, 503);
});

test('preview mode disables the demo login endpoint', async t => {
  const { request } = await httpFixture(t, 'preview');
  const r = await request('/api/auth/demo', { method: 'POST', body: '{}' });
  assert.equal(r.status, 403);
});

test('launch mode serves access information but no account or plan API', async t => {
  const { request } = await httpFixture(t, 'launch');
  const status = await (await request('/api/bootstrap')).json();
  assert.deepEqual(status, { mode: 'launch', brand: 'Velora', serviceAvailable: false });
  assert.equal((await request('/api/auth/demo', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await request('/api/auth/challenge', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await request('/api/tunnels', { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await request('/app.js')).status, 404);
  assert.match(await (await request('/portal')).text(), /Not open yet\./);
});

test('public pages show access status without a simulated plan or public demo assets', async t => {
  const { request } = await httpFixture(t);
  const landing = await request('/');
  assert.equal(landing.status, 200);
  const html = await landing.text();
  assert.match(html, /href="\/portal"/);
  assert.match(html, /id="how-it-works"/);
  assert.match(html, /id="status"/);
  assert.doesNotMatch(html, /src="\/app.js"/);
  assert.doesNotMatch(html, /\bdemo\b|sample access|7 <em>days<\/em>/i);
  const portal = await request('/portal');
  assert.equal(portal.status, 200);
  const access = await portal.text();
  assert.match(access, /Not open yet\./);
  assert.doesNotMatch(access, /\bdemo\b|sample plan|create-form/i);
  assert.equal((await request('/portal/')).status, 200);
  assert.equal((await request('/access.css')).status, 200);
  assert.equal((await request('/app.js')).status, 404);
  const brand = await request('/brand.css');
  assert.equal(brand.status, 200);
  assert.match(brand.headers.get('content-type'), /text\/css/);
  const artwork = await request('/hero-sculpture-fallback.svg');
  assert.equal(artwork.status, 200);
  assert.match(artwork.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal((await request('/portal.json')).status, 404);
});
