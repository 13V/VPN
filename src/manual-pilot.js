'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { Store, defaultDir } = require('./store');
const { Nadanada } = require('./nadanada');
const { Blink } = require('./blink');
const { selectPlan, validateInvoice, redactedStatus } = require('./engine');
const wg = require('./wireguard');

// An operator can pay an invoice in a separate Lightning wallet. This code never
// sends a payment, and cannot enforce that wallet's fee or total-debit limit.
class ManualPilot {
  constructor({ store = new Store(path.join(defaultDir(), 'manual-pilot')), supplier = new Nadanada(), rates = new Blink(), now = Date.now } = {}) {
    this.store = store; this.supplier = supplier; this.rates = rates; this.now = now;
  }
  summary() {
    const state = this.store.read();
    return { paymentMode: 'external_manual_lightning', orders: Object.fromEntries(Object.entries(state.orders).map(([id, o]) => [id, {
      state: o.state, createdAt: o.createdAt, invoiceExpiresAt: o.quote?.expiresAt,
      invoiceSats: o.invoiceSats, publicKey: o.keys.publicKey,
      before: o.before, after: o.after, lastEvent: o.lastEvent,
    }])) };
  }
  async prepare(id, live = false) {
    if (!['primary', 'renewal'].includes(id)) throw new Error('Use primary or renewal');
    if (!live) return { readOnly: true, action: `prepare ${id} --live creates one nadanada invoice but does not pay it`, ...this.summary() };
    return this.store.locked(async () => {
      const state = this.store.read();
      if (state.orders[id]) return this.summary();
      if (id === 'renewal' && state.orders.primary?.state !== 'complete') throw new Error('Complete the primary tunnel before renewal');
      const { country, plan } = selectPlan(await this.supplier.catalogue());
      const keys = id === 'renewal' ? { ...state.orders.primary.keys } : wg.keys();
      let before;
      if (id === 'renewal') {
        before = redactedStatus(await this.supplier.status(keys.publicKey));
        if (!before.found || !before.enabled) throw new Error('The primary tunnel is not active');
      }
      const o = state.orders[id] = { id, kind: id === 'renewal' ? 'renewal' : 'purchase', country, plan, keys, before,
        state: 'quote_requesting', createdAt: new Date(this.now()).toISOString(), lastEvent: 'Requesting one invoice' };
      this.store.save(state); // A lost invoice response must never create an automatic replacement.
      try {
        o.quote = await this.supplier.quote(o);
        const rate = await this.rates.rate();
        selectPlan(await this.supplier.catalogue());
        o.invoiceSats = validateInvoice(o.quote, rate, this.now());
        o.quotedUsdPerSat = rate;
        o.state = 'quoted'; o.lastEvent = 'Validated invoice saved; pay only from an independently limited test wallet';
      } catch (e) {
        o.state = o.quote ? 'quote_rejected' : 'quote_unknown';
        o.lastEvent = o.quote ? 'Invoice or catalogue validation failed; do not pay' : 'Invoice request outcome unknown; do not request a replacement';
      }
      this.store.save(state);
      return this.summary();
    });
  }
  invoice(id) {
    const o = this.store.read().orders[id];
    if (!o || !['quoted', 'payment_pending', 'config_unknown'].includes(o.state)) throw new Error('No validated invoice is available for this order');
    if (Date.parse(o.quote.expiresAt) <= this.now() + 30000) throw new Error('Invoice has expired; do not pay or create a replacement automatically');
    return { id, paymentRequest: o.quote.paymentRequest, sats: o.invoiceSats, expiresAt: o.quote.expiresAt,
      warning: 'Pay only in a separate test wallet whose balance and fee limit you control. This CLI cannot cap that wallet’s debit.' };
  }
  async collect(id, live = false) {
    if (!['primary', 'renewal'].includes(id)) throw new Error('Use primary or renewal');
    if (!live) return { readOnly: true, action: `collect ${id} --live attempts the same saved payment completion; it never creates or pays another invoice`, ...this.summary() };
    return this.store.locked(async () => {
      const state = this.store.read(), o = state.orders[id];
      if (!o || !['quoted', 'payment_pending', 'config_requesting', 'config_unknown', 'config_received', 'configured', 'complete'].includes(o.state)) throw new Error('No recoverable validated order exists');
      if (o.state === 'complete') return this.summary();
      if (!o.rawConfig) {
        o.state = 'config_requesting'; o.lastEvent = 'Completing saved invoice; no new payment'; this.store.save(state);
        try {
          o.rawConfig = await this.supplier.config(o);
          o.state = 'config_received'; o.lastEvent = 'Configuration response durably saved'; this.store.save(state);
        } catch (e) {
          o.state = e.status === 402 ? 'payment_pending' : e.status === 409 ? 'config_unrecoverable' : 'config_unknown';
          o.lastEvent = e.status === 402 ? 'Payment is not confirmed' : e.status === 409 ? 'Supplier refused repeat delivery; manual recovery required' : 'Completion uncertain; retry this same order only';
          this.store.save(state); return this.summary();
        }
      }
      try { o.config = wg.config(o.rawConfig, o.keys); o.state = 'configured'; o.lastEvent = 'Usable configuration saved locally'; this.store.save(state); }
      catch { o.state = 'config_invalid'; o.lastEvent = 'Supplier configuration failed validation'; this.store.save(state); return this.summary(); }
      try {
        o.after = redactedStatus(await this.supplier.status(o.keys.publicKey));
        if (!o.after.found || !o.after.enabled || (id === 'renewal' && Date.parse(o.after.expiryDate) <= Date.parse(o.before.expiryDate))) throw new Error('Subscription not active or expiry did not advance');
        o.state = 'complete'; o.lastEvent = 'Configuration saved and subscription verified'; this.store.save(state);
      } catch { o.lastEvent = 'Configuration saved; subscription status unresolved'; this.store.save(state); }
      return this.summary();
    });
  }
  async export(id, live = false) {
    if (!live) return { readOnly: true, action: 'Use export ID --live to write the private WireGuard file outside Git' };
    return this.store.locked(async () => {
      const o = this.store.read().orders[id];
      if (!o?.config) throw new Error('No saved configuration');
      fs.writeFileSync(path.join(this.store.dir, `${id}.conf`), o.config, { mode: 0o600, flag: 'wx' });
      return { exported: true, location: path.join(this.store.dir, `${id}.conf`) };
    });
  }
}

module.exports = { ManualPilot };
