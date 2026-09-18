'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Store } = require('../src/store');
const { fixture } = require('./helpers');

test('process-wide exclusive lock prevents a second process accessing the campaign', async t => {
  const { store, dir } = fixture(t);
  await store.locked(async () => {
    const child = spawnSync(process.execPath, ['-e', "const {Store}=require('./src/store'); new Store(process.argv[1]).locked(async()=>{}).catch(()=>process.exit(12))", dir], { cwd: path.resolve(__dirname, '..') });
    assert.equal(child.status, 12);
    await assert.rejects(new Store(dir).locked(async () => {}), /locked/);
  });
  await store.locked(async () => {});
});

test('atomic journal survives reopening, corrupted journal fails closed', async t => {
  const { store, dir } = fixture(t);
  await store.locked(async () => store.save({ version: 1, campaign: null, orders: {} }));
  assert.deepEqual(new Store(dir).read().orders, {});
  assert.equal(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')).length, 0);
  fs.writeFileSync(store.file, 'broken'); assert.throws(() => store.read());
});

test('existing crash lock is never automatically broken', async t => {
  const { store, dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'campaign.lock'), '{"pid":1}');
  await assert.rejects(store.locked(async () => {}), /locked/);
  assert.ok(fs.existsSync(path.join(dir, 'campaign.lock')));
});
