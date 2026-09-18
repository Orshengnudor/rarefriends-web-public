import { formatEther, getAddress, type Address } from "viem";
import { contractRead, type ChainContext } from "@/src/lib/protocol/chain-context";
import type { ProtocolConfig, ProtocolState } from "../features/protocol/types";
import { walletRpcClient, walletRpcScope, type WalletRpc } from "./wallet-rpc";

/** Public metadata supplies addresses/ABIs, while every chain call uses the wallet. */
export function walletChainContext(config: ProtocolConfig, wallet: WalletRpc): ChainContext {
  const deployment = config.deployment;
  if (!deployment) throw new Error("The public deployment metadata is unavailable. Refresh before continuing.");
  for (const [name, contract] of Object.entries(deployment.contracts)) {
    if (getAddress(contract.address) !== getAddress(config.contracts[name])) throw new Error("The deployment addresses changed. Refresh before continuing.");
  }
  return { chainId: config.chainId, manifest: { ...deployment, chainId: config.chainId },
    client: walletRpcClient(wallet, config.chainId), rpcUrl: walletRpcScope(wallet),
    local: false, accounts: [], fromBlock: BigInt(deployment.deploymentBlock) };
}

/**
 * Holdings and protocol displays follow the swap-quote pattern: the browser calls the site's own
 * route, and that Node.js route reads PROTOCOL_RPC_URL server-side. The wallet's RPC is used only
 * for balances and transaction submission; the browser never calls Alchemy or scans history itself.
 */
export async function readServerProtocolState(address?: Address, signal?: AbortSignal): Promise<ProtocolState> {
  signal?.throwIfAborted();
  const query = address ? `?${new URLSearchParams({ address })}` : "";
  const response = await fetch(`/api/protocol/state${query}`, { signal, cache: "no-store", headers: { accept: "application/json" } });
  const body = await response.json().catch(() => undefined) as { error?: unknown; account?: unknown; protocol?: unknown; blockNumber?: unknown; timestamp?: unknown } | undefined;
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Holdings are unavailable right now. Refresh to try again.");
  const account = body?.account;
  const protocol = body?.protocol as Partial<ProtocolState["protocol"]> | undefined;
  if (!body || (account !== null && (!account || typeof account !== "object" || !Array.isArray((account as { friends?: unknown }).friends)))
    || !protocol || typeof protocol !== "object" || !protocol.metrics || !protocol.prices || !protocol.reserve
    || typeof protocol.marketReady !== "boolean" || typeof body.blockNumber !== "string" || !/^\d+$/.test(body.blockNumber)
    || typeof body.timestamp !== "number" || !Number.isFinite(body.timestamp)) {
    throw new Error("The holdings response was not recognized. Refresh to try again.");
  }
  return body as unknown as ProtocolState;
}

export interface WalletBalances { eth: number; weth: number; tokenBalance: number }

/** The swap card needs two balances, not every NFT, reward and activity record. */
export async function readWalletBalances(config: ProtocolConfig, wallet: WalletRpc, address: Address): Promise<WalletBalances> {
  const context = walletChainContext(config, wallet);
  const head = await context.client.getBlock();
  const [native, rf, weth] = await Promise.all([
    context.client.getBalance({ address, blockNumber: head.number }),
    contractRead<bigint>(context, "RF", "balanceOf", [address], head.number),
    contractRead<bigint>(context, "WETH", "balanceOf", [address], head.number),
  ]);
  return { eth: Number(formatEther(native)), weth: Number(formatEther(weth)), tokenBalance: Number(formatEther(rf)) };
}

export async function readWalletReserve(config: ProtocolConfig, wallet: WalletRpc) {
  const context = walletChainContext(config, wallet);
  const { readReserveStatus } = await import("@/src/lib/protocol/reserve");
  const head = await context.client.getBlock();
  const state = await readReserveStatus(context, head.number);
  if ((await context.client.getBlock({ blockNumber: head.number })).hash !== head.hash) {
    throw new Error("The chain changed while reading the Reserve. Refresh to continue.");
  }
  return state;
}
