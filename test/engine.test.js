'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, catalogue } = require('./helpers');
const { Engine } = require('../src/engine');

test('dry run performs only read calls, creates no journal and never pays', async t => {
  const f = fixture(t);
  const result = await f.engine.run('primary');
  assert.equal(result.readOnly, true); assert.equal(f.state.pays, 0);
  assert.equal(f.store.read().campaign, null);
  assert.ok(f.state.requests.every(r => r.body === null));
});

test('purchase survives restart after payment and saves local-key configuration', async t => {
  const f = fixture(t);
  assert.equal((await f.run('primary')).orders.primary.state, 'payment_pending');
  const restarted = new Engine({ store: f.store, supplier: f.supplier, payer: f.payer });
  const result = await restarted.run('primary', { live: true });
  assert.equal(result.orders.primary.state, 'complete');
  const o = f.store.read().orders.primary;
  assert.ok(o.config.includes(o.keys.privateKey));
  assert.ok(!JSON.stringify(f.state.requests).includes(o.keys.privateKey));
  assert.ok(!JSON.stringify(result).includes(o.quote.paymentHash));
  assert.ok(!JSON.stringify(result).includes(o.keys.publicKey));
  await f.run('primary'); assert.equal(f.state.pays, 1);
});

test('renewal uses the same public key and verifies increased expiry', async t => {
  const f = fixture(t); await f.complete('primary');
  const result = await f.complete('renewal');
  assert.equal(result.orders.renewal.state, 'complete');
  assert.equal(result.orders.renewal.renewalVerified, true);
  const s = f.store.read(); assert.equal(s.orders.primary.keys.publicKey, s.orders.renewal.keys.publicKey);
  assert.equal(f.state.pays, 2);
});

test('unchanged renewal expiry is not reported as verified', async t => {
  const f = fixture(t); await f.complete('primary'); f.state.noExtend = true;
  const result = await f.complete('renewal');
  assert.equal(result.orders.renewal.state, 'configured');
  assert.equal(result.orders.renewal.renewalVerified, false);
});

test('configuration lost after supplier fulfilment becomes unrecoverable on 409, without another payment', async t => {
  const f = fixture(t, { loseConfig: true }); await f.run('primary');
  assert.equal((await f.run('primary')).orders.primary.state, 'config_unknown');
  assert.equal((await f.run('primary')).orders.primary.state, 'config_unrecoverable');
  await f.run('primary'); assert.equal(f.state.pays, 1);
  assert.equal(f.store.read().orders.primary.rawConfig, undefined);
});

test('deliberate recovery scenario discards first response; repeatable supplier recovers', async t => {
  const f = fixture(t, { repeatable: true }); await f.complete('primary'); await f.complete('renewal');
  await f.run('recovery');
  assert.equal((await f.run('recovery')).orders.recovery.state, 'config_unknown');
  assert.equal(f.store.read().orders.recovery.rawConfig, undefined);
  assert.equal((await f.run('recovery')).orders.recovery.state, 'complete');
  assert.equal(f.state.pays, 3);
});

test('deliberate recovery scenario records refusal on a one-time supplier', async t => {
  const f = fixture(t); await f.complete('primary'); await f.complete('renewal');
  await f.complete('recovery');
  assert.equal((await f.run('recovery')).orders.recovery.state, 'config_unrecoverable');
  assert.equal(f.state.pays, 3);
});

test('replay records 409 without losing the saved configuration', async t => {
  const f = fixture(t); await f.complete('primary');
  assert.equal((await f.engine.replay('primary', { live: true })).orders.primary.replay, 'refused_409');
  assert.ok(f.store.read().orders.primary.config); assert.equal(f.state.pays, 1);
});

test('replay identifies identical configuration', async t => {
  const f = fixture(t, { repeatable: true }); await f.complete('primary');
  assert.equal((await f.engine.replay('primary', { live: true })).orders.primary.replay, 'same_configuration');
});

for (const paymentState of ['PENDING', 'FAILURE']) test(`${paymentState} payments never trigger replacement or configuration`, async t => {
  const f = fixture(t, { paymentState }); await f.run('primary'); await f.run('primary'); await f.run('primary');
  assert.equal(f.state.pays, 1); assert.equal(f.state.configs.size, 0);
});

test('lost payment response is reconciled successfully without resending', async t => {
  const f = fixture(t, { throwAfterPay: true }); await f.run('primary');
  assert.equal((await f.run('primary')).orders.primary.state, 'complete'); assert.equal(f.state.pays, 1);
});

test('NONE after attempted send is ambiguous and never causes resend', async t => {
  const f = fixture(t, { throwAfterPay: true, forgetPayment: true }); await f.run('primary');
  assert.equal((await f.run('primary')).orders.primary.state, 'payment_unknown');
  await f.run('primary'); assert.equal(f.state.pays, 1);
});

test('reconciliation outage prevents payment', async t => {
  const f = fixture(t, { reconcileError: true }); await f.run('primary');
  assert.equal(f.state.pays, 0); assert.equal(f.store.read().orders.primary.state, 'quoted');
});

for (const [name, options] of [
  ['expired', { invoiceOverrides: { timestamp: 1 } }],
  ['amount mismatch', { invoiceOverrides: { sats: 99999 } }],
  ['hash mismatch', { quoteOverrides: { paymentHash: 'a'.repeat(64) } }],
  ['price mismatch', { quoteOverrides: { price: 0.6 } }],
  ['testnet', { invoiceOverrides: { prefix: 'tb' } }],
  ['amountless', { invoiceOverrides: { sats: null } }],
]) test(`${name} invoice is rejected before payment`, async t => {
  const f = fixture(t, options);
  assert.equal((await f.run('primary')).orders.primary.state, 'quote_rejected');
  assert.equal(f.state.pays, 0);
});

test('supplier error stops before sending money', async t => {
  const f = fixture(t, { supplierError: true }); await assert.rejects(f.run('primary'));
  assert.equal(f.state.pays, 0);
});

test('ambiguous quote creation does not create another invoice', async t => {
  const f = fixture(t, { quoteError: true }); await f.run('primary'); await f.run('primary');
  assert.equal(f.state.requests.filter(r => r.route.endsWith('/request')).length, 1);
  assert.equal(f.store.read().orders.primary.state, 'quote_unknown');
});

for (const name of ['missing Australia', 'repriced day']) test(`catalogue change: ${name}`, async t => {
  const c = catalogue(); if (name === 'missing Australia') c.countries = []; else c.durations[0].price = 0.6;
  const f = fixture(t, { catalogue: c }); await assert.rejects(f.run('primary'), /CATALOGUE_CHANGED/);
  assert.equal(f.state.pays, 0); assert.equal(f.state.invoices.size, 0);
});

test('missing enforced cap blocks even invoice creation', async t => {
  const f = fixture(t, { cap: false }); await assert.rejects(f.run('primary'), /LIVE_PAYMENT_BLOCKED/);
  assert.equal(f.state.invoices.size, 0); assert.equal(f.state.pays, 0);
});

test('campaign refuses a reservation exceeding frozen total cap', async t => {
  const f = fixture(t); await f.complete('primary');
  const s = f.store.read(); s.campaign.capSats = 1100; f.store.save(s);
  assert.equal((await f.run('renewal')).orders.renewal.state, 'quote_rejected');
  assert.equal(f.state.pays, 1);
});

test('reported debit above reservation freezes campaign', async t => {
  const f = fixture(t); await f.run('primary');
  const o = f.store.read().orders.primary;
  f.state.payments.set(o.quote.paymentHash, { status: 'SUCCESS', sats: 1000, feeSats: 999 });
  assert.equal((await f.run('primary')).orders.primary.state, 'budget_breach');
  assert.equal(f.store.read().campaign.breached, true);
});

test('configuration command injection is rejected and raw response retained privately', async t => {
  const f = fixture(t, { rawConfig: '[Interface]\nPostUp = malicious-command\n[Peer]\n' });
  await f.run('primary'); assert.equal((await f.run('primary')).orders.primary.state, 'config_invalid');
  assert.ok(f.store.read().orders.primary.rawConfig); assert.equal(f.state.pays, 1);
});

test('status outage after delivery preserves config and retries status only', async t => {
  const f = fixture(t); await f.run('primary'); f.state.statusError = true;
  assert.equal((await f.run('primary')).orders.primary.state, 'configured');
  f.state.statusError = false; assert.equal((await f.run('primary')).orders.primary.state, 'complete');
  assert.equal(f.state.requests.filter(r => r.route.endsWith('/config')).length, 1);
});

test('unknown IDs and out-of-order scenarios are rejected', async t => {
  const f = fixture(t); await assert.rejects(f.run('../bad'), /Unknown scenario/);
  await assert.rejects(f.run('renewal'), /primary/);
});
