import type { Hex } from "viem";
import { ROBINHOOD_MAINNET } from "../../config/networks.ts";
import { ProtocolError, type ChainContext } from "../../lib/protocol/chain-context.ts";

export interface ProtocolSnapshot {
  v: 1;
  blockNumber: string;
  blockHash: Hex;
  activatedGenesis: number;
  friendsPlaying: number;
  genesisWeight: string;
  generationsWeight: string;
  activationPaid: string;
  ammVolume: string;
  claimedRf: string;
  claimedWeth: string;
}

export interface SnapshotPublication {
  chainId: number;
  generatedAt: string;
  blockTimestamp: number;
  finalizedBlock: string;
  protocolSnapshot: ProtocolSnapshot;
  stale?: false;
}

const defaultUrl = "https://rarefriends-snapshot.rarefriends-protocol.workers.dev/snapshot.json";
const maxBytes = 16 * 1024;
const maxAge = 15 * 60_000;
const maxFuture = 30_000;
const uint256Max = (1n << 256n) - 1n;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unsigned(value: unknown): string {
  if (typeof value !== "string" || value.length > 78 || !/^(0|[1-9][0-9]*)$/.test(value)
    || BigInt(value) > uint256Max) throw new Error("Invalid snapshot amount.");
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid snapshot count.");
  return value;
}

/** Production history totals have one source. A failed or stale publication never falls back to the manifest. */
export async function readProtocolTotals(context: Pick<ChainContext, "chainId" | "local" | "fromBlock">, fetcher = fetch): Promise<SnapshotPublication> {
  try {
    if (context.local || context.chainId !== ROBINHOOD_MAINNET.id) throw new Error("Unsupported snapshot network.");
    const url = new URL(process.env.PROTOCOL_SNAPSHOT_URL?.trim() || defaultUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Invalid snapshot URL.");
    const options: RequestInit & { next: { revalidate: number } } = {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000), redirect: "error", next: { revalidate: 60 },
    };
    const response = await fetcher(url.href, options);
    if (!response.ok || Number(response.headers.get("content-length")) > maxBytes || !response.body) {
      await response.body?.cancel();
      throw new Error("Snapshot response is unavailable or oversized.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new Error("Snapshot response is oversized.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const body: unknown = JSON.parse(text);
    if (!object(body) || body.chainId !== ROBINHOOD_MAINNET.id || (body.stale !== undefined && body.stale !== false)
      || typeof body.generatedAt !== "string" || !object(body.protocolSnapshot)) throw new Error("Invalid snapshot publication.");
    const generatedAt = Date.parse(body.generatedAt);
    const blockTimestamp = count(body.blockTimestamp);
    const now = Date.now();
    if (![generatedAt, blockTimestamp * 1000].every(time => Number.isFinite(time) && now - time <= maxAge && time - now <= maxFuture)) {
      throw new Error("Snapshot publication is not fresh.");
    }
    const raw = body.protocolSnapshot;
    if (raw.v !== 1 || typeof raw.blockHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw.blockHash)) throw new Error("Invalid snapshot identity.");
    const protocolSnapshot: ProtocolSnapshot = {
      v: 1, blockNumber: unsigned(raw.blockNumber), blockHash: raw.blockHash as Hex,
      activatedGenesis: count(raw.activatedGenesis), friendsPlaying: count(raw.friendsPlaying),
      genesisWeight: unsigned(raw.genesisWeight), generationsWeight: unsigned(raw.generationsWeight),
      activationPaid: unsigned(raw.activationPaid), ammVolume: unsigned(raw.ammVolume),
      claimedRf: unsigned(raw.claimedRf), claimedWeth: unsigned(raw.claimedWeth),
    };
    const finalizedBlock = unsigned(body.finalizedBlock);
    if (protocolSnapshot.activatedGenesis > protocolSnapshot.friendsPlaying
      || BigInt(protocolSnapshot.blockNumber) < context.fromBlock
      || BigInt(finalizedBlock) > BigInt(protocolSnapshot.blockNumber)) throw new Error("Inconsistent snapshot publication.");
    return { chainId: body.chainId, generatedAt: body.generatedAt, blockTimestamp, finalizedBlock, protocolSnapshot,
      ...(body.stale === false ? { stale: false as const } : {}) };
  } catch {
    throw new ProtocolError("Protocol snapshot is unavailable. Please try again shortly.", 503);
  }
}
