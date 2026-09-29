'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PONS_V2_FACTORY, validateManifest, compareChain } = require('../scripts/launch-preflight');

function readyFixture() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launch', 'manifest.example.json'), 'utf8'));
  manifest.launchWallet = '0x1111111111111111111111111111111111111111';
  manifest.creatorFeeRecipient = '0x2222222222222222222222222222222222222222';
  manifest.token.symbol = 'VLR';
  manifest.token.logo = 'ipfs://velora-logo';
  manifest.token.description = 'A token for a proposed community-funded VPN project.';
  manifest.economics = {
    launchMethod: 'launchToken',
    salt: `0x${'d'.repeat(64)}`,
    snipeTaxExemptions: [],
    launchConfigId: 0,
    pairToken: '0x0000000000000000000000000000000000000000',
    creatorTaxBps: 0,
    buybackEnabled: false,
    maxLaunchFeeEth: '0.0005',
    expectedEconomics: `0x${'a'.repeat(64)}`,
    expectedFactoryCodeHash: `0x${'b'.repeat(64)}`,
  };
  return manifest;
}

function observedFixture() {
  return {
    chainId: 4663n,
    factoryCodeHash: `0x${'b'.repeat(64)}`,
    launchFeeWei: 500000000000000n,
    launchConfigCount: 1,
    config: { enabled: true, curveFeeBps: 100 },
    maxCreatorTaxBps: 1000n,
    canLaunch: true,
    expectedEconomics: `0x${'a'.repeat(64)}`,
  };
}

test('example manifest cannot be mistaken for a signed-off launch', () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launch', 'manifest.example.json'), 'utf8'));
  const blockers = validateManifest(example);
  assert.ok(blockers.some(item => item.includes('launchWallet')));
  assert.ok(blockers.some(item => item.includes('creatorTaxBps')));
  assert.ok(blockers.some(item => item.includes('expectedEconomics')));
});

test('a fully specified V2 manifest and matching chain snapshot pass the technical gate', () => {
  const manifest = readyFixture();
  assert.equal(manifest.factoryAddress, PONS_V2_FACTORY);
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(compareChain(manifest, observedFixture()), []);
});

test('changed economics, disabled config and increased launch fee all block', () => {
  const manifest = readyFixture();
  const observed = observedFixture();
  observed.expectedEconomics = `0x${'c'.repeat(64)}`;
  observed.config.enabled = false;
  observed.launchFeeWei += 1n;
  const blockers = compareChain(manifest, observed);
  assert.ok(blockers.some(item => item.includes('economics changed')));
  assert.ok(blockers.some(item => item.includes('disabled')));
  assert.ok(blockers.some(item => item.includes('spending ceiling')));
});

test('a different chain, factory, or ineligible launch wallet fails closed', () => {
  const manifest = readyFixture();
  manifest.factoryAddress = '0x3333333333333333333333333333333333333333';
  assert.ok(validateManifest(manifest).some(item => item.includes('pinned Pons V2 factory')));
  const observed = observedFixture();
  observed.chainId = 46630n;
  observed.factoryCodeHash = `0x${'c'.repeat(64)}`;
  observed.canLaunch = false;
  const blockers = compareChain(manifest, observed);
  assert.ok(blockers.some(item => item.includes('mainnet')));
  assert.ok(blockers.some(item => item.includes('bytecode hash')));
  assert.ok(blockers.some(item => item.includes('not permitted')));
});

test('a custom quote asset and excessive total trade fee cannot pass as an ETH launch', () => {
  const manifest = readyFixture();
  manifest.economics.pairToken = '0x3333333333333333333333333333333333333333';
  manifest.economics.creatorTaxBps = 2000;
  const observed = observedFixture();
  observed.pairTokenHasCode = true;
  const blockers = compareChain(manifest, observed);
  assert.ok(blockers.some(item => item.includes('native ETH only')));
  assert.ok(blockers.some(item => item.includes('exceeds 20%')));
});
