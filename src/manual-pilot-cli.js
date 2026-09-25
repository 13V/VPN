#!/usr/bin/env node
'use strict';
const { ManualPilot } = require('./manual-pilot');

async function main(args = process.argv.slice(2)) {
  const live = args.includes('--live');
  if (args.some(a => a.startsWith('--') && a !== '--live')) throw new Error('Unknown option');
  const [command = 'help', id] = args.filter(a => a !== '--live');
  if (args.filter(a => a !== '--live').length > 2) throw new Error('Too many arguments');
  const pilot = new ManualPilot();
  let result;
  if (command === 'status') result = pilot.summary();
  else if (command === 'prepare') result = await pilot.prepare(id, live);
  else if (command === 'invoice') result = pilot.invoice(id);
  else if (command === 'collect') result = await pilot.collect(id, live);
  else if (command === 'export') result = await pilot.export(id, live);
  else if (command === 'help') result = { commands: ['status', 'prepare primary --live', 'invoice primary', 'collect primary --live', 'export primary --live', 'prepare renewal --live', 'invoice renewal', 'collect renewal --live'],
    caution: 'Operator-only nadanada test. No CLI payment is made or capped. Public holder access stays in demo mode.' };
  else throw new Error('Unknown command');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) main().catch(e => { process.stderr.write(`Error: ${e.message}\n`); process.exitCode = 1; });
module.exports = { main };
