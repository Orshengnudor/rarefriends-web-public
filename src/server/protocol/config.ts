import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import type { ProtocolConfig } from "@/src/features/protocol/types";
import { ANVIL, isSupportedChain } from "../../config/networks.ts";
import { ProtocolError, type Deployment, type ChainContext } from "../../lib/protocol/chain-context.ts";
import { isLocalRpcHost, publicProtocolNetwork } from "../../lib/public-chain-rpc.ts";
export { ProtocolError, contractRead, type Deployment, type DeploymentContract, type ChainContext } from "../../lib/protocol/chain-context.ts";

const required = ["RF", "WETH", "Genesis", "Generations", "ActivationManager", "Market", "Hook", "PoolManager", "Reserve"];
const configuredRpcs = new Map<string, Promise<Awaited<ReturnType<typeof connectRpc>>>>();

/** Public deployment metadata is independent of server RPC availability. */
export async function readDeploymentManifest(): Promise<Deployment> {
  let manifest: Deployment;
  const compressed = process.env.PROTOCOL_DEPLOYMENT_GZIP_BASE64?.trim();
  const inline = process.env.PROTOCOL_DEPLOYMENT_JSON?.trim();
  if (compressed && inline) throw new ProtocolError("Set only one protocol deployment environment value.", 503);
  try {
    if (compressed) {
      if (compressed.length > 65_536 || compressed.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compressed)) throw new Error("Invalid manifest encoding.");
      manifest = JSON.parse(gunzipSync(Buffer.from(compressed, "base64"), { maxOutputLength: 2_097_152 }).toString("utf8"));
    } else if (inline) {
      manifest = JSON.parse(inline);
    } else {
      // Local/self-hosted fallback. Vercel uses the server environment above.
      manifest = JSON.parse(await readFile(/* turbopackIgnore: true */ resolve(/* turbopackIgnore: true */ process.env.PROTOCOL_DEPLOYMENT_FILE?.trim() || ".local/protocol/deployment.json"), "utf8"));
    }
  } catch (error) {
    if (!compressed && !inline && error && typeof error === "object" && "code" in error && error.code === "ENOENT") throw new ProtocolError("Protocol deployment is not configured.", 503);
    throw new ProtocolError("Invalid protocol deployment configuration.", 503);
  }
  if (!manifest || !isSupportedChain(manifest.chainId) || !manifest.contracts || typeof manifest.contracts !== "object" || Array.isArray(manifest.contracts)) throw new ProtocolError("Configure a Robinhood Chain production or Anvil deployment.", 503);
  for (const name of required) {
    if (!manifest.contracts[name]) throw new ProtocolError(`Missing ${name} deployment.`, 503);
  }
  for (const [name, contract] of Object.entries(manifest.contracts)) {
    if (!contract || typeof contract.address !== "string" || !isAddress(contract.address) || !Array.isArray(contract.abi)) throw new ProtocolError(`Invalid ${name} deployment.`, 503);
  }
  const blocks = [manifest.deploymentBlock ?? "0", manifest.contracts.CCA?.deploymentBlock ?? manifest.auction?.deploymentBlock ?? manifest.settings?.auction?.deploymentBlock ?? "0"];
  if (blocks.some((block) => !/^\d+$/.test(String(block)))) throw new ProtocolError("Invalid protocol deployment block.", 503);
  return manifest;
}

export async function chainContext(): Promise<ChainContext> {
  const manifest = await readDeploymentManifest();
  const rpcUrl = process.env.PROTOCOL_RPC_URL?.trim() || (typeof manifest.rpcUrl === "string" ? manifest.rpcUrl.trim() : undefined);
  const { client, chainId, url } = await configuredRpc(rpcUrl, manifest.chainId);
  const local = chainId === ANVIL.id;
  const accounts = (Array.isArray(manifest.accounts) ? manifest.accounts : []).flatMap((item): Address[] => {
    const address = typeof item === "string" ? item : item && typeof item === "object" && "address" in item ? (item as { address: unknown }).address : null;
    return typeof address === "string" && isAddress(address) ? [getAddress(address)] : [];
  });
  return { manifest, client, rpcUrl: url.href, chainId, local, accounts, fromBlock: BigInt(manifest.deploymentBlock ?? "0") };
}

/** Verify that the RPC matches the selected production or Anvil deployment. */
export async function configuredRpc(rpcUrl: string | undefined, expectedChainId: number) {
  if (!isSupportedChain(expectedChainId)) throw new ProtocolError("Only Robinhood Chain production and Anvil are supported.", 503);
  if (!rpcUrl) throw new ProtocolError("Protocol RPC is not configured.", 503);
  let url: URL;
  try { url = new URL(rpcUrl); } catch { throw new ProtocolError("Invalid protocol RPC configuration.", 503); }
  if (!["http:", "https:"].includes(url.protocol)) throw new ProtocolError("Invalid protocol RPC protocol.", 503);
  if (expectedChainId === ANVIL.id && !isLocalRpcHost(url.hostname)) throw new ProtocolError("Anvil requires a local RPC endpoint.", 503);
  const key = `${url.href}:${expectedChainId}`;
  let pending = configuredRpcs.get(key);
  if (!pending) {
    pending = connectRpc(url, expectedChainId);
    configuredRpcs.set(key, pending);
    pending.catch(() => { if (configuredRpcs.get(key) === pending) configuredRpcs.delete(key); });
  }
  return pending;
}

async function connectRpc(url: URL, expectedChainId: number) {
  // The production endpoint applies a fairly tight HTTP request-rate limit.
  // Batch concurrent reads and retry transient transport failures.
  const client = createPublicClient({ transport: http(url.href, { batch: { batchSize: 20, wait: 5 }, timeout: 20_000, retryCount: 1 }) });
  let chainId: number;
  try { chainId = await client.getChainId(); } catch { throw new ProtocolError("The configured chain is unavailable.", 503); }
  if (!isSupportedChain(chainId)) throw new ProtocolError("Only Robinhood Chain production and Anvil are supported.", 503);
  if (chainId !== expectedChainId) throw new ProtocolError("The configured RPC is on a different chain.", 503);
  if (chainId === ANVIL.id) {
    const version = await client.request({ method: "web3_clientVersion" });
    if (!/anvil/i.test(version)) throw new ProtocolError("The local RPC must run Anvil.", 503);
  }
  return { client, chainId, url };
}

export async function publicConfig(request: Request): Promise<ProtocolConfig> {
  if (new URL(request.url).search) throw new ProtocolError("Invalid deployment metadata request.");
  const manifest = await readDeploymentManifest();
  const chainId = manifest.chainId;
  const contracts = Object.fromEntries(Object.entries(manifest.contracts).map(([key, value]) => [key, getAddress(value.address)]));
  // Registration metadata only: never expose a credentialed server RPC or serve a proxy.
  const { name: chainName, rpcUrl, explorerUrl } = deploymentNetwork(chainId);
  const auction = manifest.contracts.CCA;
  const deployment = { deploymentBlock: String(manifest.deploymentBlock ?? "0"),
    contracts: Object.fromEntries(Object.entries(manifest.contracts).map(([name, contract]) => [name, {
      address: getAddress(contract.address), abi: contract.abi,
      ...(contract.deploymentBlock === undefined ? {} : { deploymentBlock: String(contract.deploymentBlock) }),
    }])) };
  let localAccounts: Address[] | undefined;
  if (chainId === ANVIL.id && Array.isArray(manifest.accounts) && manifest.accounts.length) {
    localAccounts = (await chainContext()).accounts;
  }
  return { chainId, chainName, rpcUrl, explorerUrl, contracts, deployment,
    launch: auction ? { chainId, chainName, rpcUrl, explorerUrl, auctionAddress: getAddress(auction.address), auctionDeploymentBlock: String(auction.deploymentBlock ?? manifest.auction?.deploymentBlock ?? manifest.settings?.auction?.deploymentBlock ?? manifest.deploymentBlock ?? "0"), tokenAddress: contracts.RF, wethAddress: contracts.WETH } : null,
    ...(localAccounts ? { localAccounts } : {}),
  };
}

export function deploymentNetwork(chainId: number) {
  try { return publicProtocolNetwork(chainId, process.env.PROTOCOL_PUBLIC_RPC_URL); }
  catch { throw new ProtocolError("Invalid public wallet network configuration.", 503); }
}

export function apiFailure(error: unknown) {
  if (error instanceof ProtocolError) return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
  if (process.env.NODE_ENV === "development") console.error("Protocol request failed", JSON.stringify(error instanceof Error ? { name: error.name, message: "shortMessage" in error ? String(error.shortMessage) : error.message, stack: error.stack?.split("\n").slice(-5).join("\n") } : "Unknown failure"));
  return Response.json({ error: "The chain request could not be completed." }, { status: 502, headers: { "cache-control": "no-store" } });
}

export function requestOrigin(request: Request) {
  const parsed = new URL(request.url);
  const host = request.headers.get("host") ?? parsed.host;
  if (!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i.test(host)) throw new ProtocolError("Invalid request host.", 400);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "https" || forwardedProtocol === "http" ? `${forwardedProtocol}:` : parsed.protocol;
  return new URL(`${protocol}//${host}`).origin;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin(request)) throw new ProtocolError("Cross-origin requests are not allowed.", 403);
}

export async function jsonBody(request: Request, max = 131_072): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new ProtocolError("Request is too large.", 413);
  const raw = await request.text();
  if (raw.length > max) throw new ProtocolError("Request is too large.", 413);
  try { return JSON.parse(raw); } catch { throw new ProtocolError("Invalid JSON request."); }
}
