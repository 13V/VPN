'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler } = require('../portal/server');

const origin = 'https://vpn.example';
const token = 'a'.repeat(64);
const session = { address: `demo:${'b'.repeat(32)}`, kind: 'demo' };
const pause = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, overrides = {}) {
  const events = [];
  const auth = {
    async session(value) { await pause(); return value === token ? session : null; },
    async demo() { await pause(); events.push('demo-saved'); return { token, session }; },
    async logout() { await pause(); events.push('logout-saved'); },
    ...overrides.auth,
  };
  const portal = {
    async dashboard(current) { await pause(); assert.deepEqual(current, session); return { persisted: true }; },
    async provision(current, body) { await pause(); assert.deepEqual(current, session); return { saved: body.requestId }; },
    async configuration(current) { await pause(); assert.deepEqual(current, session); return 'Sample configuration only'; },
    ...overrides.portal,
  };
  const server = http.createServer(createHandler({ origin, auth, portal }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = (route, { method = 'GET', body, cookie } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method,
      headers: { host: 'vpn.example', origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { request, events };
}

test('hosted HTTP handler awaits persisted session and portal operations', async t => {
  const { request, events } = await fixture(t);
  const login = await request('/api/auth/demo', { method: 'POST', body: {} });
  assert.equal(login.status, 200);
  assert.deepEqual(events, ['demo-saved', 'logout-saved']);
  assert.deepEqual(await login.json(), { session });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure$/);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const bootstrap = await request('/api/bootstrap', { cookie });
  const data = await bootstrap.json();
  assert.deepEqual(data.session, session);
  assert.deepEqual(data.dashboard, { persisted: true });
  const provision = await request('/api/tunnels', { method: 'POST', cookie, body: { requestId: 'saved-request' } });
  assert.deepEqual(await provision.json(), { saved: 'saved-request' });
  const download = await request('/api/tunnels/00000000-0000-4000-8000-000000000000/config', { cookie });
  assert.equal(await download.text(), 'Sample configuration only');
  assert.equal(download.headers.get('cache-control'), 'no-store');

  const logout = await request('/api/auth/logout', { method: 'POST', cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.equal(events.filter(event => event === 'logout-saved').length, 2);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0; Secure$/);
});

test('hosted HTTP handler awaits and sanitizes rejected storage operations', async t => {
  const { request } = await fixture(t, { portal: {
    async dashboard() { await pause(); throw new Error('private-storage-debug-information'); },
  } });
  const response = await request('/api/bootstrap', { cookie: `vpn_session=${token}` });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: 'INTERNAL_ERROR', error: 'The request could not be completed. Please retry.' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
