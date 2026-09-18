import type { AbiEvent, Address } from "viem";
import type { ProtocolState, ProtocolData } from "@/src/features/protocol/types";
import { contractRead, ProtocolError, type ChainContext } from "../../lib/protocol/chain-context";
import { type ChainIndex, type IndexedNft, units } from "../../lib/protocol/indexer";
import { chainPrices, readIndexedProtocolState } from "./state";
import { readEthUsdPrice } from "./prices";
import { readReserveStatus } from "../../lib/protocol/reserve";
import { rewardApyPercent } from "../../lib/protocol/metrics";

const WEEK = 604_800;
const MAX_OWNED = 1_500;
const MAX_ACTIVATION_LOGS = 50_000;
const REORG_OVERLAP_BLOCKS = 200n;
type ActivationIndex = {
  toBlock: bigint; paid: bigint;
  positions: Map<string, { collection: "Genesis" | "Generations"; weight: bigint }>;
  applied: Map<string, bigint>; pending?: Promise<void>;
};
export type ActivationSummary = { paid: bigint; friendsPlaying: number; activatedGenesis: number; genesisWeight: bigint; generationsWeight: bigint };
const activationIndexes = new Map<string, ActivationIndex>();

function activationEvents(context: ChainContext) {
  const manager = context.manifest.contracts.ActivationManager;
  const find = (name: string) => manager.abi.find((item): item is AbiEvent => item.type === "event" && item.name === name);
  const activated = find("Activated"), cleared = find("ActivationCleared");
  if (!activated || !cleared) throw new ProtocolError("The activation events are not deployed.", 503);
  return { manager, activated, cleared };
}

/**
 * Activation state from the ActivationManager's own events, kept in this instance's memory: RF everyone has paid
 * to activate, and which friends currently hold an active position. The first read is one log query over the whole
 * deployment; later reads fetch only the blocks since, re-reading a short overlap so a small reorg cannot leave a
 * duplicate or a phantom position. Nothing here pages through the historical event index.
 */
export async function readActivationSummary(context: ChainContext, toBlock: bigint): Promise<ActivationSummary> {
  const { manager, activated, cleared } = activationEvents(context);
  const genesis = context.manifest.contracts.Genesis.address.toLowerCase();
  const key = `${context.rpcUrl}:${context.chainId}:${manager.address.toLowerCase()}`;
  const index: ActivationIndex = activationIndexes.get(key) ?? { toBlock: context.fromBlock - 1n, paid: 0n, positions: new Map(), applied: new Map() };
  activationIndexes.set(key, index);
  if (index.pending) await index.pending;
  if (index.toBlock < toBlock) {
    const fromBlock = index.toBlock >= context.fromBlock ? (index.toBlock + 1n > REORG_OVERLAP_BLOCKS ? index.toBlock + 1n - REORG_OVERLAP_BLOCKS : context.fromBlock) : context.fromBlock;
    index.pending = (async () => {
      const logs = await context.client.getLogs({ address: manager.address, events: [activated, cleared], fromBlock: fromBlock < context.fromBlock ? context.fromBlock : fromBlock, toBlock });
      if (logs.length > MAX_ACTIVATION_LOGS) throw new ProtocolError("Activation history exceeds its supported bound.", 503);
      const ordered = [...logs].sort((left, right) => left.blockNumber === right.blockNumber ? Number(left.logIndex) - Number(right.logIndex) : left.blockNumber < right.blockNumber ? -1 : 1);
      for (const log of ordered) {
        if (log.blockNumber === null || log.logIndex === null) throw new ProtocolError("Pending activation events cannot be indexed.", 503);
        const eventKey = `${log.blockNumber}:${log.logIndex}`;
        if (index.applied.has(eventKey)) continue;
        const args = log.args as { collection?: unknown; tokenId?: unknown; weight?: unknown; payment?: unknown };
        const collection = typeof args.collection === "string" ? args.collection.toLowerCase() : "";
        if (typeof args.tokenId !== "bigint") throw new ProtocolError("Invalid activation event.", 503);
        const token = `${collection}:${args.tokenId}`;
        if (log.eventName === "Activated") {
          if (typeof args.payment !== "bigint" || args.payment < 0n || typeof args.weight !== "bigint" || args.weight < 0n) throw new ProtocolError("Invalid activation payment.", 503);
          index.paid += args.payment;
          index.positions.set(token, { collection: collection === genesis ? "Genesis" : "Generations", weight: args.weight });
        } else index.positions.delete(token);
        index.applied.set(eventKey, log.blockNumber);
      }
      // Only keys inside the next overlap window matter for deduplication.
      const floor = toBlock > REORG_OVERLAP_BLOCKS ? toBlock - REORG_OVERLAP_BLOCKS : 0n;
      for (const [eventKey, block] of index.applied) if (block < floor) index.applied.delete(eventKey);
      index.toBlock = toBlock;
    })();
    try { await index.pending; } finally { index.pending = undefined; }
  }
  let activatedGenesis = 0, genesisWeight = 0n, generationsWeight = 0n;
  for (const position of index.positions.values()) {
    if (position.collection === "Genesis") { activatedGenesis++; genesisWeight += position.weight; } else generationsWeight += position.weight;
  }
  return { paid: index.paid, friendsPlaying: index.positions.size, activatedGenesis, genesisWeight, generationsWeight };
}

const MAX_PAGES = 20;
const monday = (at: number) => Math.floor((at + 259_200) / WEEK) * WEEK - 259_200;

/** Alchemy's NFT API for the same key as the JSON-RPC URL: https://<network>.g.alchemy.com/v2/<key>. */
export function alchemyNftEndpoint(rpcUrl: string, method: string): string {
  const match = /^(https:\/\/[a-z0-9-]+\.g\.alchemy\.com)\/v2\/([A-Za-z0-9_-]+)$/.exec(rpcUrl.trim());
  if (!match) throw new ProtocolError("Wallet NFT lookups need an Alchemy RPC URL.", 503);
  return `${match[1]}/nft/v3/${match[2]}/${method}`;
}

/** Current Genesis and Generations tokens of one wallet via getNFTsForOwner v3; no event history is read. */
export async function readOwnedNfts(context: ChainContext, owner: Address, fetcher: typeof fetch = fetch): Promise<IndexedNft[]> {
  const endpoint = alchemyNftEndpoint(context.rpcUrl, "getNFTsForOwner");
  const collections = new Map<string, IndexedNft["collection"]>([
    [context.manifest.contracts.Genesis.address.toLowerCase(), "Genesis"],
    [context.manifest.contracts.Generations.address.toLowerCase(), "Generations"],
  ]);
  const owned = new Map<string, IndexedNft>();
  let pageKey: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ owner, withMetadata: "false", pageSize: "100" });
    for (const address of collections.keys()) query.append("contractAddresses[]", address);
    if (pageKey) query.set("pageKey", pageKey);
    const response = await fetcher(`${endpoint}?${query}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new ProtocolError("The wallet NFT lookup failed. Refresh to try again.", 502);
    const body = await response.json() as { ownedNfts?: unknown; pageKey?: unknown };
    if (!Array.isArray(body.ownedNfts)) throw new ProtocolError("The wallet NFT lookup returned an unexpected response.", 502);
    for (const item of body.ownedNfts as Array<{ contractAddress?: unknown; tokenId?: unknown }>) {
      const collection = typeof item?.contractAddress === "string" ? collections.get(item.contractAddress.toLowerCase()) : undefined;
      if (!collection || typeof item.tokenId !== "string" || !/^\d{1,78}$/.test(item.tokenId)) continue;
      const id = BigInt(item.tokenId);
      owned.set(`${collection}:${id}`, { collection, id, owner });
      if (owned.size > MAX_OWNED) throw new ProtocolError("This wallet requires paginated NFT indexing.", 503);
    }
    if (typeof body.pageKey !== "string" || !body.pageKey) break;
    pageKey = body.pageKey;
  }
  return [...owned.values()];
}

/**
 * One wallet's holdings from the server RPC with no protocol event history: NFT ownership comes from
 * Alchemy's NFT API and every figure is a live contract read at one block. History-derived numbers the
 * pages do not show (activity, claimed totals, protocol volume, activation counts) are empty or zero.
 */
export async function readWalletPortfolioState(address: Address, context: ChainContext, usdReader = readEthUsdPrice): Promise<ProtocolState> {
  const [owned, base] = await Promise.all([readOwnedNfts(context, address), readProtocolSnapshot(context, usdReader)]);
  const block = BigInt(base.blockNumber);
  const index: ChainIndex = { events: [], nfts: new Map(owned.map(nft => [`${nft.collection}:${nft.id}`, nft])), positions: new Map(), at: base.timestamp / 1000, block };
  const [state, paid] = await Promise.all([readIndexedProtocolState(address, context, index, base), readHolderActivationPaid(context, address, block)]);
  return state.account ? { ...state, account: { ...state.account, activationPaid: units(paid) } } : state;
}

/** RF this wallet has paid to activate or upgrade friends: one holder-filtered log query, small by construction. */
export async function readHolderActivationPaid(context: ChainContext, holder: Address, toBlock: bigint): Promise<bigint> {
  const { manager, activated: event } = activationEvents(context);
  const logs = await context.client.getLogs({ address: manager.address, event, args: { holder }, fromBlock: context.fromBlock, toBlock });
  if (logs.length > MAX_ACTIVATION_LOGS) throw new ProtocolError("Activation history exceeds its supported bound.", 503);
  let total = 0n;
  for (const log of logs) {
    const payment = (log.args as { payment?: unknown }).payment;
    if (typeof payment !== "bigint" || payment < 0n) throw new ProtocolError("Invalid activation payment.", 503);
    total += payment;
  }
  return total;
}

/**
 * Protocol figures from bounded live contract views at one block. This path deliberately does not scan
 * activation history: global history-derived counts and APY are supplied only by a separate snapshot source.
 * Wallet-specific reads may still use the holder-filtered activation query below.
 */
export async function readProtocolSnapshot(context: ChainContext, usdReader = readEthUsdPrice): Promise<ProtocolState> {
  const snapshot = context.manifest.protocolSnapshot;
  if (!snapshot || snapshot.v !== 1) throw new ProtocolError("The deployment protocol snapshot is missing. Re-export the deployment after running the one-time snapshot step.", 503);
  let activationPaid: bigint, ammVolume: bigint, claimedRf: bigint, claimedWeth: bigint;
  try {
    activationPaid = BigInt(snapshot.activationPaid); ammVolume = BigInt(snapshot.ammVolume);
    claimedRf = BigInt(snapshot.claimedRf); claimedWeth = BigInt(snapshot.claimedWeth);
  } catch { throw new ProtocolError("The deployment protocol snapshot is invalid.", 503); }
  const block = await context.client.getBlock();
  if (block.number === null || block.hash === null) throw new ProtocolError("The latest block is unavailable.", 503);
  const at = Number(block.timestamp);
  const { RF, WETH } = context.manifest.contracts;
  const [prices, initialSupply, currentSupply, inventory, totalWeight, rfStream, wethStream, reserve] = await Promise.all([
    chainPrices(context, block.number, usdReader),
    contractRead<bigint>(context, "RF", "INITIAL_SUPPLY", [], block.number),
    contractRead<bigint>(context, "RF", "totalSupply", [], block.number),
    contractRead<bigint>(context, "Reserve", "inventoryCount", [], block.number),
    contractRead<bigint>(context, "ActivationManager", "totalWeight", [], block.number),
    contractRead<readonly bigint[]>(context, "ActivationManager", "streams", [RF.address], block.number),
    contractRead<readonly bigint[]>(context, "ActivationManager", "streams", [WETH.address], block.number),
    readReserveStatus(context, block.number),
  ]);
  const stream = (asset: "RF" | "WETH", stored: readonly bigint[]): ProtocolData["streams"][number] => {
    const [pending = 0n, rate = 0n, finish = 0n, lastUpdate = 0n] = stored;
    const accountedUntil = BigInt(at) > lastUpdate ? BigInt(at) : lastUpdate;
    const remainingSeconds = finish > accountedUntil ? finish - accountedUntil : 0n;
    return { asset, start: finish > 0n ? (Number(finish) - WEEK) * 1000 : 0, end: Number(finish) * 1000, budget: units(rate * BigInt(WEEK)),
      dripped: 0, pending: units(pending), remaining: units(rate * remainingSeconds) };
  };
  const streams = [stream("RF", rfStream), stream("WETH", wethStream)];
  const activeRate = (stored: readonly bigint[]) => (stored[2] ?? 0n) > BigInt(at) ? stored[1] ?? 0n : 0n;
  const weekDrip = (stored: readonly bigint[]) => {
    const [, rate = 0n, finish = 0n] = stored;
    const from = Math.max(Number(finish) - WEEK, monday(at)), to = Math.min(Number(finish), at);
    return totalWeight > 0n && to > from ? units(rate * BigInt(to - from)) : 0;
  };
  const weekRf = weekDrip(rfStream), weekWeth = weekDrip(wethStream);
  const weekly = [{ start: monday(at) * 1000, rf: weekRf, weth: weekWeth, partial: true }];
  // Still to pay = what the running cycle has not released yet plus fees waiting for the next allocation.
  const remainingRf = (streams[0].remaining ?? 0) + streams[0].pending, remainingWeth = (streams[1].remaining ?? 0) + streams[1].pending;
  const protocol: ProtocolData = {
    reserve, streams, weekly, holderWeekly: weekly, marketReady: prices.marketReady,
    metrics: { initialSupply: units(initialSupply), supplyBurned: units(initialSupply - currentSupply), vaultInventory: Number(inventory),
      ammVolumeEth: units(ammVolume), ammVolumeUsd: units(ammVolume) * prices.ethUsd, activatedGenesis: snapshot.activatedGenesis,
      genesisWeight: units(BigInt(snapshot.genesisWeight)), generationsWeight: units(BigInt(snapshot.generationsWeight)),
      distributedRf: units(claimedRf), distributedWeth: units(claimedWeth), distributedUsd: units(claimedRf) * prices.rfUsd + units(claimedWeth) * prices.ethUsd,
      streamRemainingRf: remainingRf, streamRemainingWeth: remainingWeth, streamRemainingUsd: remainingRf * prices.rfUsd + remainingWeth * prices.ethUsd,
      weekRewardsRf: weekRf, weekRewardsWeth: weekWeth, weekRewardsUsd: weekRf * prices.rfUsd + weekWeth * prices.ethUsd,
      rewardApy: rewardApyPercent({ rateRf: activeRate(rfStream), rateWeth: activeRate(wethStream), pendingRf: rfStream[0] ?? 0n, pendingWeth: wethStream[0] ?? 0n }, activationPaid, prices),
      friendsPlaying: snapshot.friendsPlaying,
      },
    prices: { ethUsd: prices.ethUsd, rfUsd: prices.rfUsd, label: prices.label, usdAvailable: prices.usdAvailable,
      usdSource: prices.usdSource, usdUpdatedAt: prices.usdUpdatedAt, usdStale: prices.usdStale },
    coverage: { fromBlock: String(block.number), toBlock: String(block.number), rewards: "since-deployment", portfolio: "current-snapshot", nfts: "known-collections" },
  };
  return { account: null, protocol, blockNumber: String(block.number), timestamp: at * 1000 };
}
