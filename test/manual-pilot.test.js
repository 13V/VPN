'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { ManualPilot } = require('../src/manual-pilot');
const { encode } = require('../src/bolt11');

const now = Date.parse('2026-09-24T12:00:00Z');
const catalogue = { countries: [{ code: '19', isoCode: 'AU', name: 'Australia' }], durations: [{ unit: 'day', amount: 1, price: 0.5, duration: 0.5 }] };
const hash = 'ab'.repeat(32);
const quote = { paymentMethod: 'lightning', price: 0.5, duration: 0.5, paymentHash: hash,
  paymentRequest: encode({ sats: 500, paymentHash: hash, timestamp: now / 1000, expiry: 3600 }),
  expiresAt: new Date(now + 3600000).toISOString() };
const raw = `[Interface]\nAddress = 10.8.0.2/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = ${'A'.repeat(43)}=\nEndpoint = vpn.example:51820\nAllowedIPs = 0.0.0.0/0\n`;
function setup(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-manual-'));
  const calls = { quotes: 0, completions: 0 };
  const supplier = {
    catalogue: async () => catalogue,
    quote: async () => { calls.quotes++; return quote; },
    config: async () => { calls.completions++; return config ? config(calls.completions) : raw; },
    status: async () => ({ found: true, isEnabled: true, expiryDate: new Date(now + Math.max(1, calls.completions) * 86400000).toISOString(), bandwidthAllotted: 50 }),
  };
  const pilot = new ManualPilot({ store: new Store(dir), supplier, rates: { rate: async () => 0.001 }, now: () => now });
  return { pilot, calls, dir };
}

test('manual pilot creates only one validated invoice and saves a usable nadanada configuration', async t => {
  const { pilot, calls, dir } = setup(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal((await pilot.prepare('primary')).readOnly, true);
  assert.equal(calls.quotes, 0);
  assert.equal((await pilot.prepare('primary', true)).orders.primary.state, 'quoted');
  assert.equal(pilot.invoice('primary').sats, 500);
  assert.equal((await pilot.prepare('primary', true)).orders.primary.state, 'quoted');
  assert.equal(calls.quotes, 1);
  assert.equal((await pilot.collect('primary', true)).orders.primary.state, 'complete');
  assert.equal(calls.completions, 1);
  assert.equal((await pilot.collect('primary', true)).orders.primary.state, 'complete');
  assert.equal(calls.completions, 1);
  await pilot.export('primary', true);
  assert.match(fs.readFileSync(path.join(dir, 'primary.conf'), 'utf8'), /PrivateKey = /);
  await assert.rejects(() => pilot.export('primary', true), { code: 'EEXIST' });
});

test('payment pending and lost completion retry the saved invoice only', async t => {
  const { pilot, calls, dir } = setup(n => {
    if (n === 1) throw Object.assign(new Error('pending'), { status: 402 });
    if (n === 2) throw Object.assign(new Error('uncertain'), { status: 0 });
    return raw;
  }); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await pilot.prepare('primary', true);
  assert.equal((await pilot.collect('primary', true)).orders.primary.state, 'payment_pending');
  assert.equal((await pilot.collect('primary', true)).orders.primary.state, 'config_unknown');
  assert.throws(() => pilot.invoice('primary'), /never pay an uncertain order again/);
  assert.equal((await pilot.collect('primary', true)).orders.primary.state, 'complete');
  assert.equal(calls.quotes, 1);
});

test('a supplier 409 leaves paid delivery unrecoverable without replacement invoice', async t => {
  const { pilot, calls, dir } = setup(() => { throw Object.assign(new Error('already generated'), { status: 409 }); });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await pilot.prepare('primary', true);
  assert.equal((await pilot.collect('primary', true)).orders.primary.state, 'config_unrecoverable');
  await assert.rejects(() => pilot.collect('primary', true), /No recoverable validated order/);
  assert.equal(calls.quotes, 1);
});

test('manual pilot discards one recovery response and retrieves the same paid order on retry', async t => {
  const { pilot, calls, dir } = setup();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await pilot.prepare('primary', true);
  await pilot.collect('primary', true);
  await pilot.prepare('renewal', true);
  assert.equal((await pilot.collect('renewal', true)).orders.renewal.state, 'complete');
  assert.equal((await pilot.prepare('recovery')).readOnly, true);
  assert.equal((await pilot.prepare('recovery', true)).orders.recovery.state, 'quoted');
  assert.notEqual(pilot.summary().orders.primary.publicKey, pilot.summary().orders.recovery.publicKey);
  assert.equal((await pilot.collect('recovery', true)).orders.recovery.state, 'config_unknown');
  assert.equal(pilot.store.read().orders.recovery.rawConfig, undefined);
  assert.throws(() => pilot.invoice('recovery'), /never pay an uncertain order again/);
  assert.equal(pilot.summary().orders.recovery.discardAttempted, true);
  assert.equal((await pilot.collect('recovery', true)).orders.recovery.state, 'complete');
  assert.equal(calls.quotes, 3);
  assert.equal((await pilot.replay('recovery')).readOnly, true);
  assert.equal((await pilot.replay('recovery', true)).orders.recovery.replay, 'same_configuration');
  assert.equal(calls.quotes, 3);
});

test('pending recovery payment does not consume the deliberate response discard', async t => {
  const { pilot, calls, dir } = setup(n => {
    if (n === 3) throw Object.assign(new Error('pending'), { status: 402 });
    if (n === 5) throw Object.assign(new Error('already generated'), { status: 409 });
    return raw;
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await pilot.prepare('primary', true);
  await pilot.collect('primary', true);
  await pilot.prepare('renewal', true);
  await pilot.collect('renewal', true);
  await pilot.prepare('recovery', true);
  assert.equal((await pilot.collect('recovery', true)).orders.recovery.state, 'payment_pending');
  assert.equal(pilot.summary().orders.recovery.discardAttempted, false);
  assert.equal((await pilot.collect('recovery', true)).orders.recovery.state, 'config_unknown');
  assert.equal((await pilot.collect('recovery', true)).orders.recovery.state, 'config_unrecoverable');
  assert.equal(calls.quotes, 3);
  assert.equal(pilot.store.read().orders.recovery.rawConfig, undefined);
});

test('replay records supplier 409 without losing a complete tunnel', async t => {
  const { pilot, calls, dir } = setup(n => {
    if (n === 2) throw Object.assign(new Error('already generated'), { status: 409 });
    return raw;
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await pilot.prepare('primary', true);
  await pilot.collect('primary', true);
  assert.equal((await pilot.replay('primary', true)).orders.primary.replay, 'refused_409');
  assert.equal(pilot.summary().orders.primary.state, 'complete');
  assert.equal(calls.quotes, 1);
});
