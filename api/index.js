'use strict';

const { createHandler } = require('../portal/server');
const { isIP } = require('node:net');

let handler;
module.exports = async (req, res) => {
  try {
    if (!handler) {
      const origin = process.env.VPN_ORIGIN;
      if (!origin?.startsWith('https://')) throw new Error('An HTTPS VPN_ORIGIN is required');
      // The launch site is informational until paid delivery and funding pass.
      // No session, simulated plan or supplier mutation API is hosted here.
      handler = createHandler({ origin, mode: 'launch',
        // Vercel supplies x-real-ip; never enable this path on a directly exposed Node server.
        clientKey: request => process.env.VERCEL === '1' && isIP(request.headers['x-real-ip'] || '')
          ? request.headers['x-real-ip'] : request.socket.remoteAddress });
    }
    if (req.method === 'GET' && req.headers.host !== new URL(process.env.VPN_ORIGIN).host) {
      const requested = new URL(req.url, process.env.VPN_ORIGIN);
      res.writeHead(307, { location: `${process.env.VPN_ORIGIN}${requested.pathname}${requested.search}`, 'cache-control': 'no-store' });
      return res.end();
    }
    return await handler(req, res);
  } catch {
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ code: 'HOSTING_UNAVAILABLE', error: 'The portal is temporarily unavailable.' }));
  }
};
