'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Store } = require('../src/store');

const DAY = 86400000;
const DEMO_ALLOWANCE = 350;
const CATALOGUE = Object.freeze({ countries: [{ code: 'AU', name: 'Australia' }], plans: [{ id: 'day', name: 'One day', days: 1, priceCents: 50, bandwidthGb: 50 }] });
function problem(status, code, message) { return Object.assign(new Error(message), { status, code }); }
function week(now) {
  const d = new Date(now); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return { startsAt: d.toISOString(), resetsAt: new Date(d.getTime() + 7 * DAY).toISOString() };
}

class PortalStore extends Store {
  constructor(dir = process.env.VPN_PORTAL_STATE_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), '13V', 'VPN-portal')) {
    super(dir); this.file = path.join(this.dir, 'portal.json');
  }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, accounts: {}, requests: {} };
    const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (state.version !== 1 || !state.accounts || !state.requests) throw new Error('Invalid portal journal; refusing to reset');
    return state;
  }
}

// A trusted operator-produced, fully funded weekly snapshot, never client-supplied.
function snapshot(file, now, address) {
  if (!file) return { totalCents: 0, weeklyBudgetCents: 0, reason: 'The token and funded holder snapshot have not been configured.' };
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  const start = Date.parse(s.startsAt), end = Date.parse(s.endsAt);
  if (s.version !== 1 || s.chainId !== 4663 || !/^0x[0-9a-fA-F]{40}$/.test(s.tokenAddress) || !Number.isSafeInteger(s.blockNumber) || s.blockNumber < 0 ||
      !Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7 * DAY || now < start || now >= end ||
      !Number.isSafeInteger(s.fundedBudgetCents) || s.fundedBudgetCents < 0 || !s.allocations || Array.isArray(s.allocations)) {
    throw problem(503, 'SNAPSHOT_INVALID', 'The funded allowance snapshot is unavailable or expired.');
  }
  let allocated = 0;
  for (const [who, amount] of Object.entries(s.allocations)) {
    if (!/^0x[0-9a-f]{40}$/.test(who) || !Number.isSafeInteger(amount) || amount < 0) throw problem(503, 'SNAPSHOT_INVALID', 'The allowance snapshot is invalid.');
    allocated += amount;
    if (!Number.isSafeInteger(allocated) || allocated > s.fundedBudgetCents) throw problem(503, 'SNAPSHOT_UNFUNDED', 'Allowances exceed the funded pool.');
  }
  return { totalCents: s.allocations[address.toLowerCase()] || 0, weeklyBudgetCents: s.fundedBudgetCents, allocatedCents: allocated, resetsAt: s.endsAt,
    reason: 'Allowance from the configured weekly snapshot; live provisioning is not enabled.' };
}

class Portal {
  constructor({ store = new PortalStore(), now = Date.now, mode = 'demo', allowancesFile = process.env.VPN_ALLOWANCES_FILE } = {}) {
    if (!['demo', 'preview'].includes(mode)) throw new Error('VPN_PORTAL_MODE must be demo or preview; live mode is unavailable');
    this.store = store; this.now = now; this.mode = mode; this.allowancesFile = allowancesFile;
  }
  dashboard(session) {
    const state = this.store.read(), account = state.accounts[session.address];
    const period = week(this.now());
    const demo = session.kind === 'demo' && this.mode === 'demo';
    const allocation = demo ? { totalCents: DEMO_ALLOWANCE, weeklyBudgetCents: 100000, allocatedCents: 75000, resetsAt: period.resetsAt, reason: 'Sample weekly allowance for trying the portal.' } : snapshot(this.allowancesFile, this.now(), session.address);
    const spentCents = account?.period === period.startsAt ? account.spentCents : 0;
    return {
      allowance: { totalCents: allocation.totalCents, spentCents, remainingCents: Math.max(0, allocation.totalCents - spentCents), resetsAt: allocation.resetsAt || period.resetsAt },
      tunnels: (account?.tunnels || []).map(t => ({ ...t, status: Date.parse(t.expiresAt) > this.now() ? 'demo_ready' : 'expired' })),
      activity: [...(account?.activity || [])].reverse(),
      pool: { weeklyBudgetCents: allocation.weeklyBudgetCents, allocatedCents: allocation.allocatedCents || 0, source: demo ? 'demo' : 'snapshot' },
      eligibility: { eligible: demo && allocation.totalCents > spentCents, reason: allocation.reason },
    };
  }
  async provision(session, input, tunnelId) {
    if (this.mode !== 'demo' || session.kind !== 'demo') throw problem(503, 'LIVE_PROVISIONING_BLOCKED', 'Real VPN purchasing is awaiting supplier recovery validation and a payment cap. Explore the demo to try the flow.');
    if (!input || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw problem(400, 'REQUEST_ID_REQUIRED', 'A unique request ID is required.');
    const kind = tunnelId ? 'renew' : 'create';
    if (kind === 'create' && (input.country !== 'AU' || input.planId !== 'day' || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40 || /[\x00-\x1f]/.test(input.name))) {
      throw problem(400, 'INVALID_PLAN', 'Enter a tunnel name of up to 40 characters and choose Australia, one day.');
    }
    const digest = crypto.createHash('sha256').update(JSON.stringify(kind === 'renew' ? { kind, tunnelId } : { kind, name: input.name.trim(), country: input.country, planId: input.planId })).digest('hex');
    return this.store.locked(async () => {
      const state = this.store.read();
      const key = `${session.address}:${input.requestId}`;
      const previous = state.requests[key];
      if (previous) {
        if (previous.digest !== digest) throw problem(409, 'IDEMPOTENCY_CONFLICT', 'This request ID was already used for a different action.');
        return { tunnel: previous.tunnel, replayed: true };
      }
      const period = week(this.now()), stamp = new Date(this.now()).toISOString();
      const a = state.accounts[session.address] ||= { period: period.startsAt, spentCents: 0, tunnels: [], activity: [] };
      if (a.period !== period.startsAt) { a.period = period.startsAt; a.spentCents = 0; }
      if (a.spentCents + 50 > DEMO_ALLOWANCE) throw problem(409, 'ALLOWANCE_EXHAUSTED', 'This week’s sample allowance has been used. It resets next Monday.');
      let t;
      if (tunnelId) {
        t = a.tunnels.find(item => item.id === tunnelId);
        if (!t) throw problem(404, 'TUNNEL_NOT_FOUND', 'Tunnel not found.');
        t.expiresAt = new Date(Math.max(this.now(), Date.parse(t.expiresAt)) + DAY).toISOString(); t.bandwidthGb += 50;
      } else {
        t = { id: crypto.randomUUID(), name: input.name.trim(), country: 'AU', status: 'demo_ready', expiresAt: new Date(this.now() + DAY).toISOString(), bandwidthGb: 50, usedGb: 0, createdAt: stamp };
        a.tunnels.push(t);
      }
      a.spentCents += 50;
      a.activity.push({ id: crypto.randomUUID(), type: kind, tunnelId: t.id, label: `${kind === 'create' ? 'Created' : 'Extended'} ${t.name}`, costCents: 50, createdAt: stamp });
      state.requests[key] = { digest, tunnel: { ...t } };
      this.store.save(state);
      return { tunnel: t, replayed: false };
    });
  }
  configuration(session, id) {
    const t = this.store.read().accounts[session.address]?.tunnels.find(item => item.id === id);
    if (!t || session.kind !== 'demo' || this.mode !== 'demo') throw problem(404, 'TUNNEL_NOT_FOUND', 'Tunnel not found.');
    return `VPN — DEMO SETUP PREVIEW\n\nThis is a sample download, not a working VPN configuration.\nNo tunnel was provisioned and no money was spent.\n\nTunnel: ${t.name}\nLocation: Australia\nSample expiry: ${t.expiresAt}\nSample bandwidth: ${t.bandwidthGb} GB\n\nWhen live provisioning is validated, this download will provide a WireGuard configuration.\nInstall WireGuard, import the configuration and activate the tunnel.\nConnection quality and privacy claims have not yet been independently tested.\n`;
  }
}
module.exports = { Portal, PortalStore, CATALOGUE, week, snapshot, problem };
