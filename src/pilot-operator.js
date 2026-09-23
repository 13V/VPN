'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('./store');
const { VPNresellers } = require('./vpnresellers');
const { issueGrant } = require('../portal/pilot-access');

const walletPattern = /^0x[0-9a-fA-F]{40}$/;
const defaultDir = () => process.env.VPN_PILOT_STATE_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), '13V', 'VPN-pilot');

class PilotStore extends Store {
  constructor(dir = defaultDir()) { super(dir); this.file = path.join(this.dir, 'pilot.json'); }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, accounts: {} };
    const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (state.version !== 1 || !state.accounts || Array.isArray(state.accounts)) throw new Error('Invalid pilot journal; refusing to reset');
    return state;
  }
}

function expiryDate(now, days = 1) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 7) throw new Error('Pilot expiry must be 1–7 days');
  const day = new Date(now); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() + days + 1);
  return day.toISOString().slice(0, 10);
}

function accountName(wallet) {
  if (!walletPattern.test(wallet)) throw new Error('A valid wallet address is required');
  return `velora-${crypto.createHash('sha256').update(wallet.toLowerCase()).digest('hex').slice(0, 24)}`;
}

function summary(state) {
  return { accounts: Object.fromEntries(Object.entries(state.accounts).map(([wallet, a]) => [wallet, {
    state: a.state, username: a.username, serverId: a.serverId, accountId: a.accountId || null,
    expiresOn: a.expiresOn, lastEvent: a.lastEvent,
  }])) };
}

class PilotOperator {
  constructor({ store = new PilotStore(), supplier = new VPNresellers(), now = Date.now, maxAccounts = 1 } = {}) {
    if (!Number.isSafeInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 3) throw new Error('Pilot account cap must be 1–3');
    this.store = store; this.supplier = supplier; this.now = now; this.maxAccounts = maxAccounts;
  }

  async preflight() {
    const [profile, servers] = await Promise.all([this.supplier.profile(), this.supplier.australiaServers()]);
    return { checkedAt: new Date(this.now()).toISOString(), creditUsd: profile.balance,
      australiaServers: servers, maxAccounts: this.maxAccounts,
      costControl: 'Fixed account count and expiry; supplier bills daily from prepaid credit. No per-account spend cap is claimed.' };
  }

  async start(wallet, { live = false, serverId } = {}) {
    if (!walletPattern.test(wallet)) throw new Error('A valid wallet address is required');
    if (!live) return { readOnly: true, preflight: await this.preflight(), ...summary(this.store.read()) };
    return this.store.locked(async () => {
      const state = this.store.read(), address = wallet.toLowerCase();
      if (state.accounts[address]) return this.#resumeLocked(state, address);
      if (Object.keys(state.accounts).length >= this.maxAccounts) throw new Error('Pilot account cap reached');
      const pf = await this.preflight();
      if (pf.creditUsd < 2 || pf.australiaServers.length === 0) throw new Error('Pilot requires at least $2 prepaid credit and an Australia server');
      const server = serverId === undefined ? pf.australiaServers[0] : pf.australiaServers.find(s => s.id === serverId);
      if (!server) throw new Error('Selected Australia server is unavailable');
      state.accounts[address] = { username: accountName(address), password: crypto.randomBytes(24).toString('base64url'),
        serverId: server.id, expiresOn: expiryDate(this.now()), state: 'create_intent',
        lastEvent: 'Create intent saved before supplier request', createdAt: new Date(this.now()).toISOString() };
      this.store.save(state);
      return this.#resumeLocked(state, address, true);
    });
  }

  async resume(wallet) {
    if (!walletPattern.test(wallet)) throw new Error('A valid wallet address is required');
    return this.store.locked(() => this.#resumeLocked(this.store.read(), wallet.toLowerCase()));
  }

  async #resumeLocked(state, address, firstAttempt = false) {
    const a = state.accounts[address];
    if (!a) throw new Error('No pilot account intent exists for this wallet');
    const save = (next, event) => { a.state = next; a.lastEvent = event; a.updatedAt = new Date(this.now()).toISOString(); this.store.save(state); };
    if (a.state === 'disable_unknown') {
      try {
        const observed = await this.supplier.account(a.accountId, a.username);
        save(observed.status === 'Disabled' ? 'disabled' : 'disable_unknown', observed.status === 'Disabled' ? 'Supplier disable verified' : 'Supplier account remains active; operator action required');
      } catch { save('disable_unknown', 'Disable status unavailable; check supplier dashboard'); }
      return summary(state);
    }
    if (a.state === 'create_intent' && firstAttempt) {
      try {
        const result = await this.supplier.createAccount(a.username, a.password);
        a.accountId = result.id; delete a.password; save('created', 'Supplier account created');
      } catch {
        save('create_unknown', 'Create response uncertain; reconcile username before any new request');
        return summary(state);
      }
    }
    if (['create_intent', 'create_unknown'].includes(a.state)) {
      try {
        const found = await this.supplier.accountByUsername(a.username);
        if (!found) { save('create_unknown', 'Account not found yet; no duplicate create attempted'); return summary(state); }
        a.accountId = found.id; delete a.password; save('created', 'Supplier account recovered by username');
      } catch { save('create_unknown', 'Account search unresolved; no duplicate create attempted'); return summary(state); }
    }
    if (a.state === 'created') {
      save('expiry_setting', 'Fixed expiry requested');
      try {
        const updated = await this.supplier.expireAccount(a.accountId, a.username, a.expiresOn);
        if (Date.parse(updated.expiresAt) !== Date.parse(`${a.expiresOn}T00:00:00Z`)) throw new Error('Supplier expiry mismatch');
        save('expiry_set', 'Fixed expiry verified');
      } catch { save('expiry_unknown', 'Expiry result uncertain; inspect account before granting access'); return summary(state); }
    }
    if (['expiry_setting', 'expiry_unknown'].includes(a.state)) {
      try {
        const observed = await this.supplier.account(a.accountId, a.username);
        if (Date.parse(observed.expiresAt) !== Date.parse(`${a.expiresOn}T00:00:00Z`)) {
          save('expiry_unknown', 'Fixed expiry not confirmed; no access grant'); return summary(state);
        }
        save('expiry_set', 'Fixed expiry recovered from supplier');
      } catch { save('expiry_unknown', 'Supplier account read unavailable; no access grant'); return summary(state); }
    }
    if (['expiry_set', 'config_unknown'].includes(a.state)) {
      try {
        const config = await this.supplier.configuration(a.serverId, a.accountId);
        a.configHash = crypto.createHash('sha256').update(config).digest('hex');
        save('ready', 'Repeatable configuration retrieved and validated');
      } catch { save('config_unknown', 'Configuration unavailable; retry read without another account'); }
    }
    return summary(state);
  }

  async disable(wallet) {
    if (!walletPattern.test(wallet)) throw new Error('A valid wallet address is required');
    return this.store.locked(async () => {
      const state = this.store.read(), a = state.accounts[wallet.toLowerCase()];
      if (!a?.accountId) throw new Error('No supplier account ID is recorded');
      if (a.state === 'disabled') return summary(state);
      try {
        const result = await this.supplier.disableAccount(a.accountId, a.username);
        if (result.status !== 'Disabled') throw new Error('Supplier did not confirm disable');
        a.state = 'disabled'; a.lastEvent = 'Supplier account disabled';
      } catch {
        a.state = 'disable_unknown'; a.lastEvent = 'Disable result uncertain; verify in supplier dashboard';
      }
      this.store.save(state); return summary(state);
    });
  }

  grant(wallet, signingKey) {
    if (!walletPattern.test(wallet)) throw new Error('A valid wallet address is required');
    const a = this.store.read().accounts[wallet.toLowerCase()];
    if (a?.state !== 'ready' || Date.parse(`${a.expiresOn}T00:00:00Z`) <= this.now()) throw new Error('A ready, unexpired pilot account is required');
    return issueGrant({ wallet, accountId: a.accountId, serverId: a.serverId, expiresAt: `${a.expiresOn}T00:00:00.000Z` }, signingKey);
  }
}

module.exports = { PilotStore, PilotOperator, accountName, expiryDate, summary };
