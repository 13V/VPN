'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PilotOperator } = require('./pilot-operator');

async function main(args = process.argv.slice(2), env = process.env) {
  const [command, wallet, ...flags] = args;
  const known = new Set(['--live']);
  let serverId;
  for (let n = 0; n < flags.length; n++) {
    if (flags[n] === '--server-id') {
      serverId = Number(flags[++n]);
      if (!Number.isSafeInteger(serverId) || serverId <= 0) throw new Error('Use a positive --server-id from preflight');
    } else if (!known.has(flags[n])) throw new Error('Unknown pilot option');
  }
  const operator = new PilotOperator({ maxAccounts: Number(env.VPN_PILOT_MAX_ACCOUNTS || 1) });
  let result;
  if (command === 'preflight' && !wallet) result = await operator.preflight();
  else if (command === 'report' && !wallet) result = operator.store.read();
  else if (command === 'provision' && wallet) result = await operator.start(wallet, { live: flags.includes('--live'), serverId });
  else if (command === 'resume' && wallet && flags.length === 0) result = await operator.resume(wallet);
  else if (command === 'disable' && wallet && flags.length === 1 && flags[0] === '--live') result = await operator.disable(wallet);
  else if (command === 'grant' && wallet && flags.length === 0) {
    const token = operator.grant(wallet, env.VPN_PILOT_SIGNING_KEY);
    fs.mkdirSync(operator.store.dir, { recursive: true, mode: 0o700 });
    const file = path.join(operator.store.dir, `grant-${wallet.toLowerCase().slice(-12)}-${crypto.randomUUID()}.txt`);
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, token + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    result = { grantFile: file, expiresOn: operator.store.read().accounts[wallet.toLowerCase()].expiresOn };
  } else throw new Error('Use preflight, provision <wallet> [--live] [--server-id n], resume <wallet>, disable <wallet> --live, grant <wallet>, or report');
  // Never print account passwords, WireGuard configs, API tokens or grant values.
  if (command === 'report') result = { accounts: Object.fromEntries(Object.entries(result.accounts).map(([address, a]) => [address, {
    state: a.state, username: a.username, accountId: a.accountId || null, serverId: a.serverId,
    expiresOn: a.expiresOn, lastEvent: a.lastEvent,
  }])) };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { main };
