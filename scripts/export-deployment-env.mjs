import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isAddress } from 'viem';
import { isSupportedChain } from '../src/config/networks.ts';

const usage = `Export the exact deployed addresses and ABIs for the server environment.
npm run export:deployment -- --manifest /absolute/path/deployment.json --out /absolute/path/deployment.base64
Set PROTOCOL_DEPLOYMENT_GZIP_BASE64 to the output file's contents, and PROTOCOL_RPC_URL separately.
The export does not contain RPC endpoints, local wallet accounts, signing keys, or deployment bytecode.`;
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(usage);
  process.exit(0);
}
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const name = args[index], value = args[index + 1];
  if (!['--manifest', '--out'].includes(name) || !value || value.startsWith('--') || options[name]) throw new Error(usage);
  options[name] = value;
}
if (!options['--manifest'] || !options['--out']) throw new Error(usage);
const input = resolve(options['--manifest']), output = resolve(options['--out']);
if (input === output) throw new Error('Choose an output path separate from the deployment manifest.');
const manifest = JSON.parse(await readFile(input, 'utf8'));
if (!manifest || !isSupportedChain(manifest.chainId) || !manifest.contracts || typeof manifest.contracts !== 'object' || Array.isArray(manifest.contracts)) throw new Error('Configure a Robinhood Chain production or Anvil deployment.');
const required = ['RF', 'WETH', 'Genesis', 'Generations', 'ActivationManager', 'Market', 'Hook', 'PoolManager', 'Reserve'];
for (const name of required) if (!manifest.contracts[name]) throw new Error(`Missing ${name} deployment.`);
const block = value => {
  if (!/^\d+$/.test(String(value))) throw new Error('Deployment blocks must be nonnegative integers.');
  return String(value);
};
const contracts = Object.fromEntries(Object.entries(manifest.contracts).map(([name, contract]) => {
  if (!contract || typeof contract.address !== 'string' || !isAddress(contract.address) || !Array.isArray(contract.abi)) throw new Error(`Invalid ${name} deployment.`);
  const deploymentBlock = contract.deploymentBlock ?? contract.blockNumber;
  return [name, {
    address: contract.address,
    abi: contract.abi,
    ...(deploymentBlock === undefined ? {} : { deploymentBlock: block(deploymentBlock) }),
    ...(typeof contract.runtimeHash === 'string' ? { runtimeHash: contract.runtimeHash } : {}),
    ...(typeof contract.artifactId === 'string' ? { artifactId: contract.artifactId } : {}),
  }];
}));
const ccaBlock = contracts.CCA?.deploymentBlock ?? manifest.auction?.deploymentBlock ?? manifest.settings?.auction?.deploymentBlock ?? manifest.auctionDeploymentBlock;
if (contracts.CCA && ccaBlock === undefined) throw new Error('CCA deployment block is required for auction history.');
if (contracts.CCA) contracts.CCA.deploymentBlock = block(ccaBlock);
const compact = {
  chainId: manifest.chainId,
  deploymentBlock: block(manifest.deploymentBlock ?? '0'),
  contracts,
  ...(manifest.protocolSnapshot ? { protocolSnapshot: manifest.protocolSnapshot } : {}),
};
const serialized = JSON.stringify(compact);
if (Buffer.byteLength(serialized) > 2_097_152) throw new Error('Runtime manifest exceeds the server decoded size limit of 2 MB.');
const encoded = gzipSync(serialized, { level: 9 }).toString('base64');
// Vercel allows 64 KB for all Node environment names and values together.
// Leave space for the RPC URL and other application settings.
if (Buffer.byteLength(encoded) > 60_000) throw new Error('Compressed manifest exceeds the environment export budget of 60 KB.');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${encoded}\n`, { mode: 0o600 });
console.log(`Exported ${Object.keys(contracts).length} contract addresses and matching ABIs (${Buffer.byteLength(serialized)} JSON bytes; ${encoded.length} base64 bytes) to ${output}.`);
console.log('Set PROTOCOL_DEPLOYMENT_GZIP_BASE64 to that single line; set PROTOCOL_RPC_URL separately.');
