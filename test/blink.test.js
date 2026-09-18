'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Blink } = require('../src/blink');

test('Blink schema inspection does not infer enforcement from an unverified field', async () => {
  let calls = 0;
  const b = new Blink({ fetchImpl: async () => { calls++; return new Response(JSON.stringify({ data: { __type: { inputFields: [{ name: 'maxFee' }] } } })); } });
  assert.equal((await b.capability()).hardCap, false);
  await assert.rejects(b.pay({ paymentRequest: 'secret', maxTotalSats: 1 }), /LIVE_PAYMENT_BLOCKED/);
  assert.equal(calls, 1);
});

test('Blink GraphQL errors are redacted even with HTTP 200', async () => {
  const b = new Blink({ fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: 'secret-invoice' }] })) });
  await assert.rejects(b.rate(), e => !e.message.includes('secret-invoice') && e.code === 'GRAPHQL_ERROR');
});

test('Blink payment reconciliation prefers confirmed send and includes fees', async () => {
  const b = new Blink({ apiKey: 'fake', walletId: 'test', fetchImpl: async () => new Response(JSON.stringify({ data: { me: { defaultAccount: { walletById: { transactionsByPaymentHash: [
    { direction: 'SEND', status: 'FAILURE', settlementAmount: 100, settlementFee: 0 },
    { direction: 'SEND', status: 'SUCCESS', settlementAmount: -100, settlementFee: 3 },
  ] } } } } })) });
  assert.deepEqual(await b.sent('test-hash'), { status: 'SUCCESS', sats: 100, feeSats: 3 });
});

test('missing Blink transaction list is not interpreted as unpaid', async () => {
  const b = new Blink({ apiKey: 'fake', walletId: 'test', fetchImpl: async () => new Response(JSON.stringify({ data: {} })) });
  await assert.rejects(b.sent('test'), /unavailable/);
});
