'use strict';
const { request, json, ServiceError } = require('./http');

class Nadanada {
  constructor({ fetchImpl = fetch } = {}) { this.fetch = fetchImpl; }
  async call(path, body, plain = false) {
    const r = await request(`https://nadanada.me/api/v2/vpn${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { accept: plain ? 'text/plain' : 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, this.fetch);
    if (r.status !== 200) {
      const code = r.status === 409 ? 'CONFIG_ALREADY_GENERATED' : r.status === 402 ? 'PAYMENT_PENDING' : 'SUPPLIER_ERROR';
      throw new ServiceError('nadanada', r.status, code);
    }
    if (plain) return r.text;
    const j = json(r.text);
    if (j.success !== true || !j.data) throw new ServiceError('nadanada', 200, 'INVALID_RESPONSE');
    return j.data;
  }
  catalogue() { return this.call('/countries'); }
  quote(order) {
    return this.call(order.kind === 'renewal' ? '/extend' : '/request', {
      duration: order.plan.duration, paymentMethod: 'lightning',
      ...(order.kind === 'renewal' ? { publicKey: order.keys.publicKey } : {}),
    });
  }
  config(order) {
    return this.call('/config', {
      paymentHash: order.quote.paymentHash, country: order.country.code,
      publicKey: order.keys.publicKey, presharedKey: order.keys.presharedKey,
    }, true);
  }
  status(publicKey) { return this.call(`/status/${encodeURIComponent(publicKey)}`); }
}

module.exports = { Nadanada };
