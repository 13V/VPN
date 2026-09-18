#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { Nadanada } = require('./nadanada');
const { Blink } = require('./blink');
const { Engine, selectPlan } = require('./engine');

async function main(args = process.argv.slice(2)) {
  const live = args.includes('--live');
  if (args.some(a => a.startsWith('--') && a !== '--live')) throw new Error('Unknown option');
  const positional = args.filter(a => a !== '--live');
  const [command = 'help', id] = positional;
  if (positional.length > 2) throw new Error('Too many arguments');
  const store = new Store(), supplier = new Nadanada(), payer = new Blink();
  const engine = new Engine({ store, supplier, payer });
  let result;
  switch (command) {
    case 'catalogue': {
      const c = await supplier.catalogue();
      result = { checkedAt: new Date().toISOString(), countries: c.countries, plans: c.durations, selected: selectPlan(c) }; break;
    }
    case 'preflight': result = { ...(await engine.preflight()), credentialsPresent: Boolean(payer.apiKey && payer.walletId) }; break;
    case 'purchase': result = await engine.run('primary', { live }); break;
    case 'renew': result = await engine.run('renewal', { live }); break;
    case 'recovery': result = await engine.run('recovery', { live }); break;
    case 'resume': result = await engine.run(id, { live }); break;
    case 'status': result = await engine.status(id); break;
    case 'replay': result = await engine.replay(id, { live }); break;
    case 'report': result = { ...await engine.status(), acceptance: 'See docs/validation-report.md; simulation is not supplier validation.' }; break;
    case 'export': {
      if (!live) { result = { readOnly: true, action: 'Use export SCENARIO --live to write its secret config to the protected state directory' }; break; }
      result = await store.locked(async () => {
        const o = store.read().orders[id]; if (!o?.config) throw new Error('No saved configuration');
        const target = path.join(store.dir, `${o.id}.conf`);
        fs.writeFileSync(target, o.config, { mode: 0o600, flag: 'wx' });
        return { exported: true, location: 'Protected state directory; configuration never printed' };
      }); break;
    }
    case 'help': result = { commands: ['catalogue', 'preflight', 'purchase', 'renew', 'recovery', 'resume primary|renewal|recovery', 'status [scenario]', 'replay scenario', 'export scenario', 'report'], live: 'Mutating commands require --live. Blink payments are blocked even with --live until an enforceable debit cap is verified.' }; break;
    default: throw new Error('Unknown command');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) main().catch(e => {
  // All network errors have sanitized messages; don't print stacks or request objects.
  process.stderr.write(`Error: ${e.message}\n`); process.exitCode = 1;
});
module.exports = { main };
