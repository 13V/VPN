'use strict';

// Read-only Pons V2 release check. No signer, private key, or transaction API is imported.
const fs = require('node:fs');
const path = require('node:path');
const { Contract, FetchRequest, JsonRpcProvider, ZeroAddress, formatEther, getAddress, isAddress, keccak256, parseEther } = require('ethers');

const CHAIN_ID = 4663n;
// Pin the factory published in the official pons-labs repository. Updating it needs code review.
const PONS_V2_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const ABI = [
  'function launchFee() view returns (uint256)',
  'function launchConfigCount() view returns (uint256)',
  'function getLaunchConfig(uint256 id) view returns (tuple(uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))',
  'function previewLaunchEconomics(uint256 launchConfigId,address pairToken) view returns (bytes32)',
  'function canLaunch(address) view returns (bool)',
  'function maxCreatorTaxBps() view returns (uint256)',
];

const address = (value, allowZero = false) => typeof value === 'string' && isAddress(value) && (allowZero || getAddress(value) !== ZeroAddress);
const hash = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function validateManifest(m) {
  const problems = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['Manifest must be a JSON object.'];
  if (m.version !== 1) problems.push('version must be 1.');
  if (m.chainId !== 4663) problems.push('chainId must be Robinhood Chain mainnet 4663.');
  if (m.ponsVersion !== 'v2') problems.push('This preflight supports Pons V2 only.');
  if (m.factoryAddress !== PONS_V2_FACTORY) problems.push('factoryAddress differs from the pinned Pons V2 factory.');
  if (!address(m.launchWallet)) problems.push('Set a valid, nonzero launchWallet.');
  if (!address(m.creatorFeeRecipient)) problems.push('Set a valid, nonzero creatorFeeRecipient.');
  if (!nonempty(m.token?.name) || m.token.name.length > 64) problems.push('Set token.name (1–64 characters).');
  if (!/^[A-Z0-9]{2,12}$/.test(m.token?.symbol || '')) problems.push('Set a 2–12 character uppercase token.symbol.');
  if (!nonempty(m.token?.description) || m.token.description.length > 500) problems.push('Set token.description (1–500 characters).');
  if (!/^(https:\/\/|ipfs:\/\/)/.test(m.token?.logo || '') || m.token.logo.length > 300) problems.push('Set a hosted HTTPS or IPFS token.logo (up to 300 characters).');
  if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(m.token?.socials?.website || '')) problems.push('Set an HTTPS token.socials.website.');
  const e = m.economics || {};
  if (e.launchMethod !== 'launchToken') problems.push('Select economics.launchMethod; this preflight currently supports launchToken without an opening buy.');
  if (!hash(e.salt)) problems.push('Set a fresh 32-byte economics.salt, used only once.');
  if (!Array.isArray(e.snipeTaxExemptions) || e.snipeTaxExemptions.some(item => !address(item)) || e.snipeTaxExemptions.length > 32) problems.push('Set economics.snipeTaxExemptions to an explicit list of at most 32 valid addresses.');
  if (!Number.isSafeInteger(e.launchConfigId) || e.launchConfigId < 0) problems.push('Select economics.launchConfigId from the live factory.');
  if (!address(e.pairToken, true)) problems.push('Set economics.pairToken explicitly, using the zero address for native ETH.');
  if (!Number.isSafeInteger(e.creatorTaxBps) || e.creatorTaxBps < 0) problems.push('Set economics.creatorTaxBps explicitly.');
  if (typeof e.buybackEnabled !== 'boolean') problems.push('Set economics.buybackEnabled explicitly.');
  if (!nonempty(e.maxLaunchFeeEth) || !/^\d+(?:\.\d{1,18})?$/.test(e.maxLaunchFeeEth)) problems.push('Set a decimal-string economics.maxLaunchFeeEth spending ceiling.');
  if (!hash(e.expectedEconomics)) problems.push('Pin economics.expectedEconomics from a fresh on-chain read.');
  if (!hash(e.expectedFactoryCodeHash)) problems.push('Pin economics.expectedFactoryCodeHash after independent factory verification.');
  return problems;
}

function compareChain(m, chain) {
  const problems = [];
  const e = m.economics || {};
  if (chain.chainId !== CHAIN_ID) problems.push('RPC is not Robinhood Chain mainnet 4663.');
  if (!chain.factoryCodeHash) problems.push('Pinned factory has no deployed code.');
  if (hash(e.expectedFactoryCodeHash) && chain.factoryCodeHash?.toLowerCase() !== e.expectedFactoryCodeHash.toLowerCase()) problems.push('Factory bytecode hash changed from the reviewed value.');
  if (Number.isSafeInteger(e.launchConfigId) && e.launchConfigId >= chain.launchConfigCount) problems.push('Selected launch config does not exist.');
  if (Number.isSafeInteger(e.launchConfigId) && e.launchConfigId < chain.launchConfigCount && !chain.config) problems.push('Selected launch config could not be read.');
  if (chain.config && !chain.config.enabled) problems.push('Selected launch config is disabled.');
  if (chain.config && Number.isSafeInteger(e.creatorTaxBps) && chain.config.curveFeeBps + e.creatorTaxBps > 2000) problems.push('Selected base fee plus creator tax exceeds 20%.');
  if (Number.isSafeInteger(e.creatorTaxBps) && BigInt(e.creatorTaxBps) > chain.maxCreatorTaxBps) problems.push('Creator tax exceeds the current protocol cap.');
  if (nonempty(e.maxLaunchFeeEth) && /^\d+(?:\.\d{1,18})?$/.test(e.maxLaunchFeeEth) && chain.launchFeeWei > parseEther(e.maxLaunchFeeEth)) problems.push('Current launch fee exceeds the recorded spending ceiling.');
  if (address(m.launchWallet) && chain.canLaunch === false) problems.push('The launch wallet is not permitted to launch now.');
  if (address(e.pairToken, true) && getAddress(e.pairToken) !== ZeroAddress && !chain.pairTokenHasCode) problems.push('The selected quote asset has no deployed code.');
  if (address(e.pairToken, true) && getAddress(e.pairToken) !== ZeroAddress) problems.push('Custom quote assets need a separate approval, liquidity and decimals review; this preflight supports native ETH only.');
  if (hash(e.expectedEconomics) && chain.expectedEconomics?.toLowerCase() !== e.expectedEconomics.toLowerCase()) problems.push('Pons launch economics changed from the recorded pin.');
  if (chain.readError) problems.push('Could not verify all selected on-chain terms.');
  return problems;
}

async function readChain(m, rpcUrl = PUBLIC_RPC) {
  const request = new FetchRequest(rpcUrl);
  request.timeout = 15000;
  const provider = new JsonRpcProvider(request);
  try {
    const factory = new Contract(PONS_V2_FACTORY, ABI, provider);
    const [chainHex, code, launchFeeWei, count, maxCreatorTaxBps] = await Promise.all([
      provider.send('eth_chainId', []), provider.getCode(PONS_V2_FACTORY), factory.launchFee(), factory.launchConfigCount(), factory.maxCreatorTaxBps(),
    ]);
    const result = {
      chainId: BigInt(chainHex),
      blockNumber: await provider.getBlockNumber(),
      factoryCodeHash: code === '0x' ? null : keccak256(code),
      launchFeeWei,
      launchConfigCount: Number(count),
      maxCreatorTaxBps,
    };
    if (result.chainId !== CHAIN_ID) return result;
    const id = m.economics?.launchConfigId;
    const pairToken = m.economics?.pairToken;
    const selected = Number.isSafeInteger(id) && id >= 0 && id < result.launchConfigCount;
    if (selected) {
      try {
        const config = await factory.getLaunchConfig(id);
        result.config = { supply: String(config.supply), curveFeeBps: Number(config.curveFeeBps), enabled: config.enabled, graduationThreshold: String(config.graduationThreshold) };
      } catch { result.readError = true; }
    }
    if (selected && address(pairToken, true)) {
      try { result.expectedEconomics = await factory.previewLaunchEconomics(id, pairToken); }
      catch { result.readError = true; }
      if (getAddress(pairToken) !== ZeroAddress) result.pairTokenHasCode = (await provider.getCode(pairToken)) !== '0x';
    }
    if (address(m.launchWallet)) {
      try { result.canLaunch = await factory.canLaunch(m.launchWallet); }
      catch { result.readError = true; }
    }
    return result;
  } finally { provider.destroy(); }
}

function publicObservation(chain) {
  return {
    checkedAt: new Date().toISOString(),
    chainId: Number(chain.chainId),
    blockNumber: chain.blockNumber,
    factory: PONS_V2_FACTORY,
    factoryCodeHash: chain.factoryCodeHash,
    launchFeeEth: formatEther(chain.launchFeeWei),
    launchConfigCount: chain.launchConfigCount,
    selectedConfig: chain.config || null,
    maxCreatorTaxBps: Number(chain.maxCreatorTaxBps),
    canLaunch: chain.canLaunch ?? null,
    expectedEconomics: chain.expectedEconomics || null,
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    process.stdout.write('Usage: npm run launch:preflight -- --manifest <local-json-path>\nRead-only technical check. No transaction is prepared or sent.\n');
    return 0;
  }
  const flag = args.indexOf('--manifest');
  const file = flag >= 0 ? args[flag + 1] : path.join(__dirname, '..', 'launch', 'manifest.json');
  if (!file || !fs.existsSync(file)) {
    process.stderr.write('Launch manifest not found. Copy launch/manifest.example.json to a private local path and pass --manifest.\n');
    return 2;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { process.stderr.write('Launch manifest is not valid JSON.\n'); return 2; }
  const problems = validateManifest(manifest);
  let observation;
  try {
    const chain = await readChain(manifest, process.env.ROBINHOOD_RPC_URL || PUBLIC_RPC);
    problems.push(...compareChain(manifest, chain));
    observation = publicObservation(chain);
  } catch {
    problems.push('Live chain read failed. Retry with a trusted Robinhood Chain RPC; no launch terms were verified.');
  }
  process.stdout.write(`${JSON.stringify({ technicalPreflight: problems.length ? 'BLOCKED' : 'PASS', readOnly: true, observation, blockers: problems, manualReviewStillRequired: ['Pons website and verified contract comparison', 'final token/fee terms and wallet signers', 'jurisdiction and claims review', 'supplier and funding gates before promising live VPN access'] }, null, 2)}\n`);
  return problems.length ? 2 : 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { process.stderr.write('Launch preflight failed closed.\n'); process.exitCode = 1; });
module.exports = { PONS_V2_FACTORY, validateManifest, compareChain, readChain, main };
