'use strict';
const crypto = require('node:crypto');

function keys() {
  const pair = crypto.generateKeyPairSync('x25519');
  const privateKey = Buffer.from(pair.privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
  const publicKey = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  return { privateKey, publicKey, presharedKey: crypto.randomBytes(32).toString('base64') };
}

function config(raw, key) {
  if (typeof raw !== 'string' || raw.length > 65536) throw new Error('Invalid WireGuard configuration');
  const allowed = { Interface: new Set(['PrivateKey', 'Address', 'DNS', 'MTU']), Peer: new Set(['PublicKey', 'PresharedKey', 'Endpoint', 'AllowedIPs', 'PersistentKeepalive']) };
  const sections = { Interface: {}, Peer: {} };
  let section = '';
  const seen = new Set();
  for (const line of raw.split(/\r?\n/).map(l => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    const heading = /^\[(Interface|Peer)\]$/.exec(line);
    if (heading) {
      section = heading[1];
      if (seen.has(section)) throw new Error('Duplicate WireGuard section');
      seen.add(section); continue;
    }
    const field = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (!field || !allowed[section]?.has(field[1]) || sections[section][field[1]] !== undefined) throw new Error('Unexpected WireGuard directive');
    sections[section][field[1]] = field[2];
  }
  if (!sections.Interface.Address || !sections.Peer.Endpoint || !sections.Peer.AllowedIPs || !sections.Peer.PublicKey) throw new Error('Incomplete WireGuard configuration');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(sections.Peer.PublicKey)) throw new Error('Invalid server public key');
  if (sections.Peer.PresharedKey && sections.Peer.PresharedKey !== key.presharedKey) throw new Error('Preshared key mismatch');
  // With a client-provided public key, the supplier may omit PrivateKey or use a placeholder.
  sections.Interface.PrivateKey = key.privateKey;
  sections.Peer.PresharedKey = key.presharedKey;
  return Object.entries(sections).map(([name, fields]) => `[${name}]\n${Object.entries(fields).map(([k, v]) => `${k} = ${v}`).join('\n')}`).join('\n\n') + '\n';
}

module.exports = { keys, config };
