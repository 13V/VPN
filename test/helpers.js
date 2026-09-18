'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../src/store');
const { Engine } = require('../src/engine');
const { Nadanada } = require('../src/nadanada');
const bolt11 = require('../src/bolt11');

const catalogue = () => ({ countries: [{ code: '19', isoCode: 'AU', name: 'Australia' }], durations: [{ duration: 0.5, price: 0.5, unit: 'day', amount: 1 }] });

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-validation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const state = { requests: [], invoices: new Map(), configs: new Map(), subscriptions: new Map(), payments: new Map(), pays: 0, cap: true, ...options };
  const payer = {
    async capability() { return { hardCap: state.cap }; },
    async rate() { return state.rate || 0.0005; },
    async sent(hash) {
      if (state.reconcileError) throw new Error('offline');
      return state.payments.get(hash) || { status: 'NONE' };
    },
    async pay({ paymentRequest, maxTotalSats }) {
      state.pays++;
      const i = bolt11.decode(paymentRequest), feeSats = 2;
      if (i.sats + feeSats > maxTotalSats) throw new Error('Enforced fee ceiling');
      const result = { status: state.paymentState || 'SUCCESS', sats: i.sats, feeSats };
      if (!state.forgetPayment) state.payments.set(i.paymentHash, result);
      if (state.throwAfterPay) throw new Error('response lost');
      return result;
    },
  };
  const supplier = new Nadanada({ fetchImpl: async (url, init) => {
    const route = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    state.requests.push({ route, body });
    const reply = (status, data, plain = false) => new Response(plain ? data : JSON.stringify(data), { status });
    if (state.supplierError) return reply(503, {});
    if (route.endsWith('/countries')) return reply(200, { success: true, data: state.catalogue || catalogue() });
    if (route.endsWith('/request') || route.endsWith('/extend')) {
      if (state.quoteError) throw new Error('lost invoice response');
      const hash = crypto.randomBytes(32).toString('hex');
      const q = {
        duration: 0.5, price: 0.5, paymentMethod: 'lightning', paymentHash: hash,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        paymentRequest: bolt11.encode({ sats: 1000, paymentHash: hash, timestamp: Math.floor(Date.now() / 1000), ...state.invoiceOverrides }),
        ...state.quoteOverrides,
      };
      state.invoices.set(hash, { q, renewal: route.endsWith('/extend'), publicKey: body.publicKey });
      return reply(200, { success: true, data: q });
    }
    if (route.endsWith('/config')) {
      const invoice = state.invoices.get(body.paymentHash);
      if (state.payments.get(body.paymentHash)?.status !== 'SUCCESS') return reply(402, {});
      if (state.configs.has(body.paymentHash)) {
        if (!state.repeatable) return reply(409, {});
        return reply(200, state.configs.get(body.paymentHash), true);
      }
      const prior = state.subscriptions.get(body.publicKey);
      if (invoice.renewal && invoice.publicKey !== body.publicKey) return reply(403, {});
      const expiryDate = new Date((prior ? Date.parse(prior.expiryDate) : Date.now()) + (state.noExtend ? 0 : 86400000)).toISOString();
      state.subscriptions.set(body.publicKey, { found: true, expiryDate, isEnabled: true, remainingData: 50, bandwidthAllotted: prior ? 100 : 50, bandwidthUsed: 0 });
      const raw = state.rawConfig || `[Interface]\nAddress = 10.0.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ${Buffer.alloc(32, 7).toString('base64')}\nPresharedKey = ${body.presharedKey}\nEndpoint = example.test:51820\nAllowedIPs = 0.0.0.0/0\n`;
      state.configs.set(body.paymentHash, raw);
      if (state.loseConfig) { state.loseConfig = false; throw new Error('lost response after creating tunnel'); }
      return reply(200, raw, true);
    }
    if (route.includes('/status/')) {
      if (state.statusError) return reply(503, {});
      const key = decodeURIComponent(route.split('/status/')[1]);
      return reply(200, { success: true, data: state.subscriptions.get(key) || { found: false } });
    }
    throw new Error('Unexpected request');
  } });
  const store = new Store(dir);
  const engine = new Engine({ store, supplier, payer });
  const run = id => engine.run(id, { live: true });
  const complete = async id => { await run(id); return run(id); };
  return { dir, state, payer, supplier, store, engine, run, complete };
}

module.exports = { fixture, catalogue };
