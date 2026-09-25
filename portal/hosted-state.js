'use strict';

const { Auth } = require('./auth');
const { Portal, problem } = require('./model');

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ACCOUNTS = 1000;
const MAX_ACTIONS = 20; // An eight-hour demo can cross at most two weekly allowances.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
const demoAddress = value => /^demo:[a-f0-9]{32}$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const unavailable = () => problem(503, 'HOSTED_STATE_UNAVAILABLE', 'The portal is temporarily unavailable. Your saved actions have not been reset; please try again.');

function validTunnel(t) {
  return record(t) && uuid(t.id) && typeof t.name === 'string' && t.name.trim().length > 0 && t.name.length <= 40 && !/[\x00-\x1f]/.test(t.name) &&
    t.country === 'AU' && t.status === 'demo_ready' && timestamp(t.expiresAt) && timestamp(t.createdAt) &&
    Number.isSafeInteger(t.bandwidthGb) && t.bandwidthGb >= 50 && t.bandwidthGb <= 50 * MAX_ACTIONS && t.usedGb === 0;
}

function validatePortal(state) {
  if (!record(state) || state.version !== 1 || !record(state.accounts) || !record(state.requests) ||
      Object.keys(state.accounts).length > MAX_ACCOUNTS || Object.keys(state.requests).length > MAX_ACCOUNTS * MAX_ACTIONS) throw unavailable();
  for (const [address, a] of Object.entries(state.accounts)) {
    if (!demoAddress(address) || !record(a) || !timestamp(a.period) || !Number.isSafeInteger(a.spentCents) || a.spentCents < 0 || a.spentCents > 350 ||
        !Array.isArray(a.tunnels) || a.tunnels.length > MAX_ACTIONS || !a.tunnels.every(validTunnel) || new Set(a.tunnels.map(t => t.id)).size !== a.tunnels.length ||
        !Array.isArray(a.activity) || a.activity.length > MAX_ACTIONS || !a.activity.every(item => record(item) && uuid(item.id) && ['create', 'renew'].includes(item.type) &&
          a.tunnels.some(t => t.id === item.tunnelId) && typeof item.label === 'string' && item.label.length <= 60 && item.costCents === 50 && timestamp(item.createdAt))) throw unavailable();
  }
  for (const [key, entry] of Object.entries(state.requests)) {
    const address = key.slice(0, 37), requestId = key.slice(38);
    if (!demoAddress(address) || key[37] !== ':' || !uuid(requestId) || !record(entry) || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest) ||
        !validTunnel(entry.tunnel) || !state.accounts[address]?.tunnels.some(t => t.id === entry.tunnel.id)) throw unavailable();
  }
}

class MemoryPortalStore {
  constructor(state) { this.state = structuredClone(state); }
  read() { return structuredClone(this.state); }
  save(state) { this.state = structuredClone(state); }
  async locked(fn) { return fn(); } // The encompassing Blob transaction supplies the lock via CAS.
}

// A single private document is adequate for this bounded demo, not a payment
// ledger. Every mutation compares its ETag with an uncached, consistent read.
class HostedState {
  constructor({ origin, mode = 'demo', now = Date.now, token = process.env.BLOB_READ_WRITE_TOKEN,
    pathname = 'vpn/portal-state-v1.json', blob = require('@vercel/blob'), maxAttempts = 5 } = {}) {
    if (!['demo', 'preview'].includes(mode)) throw new Error('Hosted portal supports demo or preview only');
    if (typeof token !== 'string' || !token || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('Private Blob credentials and bounded attempts are required');
    this.authOptions = { origin, now, demoEnabled: mode === 'demo' };
    new Auth(this.authOptions); // Validate origin before any storage operation.
    this.mode = mode; this.now = now; this.token = token; this.pathname = pathname; this.blob = blob; this.maxAttempts = maxAttempts;
  }

  async #read() {
    // Compression can turn the strong object ETag into W/"...", which cannot
    // authorize a conditional write. Request the original representation.
    const result = await this.blob.get(this.pathname, { access: 'private', token: this.token, useCache: false,
      headers: { 'accept-encoding': 'identity' }, abortSignal: AbortSignal.timeout(10000) });
    if (result === null) return { etag: null, state: { version: 1, auth: new Auth(this.authOptions).exportState(), portal: { version: 1, accounts: {}, requests: {} } } };
    if (!result || result.statusCode !== 200 || !result.stream || typeof result.blob?.etag !== 'string' || !/^"[^"\r\n]+"$/.test(result.blob.etag) || result.blob.size > MAX_BYTES) {
      await result?.stream?.cancel().catch(() => {});
      throw unavailable();
    }
    const reader = result.stream.getReader(), parts = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BYTES) throw unavailable();
        parts.push(Buffer.from(next.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return { etag: result.blob.etag, state: JSON.parse(Buffer.concat(parts).toString('utf8')) };
  }

  async transaction(operation) {
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let etag, state, auth, store, before;
      try {
        ({ etag, state } = await this.#read());
        if (!record(state) || state.version !== 1) throw unavailable();
        before = JSON.stringify(state);
        validatePortal(state.portal);
        auth = new Auth(this.authOptions);
        auth.importState(state.auth);
        store = new MemoryPortalStore(state.portal);
      } catch { throw unavailable(); }

      let result, operationError;
      try { result = await operation({ auth, portal: new Portal({ store, now: this.now, mode: this.mode, allowancesFile: null }) }); }
      catch (error) { operationError = error; }

      // Persist challenge consumption even when signature verification rejects.
      state.auth = auth.exportState();
      state.portal = store.state;
      const active = new Set(state.auth.sessions.filter(([, item]) => item.session.kind === 'demo').map(([, item]) => item.session.address));
      for (const address of Object.keys(state.portal.accounts)) if (!active.has(address)) delete state.portal.accounts[address];
      for (const key of Object.keys(state.portal.requests)) if (!active.has(key.slice(0, 37))) delete state.portal.requests[key];
      validatePortal(state.portal);
      const body = JSON.stringify(state);
      if (Buffer.byteLength(body) > MAX_BYTES) throw problem(503, 'HOSTED_CAPACITY', 'The preview is at capacity. Please try again after existing demo sessions expire.');
      if (body !== before) {
        try {
          await this.blob.put(this.pathname, body, { access: 'private', token: this.token, addRandomSuffix: false,
            contentType: 'application/json', cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(10000),
            ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }) });
        } catch (error) {
          const conflict = error instanceof this.blob.BlobPreconditionFailedError;
          if (conflict) continue;
          // A transport failure could follow a successful commit. Never replay
          // automatically unless the server explicitly reports a CAS conflict.
          throw unavailable();
        }
      }
      if (operationError) throw operationError;
      return result;
    }
    throw problem(503, 'HOSTED_BUSY', 'The portal is busy. Retry the same action shortly.');
  }
}

class HostedAuth {
  constructor(state) { this.state = state; }
  challenge(address) { return this.state.transaction(({ auth }) => auth.challenge(address)); }
  verify(input) { return this.state.transaction(({ auth }) => auth.verify(input)); }
  demo() { return this.state.transaction(({ auth }) => auth.demo()); }
  session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return Promise.resolve(null);
    return this.state.transaction(({ auth }) => auth.session(token));
  }
  logout(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return Promise.resolve();
    return this.state.transaction(({ auth }) => auth.logout(token));
  }
}

class HostedPortal {
  constructor(state) { this.state = state; }
  #run(session, operation) {
    return this.state.transaction(({ auth, portal }) => {
      const active = auth.exportState().sessions.some(([, item]) => item.session.address === session?.address && item.session.kind === session?.kind);
      if (!active) throw problem(401, 'SESSION_REQUIRED', 'Sign in again to continue.');
      return operation(portal);
    });
  }
  dashboard(session) { return this.#run(session, portal => portal.dashboard(session)); }
  configuration(session, id) { return this.#run(session, portal => portal.configuration(session, id)); }
  provision(session, input, id) { return this.#run(session, portal => portal.provision(session, input, id)); }
}

module.exports = { HostedState, HostedAuth, HostedPortal };
