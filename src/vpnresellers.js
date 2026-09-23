'use strict';

const { request, json, ServiceError } = require('./http');
const { isIP } = require('node:net');

const BASE = 'https://api.vpnresellers.com/v4_1';
const keyPattern = /^[A-Za-z0-9+/]{43}=$/;

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function address(value, prefixRequired = true) {
  const parts = value.trim().split('/');
  const family = isIP(parts[0]);
  if (!family || parts.length > 2 || (prefixRequired && parts.length !== 2)) return false;
  if (parts.length === 1) return true;
  const maximum = family === 4 ? 32 : 128;
  return /^\d{1,3}$/.test(parts[1]) && Number(parts[1]) <= maximum;
}

function wireGuardConfiguration(content) {
  if (typeof content !== 'string' || content.length > 65536 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) {
    throw new Error('Invalid supplier WireGuard configuration');
  }
  const permitted = {
    Interface: new Set(['PrivateKey', 'Address', 'DNS', 'MTU']),
    Peer: new Set(['PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint', 'PersistentKeepalive']),
  };
  const fields = { Interface: {}, Peer: {} };
  let section;
  const sections = new Set();
  for (const source of content.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[(Interface|Peer)\]$/.exec(line);
    if (header) {
      if (sections.has(header[1])) throw new Error('Duplicate WireGuard section');
      section = header[1]; sections.add(section); continue;
    }
    const field = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (!field || !permitted[section]?.has(field[1]) || fields[section][field[1]] !== undefined) {
      throw new Error('Unexpected supplier WireGuard directive');
    }
    fields[section][field[1]] = field[2];
  }
  const i = fields.Interface, p = fields.Peer;
  if (!keyPattern.test(i.PrivateKey || '') || !keyPattern.test(p.PublicKey || '') ||
      (p.PresharedKey && !keyPattern.test(p.PresharedKey)) ||
      !i.Address || !p.AllowedIPs || !p.Endpoint ||
      !/^([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\]):([0-9]{1,5})$/.test(p.Endpoint)) {
    throw new Error('Incomplete supplier WireGuard configuration');
  }
  const port = Number(p.Endpoint.slice(p.Endpoint.lastIndexOf(':') + 1));
  if (port < 1 || port > 65535 || !i.Address.split(',').every(x => address(x, false)) ||
      !p.AllowedIPs.split(',').every(x => address(x)) ||
      (i.DNS && !i.DNS.split(',').every(x => isIP(x.trim()))) ||
      (i.MTU && (!/^\d{3,4}$/.test(i.MTU) || Number(i.MTU) < 576 || Number(i.MTU) > 9000)) ||
      (p.PersistentKeepalive && (!/^\d{1,5}$/.test(p.PersistentKeepalive) || Number(p.PersistentKeepalive) > 65535))) {
    throw new Error('Invalid supplier WireGuard network fields');
  }
  return content.trim() + '\n';
}

class VPNresellers {
  constructor({ token = process.env.VPN_RESELLERS_API_TOKEN, fetchImpl = fetch } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
  }

  async api(method, route, body) {
    if (!this.token) throw new Error('VPN_RESELLERS_API_TOKEN is not configured');
    if (!/^\/[a-zA-Z0-9_/?=&-]+$/.test(route)) throw new Error('Invalid supplier route');
    const response = await request(`${BASE}${route}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    }, this.fetch);
    if (response.status < 200 || response.status >= 300) throw new ServiceError('vpnresellers', response.status);
    const result = json(response.text);
    if (!result || result.code !== response.status) throw new ServiceError('vpnresellers', response.status, 'INVALID_RESPONSE');
    return result.data;
  }

  async profile() {
    const data = await this.api('GET', '/profile');
    const balance = Number(data?.balance);
    if (!Number.isFinite(balance) || balance < 0) throw new Error('Supplier balance unavailable');
    return { balance };
  }

  async australiaServers() {
    const data = await this.api('GET', '/servers');
    if (!Array.isArray(data)) throw new Error('Supplier server list unavailable');
    return data.filter(s => s?.country_code === 'AU' && positiveId(s.id) && typeof s.name === 'string')
      .map(s => ({ id: s.id, name: s.name, city: s.city || '' }));
  }

  async accountByUsername(username) {
    if (!/^[a-zA-Z0-9._@-]{3,50}$/.test(username)) throw new Error('Invalid supplier username');
    for (let page = 1; page <= 20; page++) {
      const data = await this.api('GET', `/accounts?per_page=100&page=${page}`);
      if (!Array.isArray(data)) throw new Error('Supplier account list unavailable');
      const found = data.find(item => item?.username === username);
      if (found) return this.#account(found, username);
      if (data.length < 100) return null;
    }
    throw new Error('Supplier account search incomplete; cannot infer absence');
  }

  #account(data, username) {
    if (!positiveId(data?.id) || typeof data.username !== 'string' || !/^[a-zA-Z0-9._@-]{3,50}$/.test(data.username) ||
        (username !== undefined && data.username !== username) || !['Active', 'Disabled'].includes(data.status)) {
      throw new Error('Invalid supplier account');
    }
    return { id: data.id, username: data.username, status: data.status, expiresAt: data.expired_at || null };
  }

  async createAccount(username, password) {
    if (!/^[a-zA-Z0-9._@-]{3,50}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 50) {
      throw new Error('Invalid supplier account credentials');
    }
    const data = await this.api('POST', '/accounts', { username, password });
    return this.#account(data, username);
  }

  async account(id, username) {
    if (!positiveId(id)) throw new Error('Invalid supplier account ID');
    return this.#account(await this.api('GET', `/accounts/${id}`), username);
  }

  async expireAccount(id, username, date) {
    if (!positiveId(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
      throw new Error('Invalid supplier expiry');
    }
    return this.#account(await this.api('PUT', `/accounts/${id}/expire`, { expire_at: date }), username);
  }

  async disableAccount(id, username) {
    if (!positiveId(id)) throw new Error('Invalid supplier account ID');
    return this.#account(await this.api('PUT', `/accounts/${id}/disable`), username);
  }

  async configuration(serverId, accountId) {
    if (!positiveId(serverId) || !positiveId(accountId)) throw new Error('Invalid supplier identifiers');
    const data = await this.api('GET', `/configuration/wireguard?server_id=${serverId}&account_id=${accountId}`);
    return wireGuardConfiguration(data?.content);
  }
}

module.exports = { VPNresellers, wireGuardConfiguration };
