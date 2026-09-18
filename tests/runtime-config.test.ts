import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, mock, test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { ANVIL, ROBINHOOD_MAINNET } from "../src/config/networks.ts";
import { publicProtocolNetwork, publicProtocolRpc } from "../src/lib/public-chain-rpc.ts";
import { apiFailure, chainContext, configuredRpc, publicConfig, readDeploymentManifest } from "../src/server/protocol/config.ts";
import { publicWalletNetwork } from "../src/server/protocol/network.ts";
import { readNftImage } from "../src/server/protocol/nft-image.ts";
import { securityHeaders } from "../src/server/security-headers.ts";
import { walletConnectProjectId } from "../src/server/walletconnect-config.ts";

const environmentKeys = ["PROTOCOL_DEPLOYMENT_GZIP_BASE64", "PROTOCOL_DEPLOYMENT_JSON", "PROTOCOL_DEPLOYMENT_FILE", "PROTOCOL_RPC_URL", "PROTOCOL_PUBLIC_RPC_URL", "NODE_ENV"];
let originalEnvironment: Record<string, string | undefined>;
let temporaryDirectory: string;
const address = "0x1111111111111111111111111111111111111111";

function setEnvironment(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function deployment(chainId = ROBINHOOD_MAINNET.id as number) {
  return { chainId, deploymentBlock: "12", contracts: Object.fromEntries(
    ["RF", "WETH", "Genesis", "Generations", "ActivationManager", "Market", "Hook", "PoolManager", "Reserve", "CCA"]
      .map(name => [name, { address, abi: [], deploymentBlock: "12" }])) };
}

beforeEach(async () => {
  originalEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  setEnvironment(Object.fromEntries(environmentKeys.map(key => [key, undefined])));
  temporaryDirectory = await mkdtemp(join(tmpdir(), "rarefriends-config-"));
  process.env.PROTOCOL_DEPLOYMENT_FILE = join(temporaryDirectory, "deployment.json");
});

afterEach(async () => {
  mock.restoreAll();
  setEnvironment(originalEnvironment);
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("deployment configuration accepts production and Anvil, rejecting other networks", async () => {
  for (const chainId of [ROBINHOOD_MAINNET.id, ANVIL.id]) {
    process.env.PROTOCOL_DEPLOYMENT_JSON = JSON.stringify(deployment(chainId));
    assert.equal((await readDeploymentManifest()).chainId, chainId);
  }
  for (const chainId of [46630, 1, 0, -1]) {
    process.env.PROTOCOL_DEPLOYMENT_JSON = JSON.stringify(deployment(chainId));
    await assert.rejects(readDeploymentManifest(), { status: 503 });
    assert.throws(() => publicProtocolRpc(chainId, "https://example.com"), /Only Robinhood/);
  }
});

test("inline, compressed and file manifests produce the same deployment", async () => {
  const manifest = deployment();
  process.env.PROTOCOL_DEPLOYMENT_JSON = JSON.stringify(manifest);
  assert.deepEqual(await readDeploymentManifest(), manifest);
  process.env.PROTOCOL_DEPLOYMENT_GZIP_BASE64 = gzipSync(JSON.stringify(manifest)).toString("base64");
  await assert.rejects(readDeploymentManifest(), /Set only one/);
  delete process.env.PROTOCOL_DEPLOYMENT_JSON;
  assert.deepEqual(await readDeploymentManifest(), manifest);
  delete process.env.PROTOCOL_DEPLOYMENT_GZIP_BASE64;
  await writeFile(process.env.PROTOCOL_DEPLOYMENT_FILE!, JSON.stringify(manifest));
  assert.deepEqual(await readDeploymentManifest(), manifest);
});

test("public configuration exposes known network metadata and contract data without server credentials", async () => {
  process.env.PROTOCOL_DEPLOYMENT_JSON = JSON.stringify({ ...deployment(),
    rpcUrl: "https://rpc-user:secret-marker@example.com/api-key-marker",
    chainName: "secret-marker", explorerUrl: "https://secret-marker@example.com",
    accounts: [{ address, privateKey: "secret-marker" }], signingKey: "secret-marker" });
  process.env.PROTOCOL_RPC_URL = "https://example.com/server-key-marker";
  process.env.PROTOCOL_PUBLIC_RPC_URL = "https://example.com/incorrect-override";
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("Public metadata must not read the RPC"); });
  const config = await publicConfig(new Request("http://localhost/api/protocol/config"));
  assert.equal(config.chainName, ROBINHOOD_MAINNET.name);
  assert.equal(config.rpcUrl, ROBINHOOD_MAINNET.rpcUrls.default.http[0]);
  assert.equal(config.explorerUrl, ROBINHOOD_MAINNET.blockExplorers.default.url);
  assert.equal(config.launch?.auctionDeploymentBlock, "12");
  assert.doesNotMatch(JSON.stringify(config), /secret-marker|key-marker|incorrect-override|privateKey|accounts/);
  assert.deepEqual(await publicWalletNetwork(new Request("http://localhost/api/wallet/network")), publicProtocolNetwork(ROBINHOOD_MAINNET.id));
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("missing or invalid deployment returns a configuration error without another application mode", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("No fallback RPC should be called"); });
  await assert.rejects(readDeploymentManifest(), { message: "Protocol deployment is not configured.", status: 503 });
  try { await publicConfig(new Request("http://localhost/api/protocol/config")); }
  catch (error) {
    const response = apiFailure(error);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Protocol deployment is not configured." });
  }
  await assert.rejects(readNftImage(new Request("http://localhost/api/protocol/nft-image?collection=Genesis&id=1")), { status: 503 });
  await writeFile(process.env.PROTOCOL_DEPLOYMENT_FILE!, "invalid JSON");
  await assert.rejects(readDeploymentManifest(), { message: "Invalid protocol deployment configuration.", status: 503 });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("auction metadata is optional without changing the application configuration", async () => {
  const manifest = deployment();
  delete manifest.contracts.CCA;
  process.env.PROTOCOL_DEPLOYMENT_JSON = JSON.stringify(manifest);
  const config = await publicConfig(new Request("http://localhost/api/protocol/config"));
  assert.equal(config.launch, null);
  assert.equal(config.contracts.RF, address);
});

test("Anvil wallet registration permits local URLs and rejects credentials or public hosts", () => {
  assert.throws(() => publicProtocolRpc(ANVIL.id), /Configure the Anvil RPC/);
  assert.equal(publicProtocolRpc(ANVIL.id, ANVIL.rpcUrls.default.http[0]), ANVIL.rpcUrls.default.http[0]);
  assert.equal(publicProtocolRpc(ANVIL.id, "http://192.168.1.42:8545/"), "http://192.168.1.42:8545");
  for (const url of ["https://example.com", "http://user:password@localhost:8545", "http://localhost:8545?key=secret", "http://localhost:8545#secret", "file:///tmp/rpc", "http://localhost:8545/api/protocol/rpc"]) {
    assert.throws(() => publicProtocolRpc(ANVIL.id, url));
  }
});

async function withRpc(chainId: number, clientVersion: string, run: (url: string) => Promise<void>) {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const reply = (call: { id: number; method: string }) => ({ jsonrpc: "2.0", id: call.id,
      result: call.method === "eth_chainId" ? `0x${chainId.toString(16)}` : clientVersion });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const connection = server.address();
  assert.ok(connection && typeof connection !== "string");
  try { await run(`http://127.0.0.1:${connection.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("RPC verification rejects unsupported chains, mismatches and non-Anvil local clients", async () => {
  await withRpc(46630, "test-client", async url => {
    await assert.rejects(configuredRpc(url, ROBINHOOD_MAINNET.id), /Only Robinhood/);
  });
  await withRpc(ANVIL.id, "anvil/v1.0", async url => {
    await assert.rejects(configuredRpc(url, ROBINHOOD_MAINNET.id), /different chain/);
  });
  await withRpc(ANVIL.id, "other-client/v1.0", async url => {
    await assert.rejects(configuredRpc(url, ANVIL.id), /must run Anvil/);
  });
  await assert.rejects(configuredRpc("https://example.com", ANVIL.id), /local RPC/);
});

test("the production build can use verified Anvil accounts and browser RPC permissions", async () => {
  setEnvironment({ NODE_ENV: "production" });
  await withRpc(ANVIL.id, "anvil/v1.0", async url => {
    process.env.PROTOCOL_DEPLOYMENT_JSON = JSON.stringify({ ...deployment(ANVIL.id), accounts: [address] });
    process.env.PROTOCOL_RPC_URL = url;
    process.env.PROTOCOL_PUBLIC_RPC_URL = url;
    assert.equal((await chainContext()).local, true);
    const config = await publicConfig(new Request("http://localhost/api/protocol/config"));
    assert.deepEqual(config.localAccounts, [address]);
    assert.equal(config.explorerUrl, "");
    const headers = securityHeaders({ nonce: "abcdefghijklmnopqrstuvwx", development: false, https: false, localWalletRpcUrl: url });
    assert.ok(headers["Content-Security-Policy"].includes(url));
    assert.doesNotMatch(headers["Content-Security-Policy"], /unsafe-eval|rpc\.testnet/);
  });
});

test("deployment export omits credentials and rejects unsupported networks", async () => {
  const input = join(temporaryDirectory, "source.json");
  const output = join(temporaryDirectory, "deployment.base64");
  const manifest = { ...deployment(), rpcUrl: "https://example.com/secret-marker", explorerUrl: "https://secret-marker@example.com", accounts: [{ address, privateKey: "secret-marker" }] };
  await writeFile(input, JSON.stringify(manifest));
  const args = ["scripts/export-deployment-env.mjs", "--manifest", input, "--out", output];
  assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
  const exported = gunzipSync(Buffer.from((await readFile(output, "utf8")).trim(), "base64")).toString("utf8");
  assert.doesNotMatch(exported, /secret-marker|rpcUrl|accounts|privateKey|explorerUrl/);
  assert.equal(JSON.parse(exported).chainId, ROBINHOOD_MAINNET.id);
  await writeFile(input, JSON.stringify({ ...manifest, chainId: 46630 }));
  assert.notEqual(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
});

test("WalletConnect has no shared deployment default", () => {
  assert.equal(walletConnectProjectId({ NODE_ENV: "test" }), null);
  assert.equal(walletConnectProjectId({ NODE_ENV: "test", WALLETCONNECT_PROJECT_ID: "invalid" }), null);
  assert.equal(walletConnectProjectId({ NODE_ENV: "test", WALLETCONNECT_PROJECT_ID: "a".repeat(32) }), "a".repeat(32));
});
