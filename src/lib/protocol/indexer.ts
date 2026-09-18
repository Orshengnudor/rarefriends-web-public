import { decodeEventLog, type Address, type Hex } from "viem";
import type { ProtocolData } from "@/src/features/protocol/types";
import { ProtocolError, type ChainContext } from "@/src/lib/protocol/chain-context";

export const UNIT = 10n ** 18n;
export const units = (value: bigint) => Number(value) / 1e18;
export const integer = (value: unknown) => BigInt(String(value ?? 0));
export const addressValue = (value: unknown) => String(value ?? "").toLowerCase();
export interface ChainEvent { name: string; contract: string; args: Record<string, unknown>; block: bigint; at: number; transactionHash: Hex; logIndex: number }
export interface IndexedNft { collection: "Genesis" | "Generations"; id: bigint; owner: Address }
export interface IndexedPosition { collection: string; id: bigint; holder: string; tier: number; weight: bigint }
export interface ChainIndex { events: ChainEvent[]; nfts: Map<string, IndexedNft>; positions: Map<string, IndexedPosition>; at: number; block: bigint; artworkRevisions?: Map<string, string>; artworkEpoch?: string }

export function supportsFriendRewards(context: ChainContext) {
  return context.manifest.contracts.ActivationManager.abi.some((item) => item.type === "function" && item.name === "earned" && item.inputs.length === 3);
}

export function ownedRewardFriends(context: ChainContext, index: ChainIndex, holder?: string) {
  const account = holder?.toLowerCase();
  return new Set([...index.nfts.values()]
    .filter((nft) => nft.owner.toLowerCase() === account)
    .map((nft) => `${context.manifest.contracts[nft.collection].address.toLowerCase()}:${nft.id}`));
}

export type IndexHead = { number: bigint; timestamp: bigint; hash: Hex };
type IndexSession = { head?: IndexHead; index?: ChainIndex; pending: Map<Hex, Promise<ChainIndex>>; tail?: Promise<ChainIndex> };
const indexes = new Map<string, IndexSession>();
const INDEX_CONTRACTS = ["Genesis", "Generations", "ActivationManager", "Market", "Hook"];
const MAX_INDEX_EVENTS = 100_000;
let artworkEpoch = 0;

export async function mapBounded<T, R>(items: T[], map: (item: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await map(items[index]); }
  }));
  return output;
}

/** One bounded, incremental history per wallet session and deployment, shared by all readers. */
export async function chainIndex(context: ChainContext, block: IndexHead): Promise<ChainIndex> {
  const key = `${context.rpcUrl}:${context.chainId}:${INDEX_CONTRACTS.map(name => context.manifest.contracts[name].address.toLowerCase()).join(":")}:${supportsFriendRewards(context)}:${context.fromBlock}`;
  let session = indexes.get(key);
  if (!session) { session = { pending: new Map() }; indexes.set(key, session); }
  // Touch the session, not each block: ordinary refreshes no longer evict their history.
  indexes.delete(key); indexes.set(key, session);
  while (indexes.size > 8) indexes.delete(indexes.keys().next().value!);
  if (session.head?.hash === block.hash && session.head.number === block.number && session.index) return session.index;
  const existing = session.pending.get(block.hash);
  if (existing) return existing;
  const current = session;
  // Serialize different heads, so concurrent requests cannot append the same logs twice.
  const pending = (current.tail ?? Promise.resolve()).catch(() => undefined).then(async () => {
    let previous = current.index;
    if (current.head?.hash === block.hash && current.head.number === block.number && previous) return previous;
    if (current.head && previous) {
      if (block.number <= current.head.number
        || (await context.client.getBlock({ blockNumber: current.head.number })).hash !== current.head.hash) previous = undefined;
    }
    const next = await buildIndex(context, block, previous);
    // Never publish mixed-fork log/metadata history; a failed attempt leaves the old snapshot intact.
    if ((await context.client.getBlock({ blockNumber: block.number })).hash !== block.hash) {
      throw new ProtocolError("The chain changed while indexing Friends. Refresh to continue.", 503);
    }
    current.head = block; current.index = next;
    return next;
  });
  current.pending.set(block.hash, pending); current.tail = pending;
  void pending.then(() => current.pending.delete(block.hash), () => current.pending.delete(block.hash));
  return pending;
}

async function buildIndex(context: ChainContext, block: IndexHead, previous?: ChainIndex, maxEvents = MAX_INDEX_EVENTS): Promise<ChainIndex> {
  const contracts = INDEX_CONTRACTS;
  const names = new Map(contracts.map((name) => [context.manifest.contracts[name].address.toLowerCase(), name]));
  const pages: bigint[] = [];
  const start = previous ? previous.block + 1n : context.fromBlock;
  for (let from = start; from <= block.number; from += 10_000n) pages.push(from);
  if (pages.length > 200) throw new ProtocolError("This deployment requires a persistent event index before it can be displayed.", 503);
  const batches = await mapBounded(pages, async fromBlock => {
    const toBlock = fromBlock + 9_999n < block.number ? fromBlock + 9_999n : block.number;
    const logs = await context.client.getLogs({ address: contracts.map((name) => context.manifest.contracts[name].address), fromBlock, toBlock });
    for (const log of logs) {
      if (log.removed || log.blockNumber === null || log.blockNumber < fromBlock || log.blockNumber > toBlock
        || log.logIndex === null || !log.transactionHash || !names.has(log.address.toLowerCase())) {
        throw new ProtocolError("The wallet RPC returned inconsistent Friend events. Refresh to continue.", 503);
      }
    }
    return logs;
  }, 2);
  const raw = batches.flat().sort((left, right) => Number(left.blockNumber! - right.blockNumber!) || left.logIndex! - right.logIndex!);
  if (raw.length + (previous?.events.length ?? 0) > maxEvents) throw new ProtocolError("This deployment requires a persistent event index before it can be displayed.", 503);
  const identities = new Set<string>();
  for (const log of raw) {
    const identity = `${log.blockNumber}:${log.logIndex}`;
    if (identities.has(identity)) throw new ProtocolError("The wallet RPC returned duplicate Friend events. Refresh to continue.", 503);
    identities.add(identity);
  }
  const blockNumbers = [...new Set(raw.map((log) => log.blockNumber!))];
  const headers = new Map(await mapBounded(blockNumbers, async number => [number, number === block.number ? block : await context.client.getBlock({ blockNumber: number })] as const, 2));
  const events: ChainEvent[] = previous ? [...previous.events] : [];
  const nfts = new Map(previous?.nfts);
  const positions = new Map(previous?.positions);
  const revisions = new Map(previous?.artworkRevisions);
  for (const log of raw) {
    const contract = names.get(log.address.toLowerCase())!;
    const header = headers.get(log.blockNumber!)!;
    if (log.blockHash && log.blockHash !== header.hash) throw new ProtocolError("The chain changed while indexing Friend events. Refresh to continue.", 503);
    const revision = `${header.hash}:${log.transactionHash}:${log.logIndex}`;
    let decoded;
    try { decoded = decodeEventLog({ abi: context.manifest.contracts[contract].abi, data: log.data, topics: log.topics, strict: true }); }
    catch (error) {
      if (!(error instanceof Error) || error.name !== "AbiEventSignatureNotFoundError") {
        throw new ProtocolError("The wallet RPC returned an invalid Friend event. Refresh to continue.", 503);
      }
      // Unknown ABI events cannot justify reusing mutable art across blocks.
      if (contract === "Genesis" || contract === "Generations") revisions.set(`${contract}:*`, revision);
      if (contract === "ActivationManager") { revisions.set("Genesis:*", revision); revisions.set("Generations:*", revision); }
      continue;
    }
    if (!decoded.eventName) continue;
    const args = (decoded.args ?? {}) as unknown as Record<string, unknown>;
    const event: ChainEvent = { name: decoded.eventName, contract, args, block: log.blockNumber!, at: Number(header.timestamp), transactionHash: log.transactionHash!, logIndex: log.logIndex! };
    events.push(event);
    updateArtworkRevisions(context, revisions, event, revision);
    if ((contract === "Genesis" || contract === "Generations") && event.name === "Transfer") {
      const id = integer(args.tokenId);
      const key = `${contract}:${id}`;
      const owner = String(args.to) as Address;
      if (/^0x0{40}$/i.test(owner)) nfts.delete(key);
      else nfts.set(key, { collection: contract, id, owner });
    }
    updatePositions(positions, event);
  }
  return { events, nfts, positions, at: Number(block.timestamp), block: block.number, artworkRevisions: revisions,
    artworkEpoch: previous?.artworkEpoch ?? `${block.hash}:${++artworkEpoch}` };
}

// Approvals, contract ownership, royalties, sale settings, supply caps and reward accounting never change
// how a token renders. Funded in particular fires on every fee and would otherwise invalidate every image.
const ARTWORK_NEUTRAL_COLLECTION_EVENTS = new Set(["Approval", "ApprovalForAll", "OwnershipTransferred", "RoyaltyUpdated", "RoyaltyInfoUpdated",
  "ContractURIUpdated", "ProvenanceHashUpdated", "MaxSupplyUpdated", "AllowedSeaDropUpdated", "SeaDropTokenDeployed"]);
const ARTWORK_NEUTRAL_ACTIVATION_EVENTS = new Set(["Allocated", "Claimed", "Funded", "RewardsMigrated", "OwnershipTransferred"]);

function updateArtworkRevisions(context: ChainContext, revisions: Map<string, string>, event: ChainEvent, revision: string) {
  const { contract, name, args } = event;
  if (contract === "Genesis" || contract === "Generations") {
    if (ARTWORK_NEUTRAL_COLLECTION_EVENTS.has(name)) return;
    const token = args.tokenId ?? args._tokenId;
    revisions.set(`${contract}:${token === undefined ? "*" : integer(token)}`, revision);
  } else if (contract === "ActivationManager") {
    if (ARTWORK_NEUTRAL_ACTIVATION_EVENTS.has(name)) return;
    const collection = addressValue(args.collection);
    const collectionName = collection === context.manifest.contracts.Genesis.address.toLowerCase() ? "Genesis"
      : collection === context.manifest.contracts.Generations.address.toLowerCase() || event.name === "Hardwired" || event.name === "Promoted" ? "Generations" : undefined;
    for (const target of collectionName ? [collectionName] : ["Genesis", "Generations"]) revisions.set(`${target}:${args.tokenId === undefined ? "*" : integer(args.tokenId)}`, revision);
  }
}

/** Canonical event identity changes only when this NFT's artwork may have changed. */
export function artworkRevision(index: ChainIndex, collection: "Genesis" | "Generations", id: bigint): string | undefined {
  if (!index.artworkEpoch || !index.artworkRevisions) return undefined;
  return `${index.artworkEpoch}:${index.artworkRevisions.get(`${collection}:*`) ?? ""}:${index.artworkRevisions.get(`${collection}:${id}`) ?? ""}`;
}

export interface PortfolioIndexCheckpoint {
  v: 1;
  identity: string;
  head: IndexHead | null;
  events: ChainEvent[];
  artworkRevisions: [string, string][];
  artworkEpoch: string | null;
}

const validHash = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const validUnsigned = (value: unknown): value is bigint => typeof value === "bigint" && value >= 0n;
function validEventValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean" || typeof value === "bigint") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (typeof value === "string") return value.length <= 8192;
  if (Array.isArray(value)) return value.length <= 128 && value.every(item => validEventValue(item, depth + 1));
  return !!value && typeof value === "object" && Object.keys(value).length <= 128
    && Object.values(value).every(item => validEventValue(item, depth + 1));
}

/** One service-owned history, checkpointed between bounded canonical pages. */
export class PortfolioIndex {
  private head: IndexHead | null = null;
  private index: ChainIndex | null = null;
  private resetRevision = 0;
  private range: bigint;
  readonly identity: string;
  private readonly maxEvents: number;
  private context: ChainContext;
  private options: { range?: bigint; maxEvents?: number; onInvalidate?: () => void };
  constructor(context: ChainContext, options: { range?: bigint; maxEvents?: number; onInvalidate?: () => void } = {}) {
    this.context = context;
    this.options = options;
    this.range = options.range ?? 10_000n;
    this.maxEvents = options.maxEvents ?? 250_000;
    if (this.range < 1n || this.range > 10_000n || !Number.isSafeInteger(this.maxEvents) || this.maxEvents < 1 || this.maxEvents > 1_000_000) throw new Error("Invalid portfolio index limits.");
    this.identity = JSON.stringify([context.chainId, String(context.fromBlock), supportsFriendRewards(context),
      Object.entries(context.manifest.contracts).sort(([a], [b]) => a.localeCompare(b)).map(([name, contract]) => [name, contract.address.toLowerCase()])]);
  }
  state() { return { head: this.head, index: this.index }; }
  revision() { return this.resetRevision; }
  reset() {
    this.head = null;
    this.index = null;
    this.resetRevision++;
    this.options.onInvalidate?.();
  }
  checkpoint(): PortfolioIndexCheckpoint {
    return { v: 1, identity: this.identity, head: this.head, events: this.index?.events ?? [],
      artworkRevisions: [...this.index?.artworkRevisions ?? []], artworkEpoch: this.index?.artworkEpoch ?? null };
  }
  restore(saved: PortfolioIndexCheckpoint): boolean {
    try {
      if (!saved || saved.v !== 1 || saved.identity !== this.identity || !Array.isArray(saved.events) || saved.events.length > this.maxEvents
        || !Array.isArray(saved.artworkRevisions) || saved.artworkRevisions.length > this.maxEvents * 2 + 2) return false;
      if (saved.head === null) {
        if (saved.events.length || saved.artworkRevisions.length || saved.artworkEpoch !== null) return false;
        this.head = null; this.index = null; return true;
      }
      const head = saved.head;
      if (!head || !validUnsigned(head.number) || head.number < this.context.fromBlock || !validUnsigned(head.timestamp)
        || head.timestamp > BigInt(Number.MAX_SAFE_INTEGER) || !validHash(head.hash)
        || typeof saved.artworkEpoch !== "string" || !saved.artworkEpoch.length || saved.artworkEpoch.length > 256) return false;
      const nfts = new Map<string, IndexedNft>();
      const positions = new Map<string, IndexedPosition>();
      let previousBlock = this.context.fromBlock, previousLog = -1, previousAt = 0;
      for (const event of saved.events) {
        if (!event || !INDEX_CONTRACTS.includes(event.contract) || typeof event.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(event.name)
          || !validUnsigned(event.block) || event.block < previousBlock || event.block > head.number
          || !Number.isSafeInteger(event.logIndex) || event.logIndex < 0 || event.block === previousBlock && event.logIndex <= previousLog
          || !Number.isSafeInteger(event.at) || event.at < previousAt || event.at > Number(head.timestamp) || !validHash(event.transactionHash)
          || !event.args || typeof event.args !== "object" || Array.isArray(event.args) || !validEventValue(event.args)) return false;
        previousLog = event.logIndex; previousBlock = event.block; previousAt = event.at;
        if ((event.contract === "Genesis" || event.contract === "Generations") && event.name === "Transfer") {
          if (!validUnsigned(event.args.tokenId) || typeof event.args.to !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(event.args.to)) return false;
          const id = event.args.tokenId;
          const key = `${event.contract}:${id}`;
          if (/^0x0{40}$/i.test(event.args.to)) nfts.delete(key);
          else nfts.set(key, { collection: event.contract, id, owner: event.args.to as Address });
        }
        updatePositions(positions, event);
      }
      const revisions = new Map<string, string>();
      for (const pair of saved.artworkRevisions) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || !/^(Genesis|Generations):(?:\*|\d+)$/.test(pair[0])
          || typeof pair[1] !== "string" || !/^0x[0-9a-fA-F]{64}:0x[0-9a-fA-F]{64}:\d+$/.test(pair[1]) || revisions.has(pair[0])) return false;
        revisions.set(pair[0], pair[1]);
      }
      this.head = { ...head };
      this.index = { events: saved.events, nfts, positions, at: Number(head.timestamp), block: head.number,
        artworkRevisions: revisions, artworkEpoch: saved.artworkEpoch };
      return true;
    } catch { return false; }
  }
  async advance(target: IndexHead, options: { maxPages?: number; signal?: AbortSignal } = {}) {
    if (target.number < this.context.fromBlock) { this.reset(); throw new Error("Portfolio contracts are not deployed at this head."); }
    if (this.head && (this.head.number > target.number || (await this.context.client.getBlock({ blockNumber: this.head.number })).hash !== this.head.hash)) this.reset();
    let pages = 0;
    while ((!this.head || this.head.number < target.number) && pages < (options.maxPages ?? 4)) {
      options.signal?.throwIfAborted();
      const anchor = this.head;
      const from = anchor ? anchor.number + 1n : this.context.fromBlock;
      const to = from + this.range - 1n < target.number ? from + this.range - 1n : target.number;
      const end = to === target.number ? target : await this.context.client.getBlock({ blockNumber: to });
      if (!end.hash) throw new Error("Portfolio block is unavailable.");
      let next: ChainIndex;
      try { next = await buildIndex(this.context, end, this.index ?? undefined, this.maxEvents); }
      catch (error) {
        if (error instanceof Error && /chain changed/i.test(error.message)) { this.reset(); throw error; }
        if (this.range === 1n || error instanceof Error && /rate limit|unavailable|timeout|timed out|persistent event index/i.test(error.message)) throw error;
        this.range = this.range / 2n || 1n;
        continue;
      }
      if ((await this.context.client.getBlock({ blockNumber: to })).hash !== end.hash
        || anchor && (await this.context.client.getBlock({ blockNumber: anchor.number })).hash !== anchor.hash) {
        this.reset(); throw new Error("Portfolio index changed forks during catch-up.");
      }
      this.index = next;
      this.head = { number: to, hash: end.hash, timestamp: end.timestamp };
      pages++;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (this.head?.number === target.number && this.head.hash !== target.hash) { this.reset(); throw new Error("Portfolio head changed forks."); }
    return { complete: this.head?.number === target.number && this.head.hash === target.hash, ...this.state() };
  }
}

function updatePositions(positions: Map<string, IndexedPosition>, event: ChainEvent) {
  if (event.contract !== "ActivationManager") return;
  const collection = addressValue(event.args.collection);
  const id = integer(event.args.tokenId);
  const key = `${collection}:${id}`;
  if (event.name === "ActivationCleared") positions.delete(key);
  if (event.name === "Activated") positions.set(key, { collection, id, holder: addressValue(event.args.holder), tier: Number(event.args.tier), weight: integer(event.args.weight) });
}

const WEEK = 604_800;
const monday = (at: number) => Math.floor((at + 259_200) / WEEK) * WEEK - 259_200;
type WeekTotals = { rf: bigint; weth: bigint };
type RewardCycle = { start: number; finish: number; rate: bigint; budget: bigint; dripped: bigint };

/** New ledgers follow currently owned NFT identities across transfers; legacy ledgers follow holders. */
export function rewardHistory(context: ChainContext, index: ChainIndex, holder?: string) {
  const rf = context.manifest.contracts.RF.address.toLowerCase();
  const weth = context.manifest.contracts.WETH.address.toLowerCase();
  const positions = new Map<string, IndexedPosition>();
  const cycles: Record<"RF" | "WETH", RewardCycle> = { RF: { start: 0, finish: 0, rate: 0n, budget: 0n, dripped: 0n }, WETH: { start: 0, finish: 0, rate: 0n, budget: 0n, dripped: 0n } };
  const protocol = new Map<number, WeekTotals>();
  const personal = new Map<number, WeekTotals>();
  let totalWeight = 0n;
  let holderWeight = 0n;
  let previousTime = index.events[0]?.at ?? index.at;
  let totalRf = 0n;
  let totalWeth = 0n;
  let claimedRf = 0n;
  let claimedWeth = 0n;
  const account = holder?.toLowerCase();
  const friendRewards = supportsFriendRewards(context);
  const owned = ownedRewardFriends(context, index, holder);
  const relevantPosition = (position: IndexedPosition) => friendRewards
    ? owned.has(`${position.collection}:${position.id}`)
    : position.holder === account;

  function accrue(until: number) {
    if (totalWeight === 0n || until <= previousTime) return;
    for (const asset of ["RF", "WETH"] as const) {
      const cycle = cycles[asset];
      let cursor = Math.max(previousTime, cycle.start);
      const end = Math.min(until, cycle.finish);
      while (cursor < end && cycle.rate > 0n) {
        const week = monday(cursor);
        const boundary = Math.min(end, week + WEEK);
        const amount = BigInt(boundary - cursor) * cycle.rate;
        const earned = amount * holderWeight / totalWeight;
        const key = asset === "RF" ? "rf" : "weth";
        const all = protocol.get(week) ?? { rf: 0n, weth: 0n };
        const mine = personal.get(week) ?? { rf: 0n, weth: 0n };
        all[key] += amount;
        mine[key] += earned;
        protocol.set(week, all);
        personal.set(week, mine);
        cycle.dripped += amount;
        if (asset === "RF") totalRf += amount; else totalWeth += amount;
        cursor = boundary;
      }
    }
  }

  for (const event of index.events) {
    accrue(event.at);
    previousTime = event.at;
    if (event.contract !== "ActivationManager") continue;
    if (event.name === "Allocated") {
      const asset = addressValue(event.args.asset) === rf ? "RF" : addressValue(event.args.asset) === weth ? "WETH" : null;
      if (asset) {
        const budget = integer(event.args.amount);
        const finish = Number(event.args.finish);
        cycles[asset] = { start: finish - WEEK, finish, rate: budget / BigInt(WEEK), budget, dripped: 0n };
      }
    }
    const ownClaim = friendRewards
      ? owned.has(`${addressValue(event.args.collection)}:${integer(event.args.tokenId)}`)
      : account === addressValue(event.args.holder);
    if (event.name === "Claimed" && ownClaim) {
      if (addressValue(event.args.asset) === rf) claimedRf += integer(event.args.amount);
      if (addressValue(event.args.asset) === weth) claimedWeth += integer(event.args.amount);
    }
    if (event.name === "Activated" || event.name === "ActivationCleared") {
      const key = `${addressValue(event.args.collection)}:${integer(event.args.tokenId)}`;
      const before = positions.get(key);
      if (before) { totalWeight -= before.weight; if (relevantPosition(before)) holderWeight -= before.weight; }
      updatePositions(positions, event);
      const after = positions.get(key);
      if (after) { totalWeight += after.weight; if (relevantPosition(after)) holderWeight += after.weight; }
    }
  }
  accrue(index.at);
  const starts = [...new Set([...protocol.keys(), monday(index.at)])].sort((a, b) => a - b);
  const rows = (map: Map<number, WeekTotals>): ProtocolData["weekly"] => starts.map((start) => ({ start: start * 1000, rf: units(map.get(start)?.rf ?? 0n), weth: units(map.get(start)?.weth ?? 0n), partial: start + WEEK > index.at }));
  return { cycles, weekly: rows(protocol), holderWeekly: rows(personal), totalRf, totalWeth, claimedRf, claimedWeth };
}
