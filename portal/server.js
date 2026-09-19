'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Auth } = require('./auth');
const { Portal, CATALOGUE, problem } = require('./model');

function createApp({ origin = 'http://127.0.0.1:4173', mode = 'demo', portal = new Portal({ mode }), auth = new Auth({ origin, demoEnabled: mode === 'demo' }), now = Date.now } = {}) {
  const canonical = new URL(origin);
  if (canonical.origin !== origin || !['http:', 'https:'].includes(canonical.protocol) || canonical.username || canonical.password) throw new Error('VPN_ORIGIN must be an exact HTTP(S) origin');
  const limiter = new Map();
  const files = {
    '/': ['landing.html', 'text/html'],
    '/portal': ['index.html', 'text/html'], '/portal/': ['index.html', 'text/html'],
    '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
    '/landing.css': ['landing.css', 'text/css'], '/landing.js': ['landing.js', 'text/javascript'],
    '/connection-sculpture.jpg': ['connection-sculpture.jpg', 'image/jpeg'],
  };
  function token(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('vpn_session='))?.slice(12); }
  function cookie(value, maxAge = 28800) { return `vpn_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${canonical.protocol === 'https:' ? '; Secure' : ''}`; }
  async function body(req) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw problem(415, 'JSON_REQUIRED', 'Send JSON.');
    const parts = []; let bytes = 0;
    for await (const part of req) { bytes += part.length; if (bytes > 8192) throw problem(413, 'BODY_TOO_LARGE', 'Request is too large.'); parts.push(part); }
    const data = Buffer.concat(parts).toString('utf8');
    let parsed;
    try { parsed = JSON.parse(data); } catch { throw problem(400, 'INVALID_JSON', 'Invalid JSON.'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw problem(400, 'INVALID_JSON', 'Expected a JSON object.');
    return parsed;
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      if (req.headers.host !== canonical.host) throw problem(403, 'HOST_REJECTED', 'Unexpected host.');
      const url = new URL(req.url, origin);
      const route = url.pathname;
      if (req.method === 'GET' && files[route]) {
        const [name, type] = files[route]; res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); res.end(fs.readFileSync(path.join(__dirname, '..', 'public', name))); return;
      }
      if (!route.startsWith('/api/')) return send(404, { error: 'Not found.' });
      if (!['GET', 'POST'].includes(req.method)) throw problem(405, 'METHOD_REJECTED', 'Method not allowed.');
      if (req.method === 'POST') {
        if (req.headers.origin !== origin) throw problem(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
        // Socket peer only: never trust client-supplied forwarding headers.
        const key = req.socket.remoteAddress;
        for (const [k, entry] of limiter) if (entry.until <= now()) limiter.delete(k);
        if (limiter.size > 5000) throw problem(429, 'RATE_LIMITED', 'Try again shortly.');
        const limit = limiter.get(key) || { count: 0, until: now() + 60000 }; limit.count++; limiter.set(key, limit);
        if (limit.count > 90) throw problem(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.');
      }
      const session = auth.session(token(req));
      if (req.method === 'GET' && route === '/api/bootstrap') return send(200, { mode, brand: 'VPN', chainId: 4663, session, catalogue: CATALOGUE, dashboard: session ? portal.dashboard(session) : null });
      if (req.method === 'POST' && route.startsWith('/api/auth/')) {
        const input = await body(req);
        if (route === '/api/auth/challenge') return send(200, auth.challenge(input.address));
        if (route === '/api/auth/logout') { auth.logout(token(req)); res.setHeader('set-cookie', cookie('', 0)); return send(200, { signedOut: true }); }
        if (route === '/api/auth/demo' || route === '/api/auth/verify') {
          const result = route.endsWith('/demo') ? auth.demo() : auth.verify(input);
          auth.logout(token(req)); res.setHeader('set-cookie', cookie(result.token)); return send(200, { session: result.session });
        }
      }
      if (!session) throw problem(401, 'SIGN_IN_REQUIRED', 'Sign in to view your tunnels.');
      if (req.method === 'POST' && route === '/api/tunnels') return send(200, await portal.provision(session, await body(req)));
      const match = /^\/api\/tunnels\/([0-9a-f-]{36})\/(renew|config)$/.exec(route);
      if (match?.[2] === 'renew' && req.method === 'POST') return send(200, await portal.provision(session, await body(req), match[1]));
      if (match?.[2] === 'config' && req.method === 'GET') {
        const configuration = portal.configuration(session, match[1]);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="vpn-demo-${match[1]}.txt"` }); res.end(configuration); return;
      }
      send(404, { error: 'Not found.' });
    } catch (e) {
      const lock = /Campaign locked/.test(e.message);
      send(e.status || (lock ? 409 : 500), { error: e.status ? e.message : lock ? 'Another request is being processed. Retry with the same request ID.' : 'The request could not be completed. Please retry.', code: e.code || (lock ? 'BUSY' : 'INTERNAL_ERROR') });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1';
  const origin = process.env.VPN_ORIGIN || `http://${host}:${port}`, mode = process.env.VPN_PORTAL_MODE || 'demo';
  const app = createApp({ origin, mode });
  app.listen(port, host, () => process.stdout.write(`VPN ${mode} portal: ${origin}\nLive supplier payments are disabled.\n`));
}
module.exports = { createApp };
