'use strict';
const bolt11 = require('./bolt11');
const wg = require('./wireguard');

const IDS = ['primary', 'renewal', 'recovery'];
function selectPlan(catalogue) {
  const country = catalogue.countries?.find(c => c.isoCode === 'AU');
  const plan = catalogue.durations?.find(p => p.unit === 'day' && p.amount === 1);
  if (!country || !plan || plan.price !== 0.5 || plan.duration !== 0.5) throw new Error('CATALOGUE_CHANGED: Australia and the $0.50 one-day selector are required');
  return { country, plan };
}

function validateInvoice(quote, rate, now = Date.now()) {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid price quote');
  if (quote.price !== 0.5 || quote.duration !== 0.5 || quote.paymentMethod !== 'lightning') throw new Error('Supplier quote does not match the approved plan');
  const invoice = bolt11.decode(quote.paymentRequest);
  if (invoice.prefix !== 'bc' || !invoice.msat || BigInt(invoice.msat) <= 0n) throw new Error('A fixed mainnet invoice amount is required');
  if (invoice.paymentHash !== quote.paymentHash || !/^[a-f0-9]{64}$/.test(quote.paymentHash)) throw new Error('Invoice payment hash mismatch');
  if (!Number.isFinite(invoice.expiresAt) || invoice.expiresAt * 1000 <= now + 30000 || Date.parse(quote.expiresAt) <= now + 30000 || !Number.isFinite(Date.parse(quote.expiresAt))) throw new Error('Invoice expired or too close to expiry');
  const sats = Number((BigInt(invoice.msat) + 999n) / 1000n);
  const expected = 0.5 / rate;
  // Independent BTC/USD sources can differ; never grant more than the frozen campaign cap.
  if (!Number.isSafeInteger(sats) || Math.abs(sats - expected) > Math.max(2, expected * 0.05)) throw new Error('Invoice amount differs from catalogue price by more than 5%');
  return sats;
}

function redactedStatus(s) {
  if (!s || typeof s.found !== 'boolean') throw new Error('Malformed subscription status');
  const out = { found: s.found };
  if (s.found) {
    if (!Number.isFinite(Date.parse(s.expiryDate)) || typeof s.isEnabled !== 'boolean') throw new Error('Malformed subscription status');
    out.expiryDate = s.expiryDate; out.enabled = s.isEnabled;
    for (const k of ['remainingData', 'bandwidthUsed', 'bandwidthAllotted']) {
      if (Number.isFinite(s[k])) out[k] = s[k];
    }
  }
  return out;
}

function summary(state) {
  return {
    campaign: state.campaign && {
      createdAt: state.campaign.createdAt, usdCeiling: 2,
      quotedUsdPerSat: state.campaign.rate, capSats: state.campaign.capSats,
      committedSats: Object.values(state.orders).reduce((n, o) => n + (o.actualSats ?? o.reservedSats ?? 0), 0),
    },
    orders: Object.fromEntries(Object.entries(state.orders).map(([id, o]) => [id, {
      state: o.state, kind: o.kind, country: o.country.isoCode,
      actualSats: o.actualSats, reservedSats: o.reservedSats,
      lastEvent: o.lastEvent, before: o.before, after: o.after,
      renewalVerified: o.renewalVerified, replay: o.replay,
    }])),
  };
}

class Engine {
  constructor({ store, supplier, payer, now = () => Date.now() }) {
    this.store = store; this.supplier = supplier; this.payer = payer; this.now = now;
  }
  async preflight() {
    const catalogue = await this.supplier.catalogue();
    const selection = selectPlan(catalogue);
    const capability = await this.payer.capability();
    const rate = await this.payer.rate();
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid exchange-rate quote');
    return { checkedAt: new Date(this.now()).toISOString(), selection, capability, usdPerSat: rate, proposedCapSats: Math.floor(2 / rate) };
  }
  async run(id, { live = false } = {}) {
    if (!IDS.includes(id)) throw new Error('Unknown scenario; use primary, renewal, or recovery');
    if (!live) return { readOnly: true, next: id, ...(await this.preflight()), ...summary(this.store.read()) };
    return this.store.locked(async () => {
      const state = this.store.read();
      const save = (o, next, event) => {
        o.state = next; o.lastEvent = event; o.updatedAt = new Date(this.now()).toISOString(); this.store.save(state);
      };
      let o = state.orders[id];
      if (!o) {
        const pf = await this.preflight();
        if (!pf.capability.hardCap) throw new Error('LIVE_PAYMENT_BLOCKED: no verified server-enforced debit cap');
        if (state.campaign?.breached) throw new Error('Campaign budget breach; stopped');
        if (id !== 'primary' && state.orders.primary?.state !== 'complete') throw new Error('Complete the primary purchase first');
        if (id === 'recovery' && state.orders.renewal?.state !== 'complete') throw new Error('Complete the renewal before the recovery scenario');
        if (!state.campaign) state.campaign = { rate: pf.usdPerSat, capSats: pf.proposedCapSats, createdAt: pf.checkedAt };
        o = {
          id, kind: id === 'renewal' ? 'renewal' : 'purchase',
          ...pf.selection, keys: id === 'renewal' ? { ...state.orders.primary.keys } : wg.keys(),
          state: 'created', createdAt: pf.checkedAt,
        };
        if (id === 'renewal') {
          o.before = redactedStatus(await this.supplier.status(o.keys.publicKey));
          if (!o.before.found || !o.before.enabled) throw new Error('Primary subscription must be active before renewal');
        }
        state.orders[id] = o; this.store.save(state);
      }
      if (['complete', 'failed', 'quote_unknown', 'quote_rejected', 'config_unrecoverable', 'budget_breach'].includes(o.state)) return summary(state);

      if (o.state === 'created') {
        selectPlan(await this.supplier.catalogue());
        if (!(await this.payer.capability()).hardCap) throw new Error('LIVE_PAYMENT_BLOCKED: no verified server-enforced debit cap');
        save(o, 'quote_requesting', 'Requesting one invoice');
        try {
          o.quote = await this.supplier.quote(o);
          save(o, 'quoted', 'Invoice recorded; unpaid');
        } catch {
          save(o, 'quote_unknown', 'Invoice request failed or was ambiguous; no automatic replacement');
          return summary(state);
        }
      } else if (o.state === 'quote_requesting') {
        save(o, 'quote_unknown', 'Interrupted invoice request; no automatic replacement');
        return summary(state);
      }

      if (['quoted', 'payment_sending', 'payment_unknown', 'payment_pending'].includes(o.state)) {
        let payment;
        try { payment = await this.payer.sent(o.quote.paymentHash); }
        catch {
          // Preserve quoted when no send was attempted so a later read can safely proceed.
          save(o, o.state, 'Payment reconciliation unavailable; no send attempted');
          return summary(state);
        }
        if (payment.status === 'SUCCESS') {
          if (!Number.isSafeInteger(payment.sats) || payment.sats <= 0 || !Number.isSafeInteger(payment.feeSats) || payment.feeSats < 0 || !o.reservedSats) {
            save(o, 'payment_unknown', 'Confirmed payment lacks a verifiable reserved debit'); return summary(state);
          }
          o.actualSats = payment.sats + payment.feeSats;
          if (o.actualSats > o.reservedSats) {
            state.campaign.breached = true; save(o, 'budget_breach', 'Payer exceeded its enforced reservation'); return summary(state);
          }
          save(o, 'paid', 'Payment confirmed including routing fee');
        } else if (payment.status === 'FAILURE') {
          save(o, 'failed', 'Payment rejected; no automatic replacement'); return summary(state);
        } else if (payment.status === 'PENDING') {
          save(o, 'payment_pending', 'Payment pending; reservation retained'); return summary(state);
        } else if (payment.status !== 'NONE' || o.state !== 'quoted') {
          save(o, 'payment_unknown', 'No conclusive result after attempted send; never resend automatically'); return summary(state);
        } else {
          if (state.campaign.breached) throw new Error('Campaign budget breach; stopped');
          if (!(await this.payer.capability()).hardCap) throw new Error('LIVE_PAYMENT_BLOCKED: no verified server-enforced debit cap');
          try {
            selectPlan(await this.supplier.catalogue());
            const rate = await this.payer.rate();
            o.invoiceSats = validateInvoice(o.quote, rate, this.now());
          } catch {
            save(o, 'quote_rejected', 'Catalogue or invoice validation failed; nothing paid'); return summary(state);
          }
          const used = Object.entries(state.orders).filter(([k]) => k !== id).reduce((n, [, v]) => n + (v.actualSats ?? v.reservedSats ?? 0), 0);
          // Reserve invoice + up to $0.10 routing fees at the campaign's frozen quote.
          o.reservedSats = o.invoiceSats + Math.floor(0.10 / state.campaign.rate);
          if (used + o.reservedSats > state.campaign.capSats) {
            delete o.reservedSats; save(o, 'quote_rejected', 'Campaign cap would be exceeded'); return summary(state);
          }
          save(o, 'payment_sending', 'Debit reserved and send intent persisted');
          try {
            const result = await this.payer.pay({ paymentRequest: o.quote.paymentRequest, maxTotalSats: o.reservedSats });
            save(o, result.status === 'FAILURE' ? 'failed' : 'payment_pending', 'Reconcile payment before retrieving configuration');
          } catch { save(o, 'payment_unknown', 'Send response ambiguous; reservation retained'); }
          return summary(state); // A separate resume always reconciles against the wallet.
        }
      }

      if (o.rawConfig && o.state !== 'complete') {
        try { o.config = wg.config(o.rawConfig, o.keys); }
        catch { save(o, 'config_invalid', 'Response saved locally but failed configuration validation'); return summary(state); }
        save(o, 'configured', 'Configuration durably saved');
      } else if (['paid', 'config_requesting', 'config_unknown'].includes(o.state)) {
        // If we crash here, resume repeats only completion, never payment.
        const discard = id === 'recovery' && !o.discardAttempted;
        if (discard) o.discardAttempted = true;
        save(o, 'config_requesting', discard ? 'Fault injection: discard first response' : 'Retrieving configuration');
        try {
          const raw = await this.supplier.config(o);
          if (discard) {
            save(o, 'config_unknown', 'First completion response deliberately discarded'); return summary(state);
          }
          o.rawConfig = raw; save(o, 'config_received', 'Raw response durably saved before parsing');
          o.config = wg.config(raw, o.keys); save(o, 'configured', 'Configuration durably saved');
        } catch (e) {
          const next = o.rawConfig ? 'config_invalid' : e.status === 402 ? 'paid' : e.status === 409 ? 'config_unrecoverable' : 'config_unknown';
          save(o, next, e.status === 409 ? 'Supplier refused repeat delivery; automatic recovery not established' : 'Completion unresolved; no replacement payment');
          return summary(state);
        }
      }
      if (o.state === 'configured') {
        try {
          o.after = redactedStatus(await this.supplier.status(o.keys.publicKey));
          if (!o.after.found || !o.after.enabled) throw new Error('Not active');
          if (o.kind === 'renewal') {
            o.renewalVerified = Date.parse(o.after.expiryDate) > Date.parse(o.before.expiryDate);
            if (!o.renewalVerified) throw new Error('Expiry not increased');
          }
          save(o, 'complete', 'Configuration saved and active subscription verified');
        } catch { save(o, 'configured', 'Configuration saved; subscription verification unresolved'); }
      }
      return summary(state);
    });
  }
  async status(id) {
    const state = this.store.read();
    if (!id) return summary(state);
    const o = state.orders[id]; if (!o) throw new Error('Scenario has not been started');
    return { id, state: o.state, subscription: redactedStatus(await this.supplier.status(o.keys.publicKey)) };
  }
  async replay(id, { live = false } = {}) {
    if (!live) return { readOnly: true, action: 'Repeat supplier completion only; never pay', ...(await this.status(id)) };
    return this.store.locked(async () => {
      const state = this.store.read(), o = state.orders[id];
      if (o?.state !== 'complete') throw new Error('Replay requires a complete order');
      try {
        const raw = await this.supplier.config(o);
        o.replay = wg.config(raw, o.keys) === o.config ? 'same_configuration' : 'different_configuration';
      } catch (e) { o.replay = e.status === 409 ? 'refused_409' : 'unresolved'; }
      this.store.save(state); return summary(state);
    });
  }
}

module.exports = { Engine, selectPlan, validateInvoice, summary, redactedStatus };
