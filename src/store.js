'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const defaultDir = () => process.env.VPN_STATE_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), '13V', 'VPN-validation');

class Store {
  constructor(dir = defaultDir()) { this.dir = path.resolve(dir); this.file = path.join(this.dir, 'journal.json'); }
  read() {
    if (!fs.existsSync(this.file)) return { version: 1, campaign: null, orders: {} };
    const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (state.version !== 1 || !state.orders) throw new Error('Invalid journal; refusing to reset it');
    return state;
  }
  save(state) {
    const temp = path.join(this.dir, `.journal-${crypto.randomUUID()}.tmp`);
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
  }
  async locked(fn) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const lock = path.join(this.dir, 'campaign.lock');
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (e) { if (e.code === 'EEXIST') throw new Error('Campaign locked; do not remove the lock while another process is running'); throw e; }
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), createdAt: new Date().toISOString() }));
      fs.closeSync(fd); fd = undefined;
      return await fn();
    } finally { if (fd !== undefined) fs.closeSync(fd); fs.unlinkSync(lock); }
  }
}

module.exports = { Store, defaultDir };
