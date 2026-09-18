'use strict';
// Query shapes adapted from 13V/OTT; see NOTICE.md and LICENSE.
const { request, json, ServiceError } = require('./http');

class Blink {
  constructor({ apiKey = process.env.BLINK_API_KEY, walletId = process.env.BLINK_WALLET_ID, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.walletId = walletId;
    this.fetch = fetchImpl;
  }
  async gql(query, variables = {}, auth = true) {
    if (auth && !this.apiKey) throw new Error('BLINK_API_KEY is not configured');
    const r = await request('https://api.blink.sv/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'X-API-KEY': this.apiKey } : {}) },
      body: JSON.stringify({ query, variables }),
    }, this.fetch);
    if (r.status !== 200) throw new ServiceError('blink', r.status);
    const j = json(r.text);
    if (j.errors || !j.data) throw new ServiceError('blink', 200, 'GRAPHQL_ERROR');
    return j.data;
  }
  async capability() {
    const d = await this.gql('query { __type(name: "LnInvoicePaymentInput") { inputFields { name } } }', {}, false);
    return {
      hardCap: false,
      fields: d.__type?.inputFields?.map(f => f.name) || [],
      reason: 'Blink fee probes estimate cost; no verified server-enforced maximum total debit is implemented. Live spending is disabled.',
    };
  }
  async rate() {
    const d = await this.gql('query { realtimePrice(currency: "USD") { btcSatPrice { base offset } } }', {}, false);
    const p = d.realtimePrice?.btcSatPrice;
    const usdPerSat = Number(p?.base) / 10 ** Number(p?.offset) / 100;
    if (!Number.isFinite(usdPerSat) || usdPerSat <= 0) throw new Error('Invalid exchange-rate quote');
    return usdPerSat;
  }
  async getWalletId() {
    if (!this.walletId) throw new Error('BLINK_WALLET_ID must explicitly name the separately funded BTC test wallet');
    return this.walletId;
  }
  async sent(paymentHash) {
    const d = await this.gql('query ($walletId: WalletId!, $hash: PaymentHash!) { me { defaultAccount { walletById(walletId: $walletId) { transactionsByPaymentHash(paymentHash: $hash) { status direction settlementAmount settlementFee } } } } }', {
      walletId: await this.getWalletId(), hash: paymentHash,
    });
    const txs = d.me?.defaultAccount?.walletById?.transactionsByPaymentHash;
    if (!Array.isArray(txs)) throw new Error('Blink payment status unavailable');
    const sends = txs.filter(t => t.direction === 'SEND');
    if (!sends.length) return { status: 'NONE' };
    const rank = { SUCCESS: 3, PENDING: 2, FAILURE: 1 };
    const best = sends.reduce((a, b) => (rank[b.status] || 0) > (rank[a.status] || 0) ? b : a);
    if (best.settlementAmount == null || best.settlementFee == null) throw new Error('Blink debit unavailable');
    const sats = Math.abs(Number(best.settlementAmount));
    const feeSats = Math.abs(Number(best.settlementFee));
    if (!Number.isSafeInteger(sats) || !Number.isSafeInteger(feeSats)) throw new Error('Blink debit unavailable');
    return { status: best.status, sats, feeSats };
  }
  async pay() {
    // Intentional fail-closed gate. Never replace with a fee estimate or a CLI bypass.
    throw new Error('LIVE_PAYMENT_BLOCKED: Blink cannot enforce the required total-debit ceiling');
  }
}

module.exports = { Blink };
