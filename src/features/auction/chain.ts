import {
  decodeErrorResult, decodeEventLog, encodeFunctionData, erc20Abi, formatUnits,
  keccak256, parseAbi, parseUnits, toHex, zeroAddress, type Address, type Hex,
} from "viem";
import { launchAbi } from "./abi";
import { walletRpcClient, walletRpcScope, type WalletRpc } from "../../wallet/wallet-rpc";
import productionCca from "../../config/production-cca.json";
export { launchAbi } from "./abi";

export type LaunchConfig = {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl?: string;
  auctionAddress: Address;
  auctionDeploymentBlock: string;
  tokenAddress: Address;
};


export const Q96 = 1n << 96n;
export type LaunchBid = {
  id: bigint;
  startBlock: bigint;
  amount: bigint;
  maxPrice: bigint;
  exitedBlock: bigint;
  tokensFilled: bigint;
  purchased: bigint;
  refunded: bigint;
  claimed: boolean;
};
export type LaunchCheckpoint = { block: bigint; price: bigint };
export type LaunchState = {
  block: bigint;
  start: bigint;
  end: bigint;
  claim: bigint;
  endTime: { timestamp: number; estimated: boolean; blockTimeSeconds: number | null } | null;
  floor: bigint;
  tick: bigint;
  maxBidPrice: bigint;
  price: bigint;
  supply: bigint;
  tokenSupply: bigint;
  raised: bigint;
  /** Gross submitted bid amounts across all owners, including later refunds. */
  totalBidAmount?: bigint;
  /** Auction currency held by the contract at this block. */
  contractBalance?: bigint;
  sold: bigint;
  graduated: boolean;
  soldOut: boolean;
  minimumRaise: bigint | null;
  protocolFeesEnabled: boolean | null;
  funded: boolean;
  finalized: boolean;
  checkpointBlock: bigint;
  currency: Address;
  currencySymbol: string;
  currencyDecimals: number;
  tokenDecimals: number;
  balance: bigint | null;
  allowance: bigint;
  validationHook: Address;
  bids: LaunchBid[];
  checkpoints: LaunchCheckpoint[];
  ticks: bigint[];
};

export type LaunchClockState = Pick<LaunchState, "block" | "start" | "end" | "claim" | "funded" | "graduated" | "finalized" | "checkpointBlock" | "soldOut">;

export const launchClient = (config: LaunchConfig, wallet: WalletRpc) => walletRpcClient(wallet, config.chainId);
type LaunchClient = ReturnType<typeof launchClient>;

const arbSysAbi = parseAbi(["function arbBlockNumber() view returns (uint256)"]);
const fundingEvent = parseAbi(["event TokensReceived(uint128 totalSupply)"])[0];
const isProductionCca = (config: LaunchConfig) => config.chainId === productionCca.chainId
  && config.auctionAddress.toLowerCase() === productionCca.ccaAddress.toLowerCase();
const multicallOptions = (config: LaunchConfig) => ({
  // Keep checkpoint and its dependent reads in ONE eth_call, never separate chunks.
  batchSize: 0, allowFailure: false as const,
  ...(config.chainId === 4663
    ? { multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address }
    : { deployless: true }),
});

function walletReadUnavailable(error: unknown) {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const cause = current as { message?: string; cause?: unknown };
    if (typeof cause.message === "string" && /wallet.*(?:changed|did not respond|disconnect)|(?:switch|connect) your wallet|unsupported method|method (?:not found|not supported)|not authorized|unauthorized|user (?:rejected|denied)|timed out|timeout|too many requests|rate limit|rpc unavailable/i.test(cause.message)) return true;
    current = cause.cause;
  }
  return false;
}

async function auctionFunding(config: LaunchConfig, client: LaunchClient, block: bigint, supply: bigint) {
  const production = isProductionCca(config);
  let from = BigInt(production ? productionCca.notifiedBlock : config.auctionDeploymentBlock);
  const last = production ? from : block;
  if (from > block) return false;
  let range = 50_000n;
  while (from <= last) {
    const to = from + range - 1n > last ? last : from + range - 1n;
    try {
      const logs = await client.getLogs({ address: config.auctionAddress, event: fundingEvent, fromBlock: from, toBlock: to });
      if (logs.some(log => log.args.totalSupply === supply && (!production
        || log.transactionHash.toLowerCase() === productionCca.notificationTransactionHash.toLowerCase()))) return true;
      from = to + 1n;
    } catch (error) {
      if (from === to || walletReadUnavailable(error)) throw error;
      range = range / 2n || 1n;
    }
  }
  return false;
}

type LaunchSettings = {
  token: Address; currency: Address; supply: bigint; start: bigint; end: bigint; claim: bigint;
  floor: bigint; tick: bigint; maxBidPrice: bigint; validationHook: Address;
  minimumRaise: bigint | null; protocolFeesEnabled: boolean | null;
};
type SettingsCache = { block: bigint; hash: Hex; settings: Promise<LaunchSettings>; funded?: true };
const settingsCache = new Map<string, SettingsCache>();

async function readLaunchSettings(config: LaunchConfig, client: LaunchClient, block: bigint): Promise<LaunchSettings> {
  const contract = { address: config.auctionAddress, abi: launchAbi } as const;
  const [token, currency, supply, start, end, claim, floor, tick, maxBidPrice, validationHook] =
    await client.multicall({ ...multicallOptions(config), blockNumber: block, contracts: [
      { ...contract, functionName: "token" }, { ...contract, functionName: "currency" },
      { ...contract, functionName: "totalSupply" }, { ...contract, functionName: "startBlock" },
      { ...contract, functionName: "endBlock" }, { ...contract, functionName: "claimBlock" },
      { ...contract, functionName: "floorPrice" }, { ...contract, functionName: "tickSpacing" },
      { ...contract, functionName: "MAX_BID_PRICE" }, { ...contract, functionName: "validationHook" },
    ] });
  if (token.toLowerCase() !== config.tokenAddress.toLowerCase()) throw new Error("The configured auction sells a different token.");
  if (end <= start || claim < end || tick <= 0n) throw new Error("The auction settings are invalid.");
  let minimumRaise: bigint | null = null;
  let protocolFeesEnabled: boolean | null = null;
  if (isProductionCca(config)) {
    const expected = productionCca.settings;
    const code = await client.getCode({ address: config.auctionAddress, blockNumber: block });
    if (!code || keccak256(code) !== productionCca.runtimeHash
      || config.auctionDeploymentBlock !== productionCca.deploymentBlock
      || token.toLowerCase() !== productionCca.rfAddress.toLowerCase()
      || currency.toLowerCase() !== expected.currency.toLowerCase()
      || validationHook.toLowerCase() !== expected.validationHook.toLowerCase()
      || [supply, start, end, claim, floor, tick].some((value, index) => value !== BigInt([
        expected.totalSupply, expected.startBlock, expected.endBlock, expected.claimBlock, expected.floorPrice, expected.tickSpacing,
      ][index]))) throw new Error("The live auction does not match its verified production deployment. Bidding is disabled.");
    // These private immutables were decoded from the successful deployment transaction.
    // The runtime hash above includes them; do not infer them from a different auction.
    minimumRaise = BigInt(expected.requiredCurrencyRaised);
    protocolFeesEnabled = expected.protocolFeeController !== zeroAddress;
  }
  return { token, currency, supply, start, end, claim, floor, tick, maxBidPrice, validationHook, minimumRaise, protocolFeesEnabled };
}

/** Shared display/collector cache. Direct wallet verification bypasses it. */
async function readLaunchSnapshotWithClient(config: LaunchConfig, client: LaunchClient, cacheKey?: string) {
  const head = await client.getBlock();
  const block = head.number;
  if (block < BigInt(config.auctionDeploymentBlock)) throw new Error("The auction is not deployed at this block.");
  let cached = cacheKey ? settingsCache.get(cacheKey) : undefined;
  if (cached) {
    // A replacement fork can have a HIGHER head too. Validate the last
    // successful snapshot anchor, not just rollback/same-height changes.
    const anchor = cached.block > block ? null : cached.block === block ? head : await client.getBlock({ blockNumber: cached.block });
    if (anchor?.hash !== cached.hash) {
      settingsCache.delete(cacheKey!);
      currencyMetadata.delete(cacheKey!);
      cached = undefined;
    }
  }
  if (!cached) {
    cached = { block, hash: head.hash, settings: readLaunchSettings(config, client, block) };
    if (cacheKey) {
      settingsCache.set(cacheKey, cached);
      while (settingsCache.size > 8) settingsCache.delete(settingsCache.keys().next().value!);
      void cached.settings.catch(() => { if (settingsCache.get(cacheKey) === cached) settingsCache.delete(cacheKey); });
    }
  }
  const contract = { address: config.auctionAddress, abi: launchAbi } as const;
  const [chainId, settings, auctionBlock] = await Promise.all([
    client.getChainId(), cached.settings,
    config.chainId === 4663 ? client.readContract({ address: "0x0000000000000000000000000000000000000064",
      abi: arbSysAbi, functionName: "arbBlockNumber", blockNumber: block }) : block,
  ]);
  if (chainId !== config.chainId) throw new Error("The auction RPC is on a different chain.");
  if (auctionBlock !== block) throw new Error("The auction block clock does not match this RPC. Refresh using the correct network.");
  const { supply, start, end, floor } = settings;
  // A successful notification is permanent for this immutable CCA. An absent
  // notification is not cached, so subsequently funded auctions can become live.
  const funded = cached.funded ?? await auctionFunding(config, client, block, supply);
  const projected = funded && block >= start;
  // Capture the persisted checkpoint BEFORE simulating a new checkpoint; all
  // dependent accounting then shares that simulation in this single eth_call.
  const [checkpointBlock, point, raised, sold, graduated, remaining] = await client.multicall({
    ...multicallOptions(config), blockNumber: block, contracts: [
      { ...contract, functionName: "lastCheckpointedBlock" },
      { ...contract, functionName: projected ? "checkpoint" : "latestCheckpoint" },
      { ...contract, functionName: "currencyRaised" }, { ...contract, functionName: "totalCleared" },
      { ...contract, functionName: "isGraduated" }, { ...contract, functionName: "remainingSupplyQ96X7" },
    ],
  });
  const price = projected ? point.clearingPrice : point.clearingPrice || floor;
  const soldOut = funded && (remaining === 0n || point.cumulativeMps === 10_000_000);
  if ((await client.getBlock({ blockNumber: block })).hash !== head.hash) {
    if (cacheKey) settingsCache.delete(cacheKey);
    throw new Error("The chain changed while reading the auction. Refresh to continue.");
  }
  if (cacheKey) {
    // Advance the anchor only after the complete snapshot passed its hash
    // check, including when notification arrives after the first settings read.
    cached.block = block;
    cached.hash = head.hash;
    if (funded) cached.funded = true;
  }
  return { ...settings, head, block, checkpointBlock, price, raised, sold, graduated, soldOut, funded,
    finalized: checkpointBlock === end };
}

export type LaunchSnapshot = Awaited<ReturnType<typeof readLaunchSnapshotWithClient>>;

/** Cached display snapshot; transaction preparation uses fresh wallet reads. */
export function readLaunchSnapshot(config: LaunchConfig, wallet: WalletRpc): Promise<LaunchSnapshot> {
  return readLaunchSnapshotWithClient(config, launchClient(config, wallet), auctionKey(config, wallet));
}

/** One cheap wallet read for scheduled phase boundaries on the visible launch page. */
export function readLaunchBlock(config: LaunchConfig, wallet: WalletRpc) {
  return launchClient(config, wallet).getBlockNumber({ cacheTime: 0 });
}

/** The header reads settings/accounting only, never the full bidder/event history. */
export async function readLaunchClock(config: LaunchConfig, wallet: WalletRpc): Promise<LaunchClockState> {
  const { block, start, end, claim, funded, graduated, finalized, checkpointBlock, soldOut } = await readLaunchSnapshot(config, wallet);
  return { block, start, end, claim, funded, graduated, finalized, checkpointBlock, soldOut };
}

async function readEndTime(client: ReturnType<typeof launchClient>, chainId: number,
  head: { number: bigint; timestamp: bigint }, end: bigint): Promise<LaunchState["endTime"]> {
  try {
    if (head.number >= end) {
      const closed = head.number === end ? head : await client.getBlock({ blockNumber: end });
      return { timestamp: Number(closed.timestamp) * 1000, estimated: false, blockTimeSeconds: null };
    }
    // Robinhood's published mainnet cadence: https://robinhood.com/us/en/crypto/chain/
    let blockTimeSeconds = chainId === 4663 ? 0.1 : null;
    if (blockTimeSeconds === null) {
      if (head.number === 0n) return null;
      const previousNumber = head.number > 100n ? head.number - 100n : 0n;
      const previous = await client.getBlock({ blockNumber: previousNumber });
      blockTimeSeconds = Number(head.timestamp - previous.timestamp) / Number(head.number - previousNumber);
    }
    if (!Number.isFinite(blockTimeSeconds) || blockTimeSeconds <= 0) return null;
    // Anchor to chain time so paused or fast-forwarded Anvil never uses the browser's clock.
    const timestamp = Number(head.timestamp) * 1000 + Number(end - head.number) * blockTimeSeconds * 1000;
    if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null;
    return { timestamp, estimated: true, blockTimeSeconds };
  } catch {
    // Date metadata must not prevent auction reads or bid settlement.
    return null;
  }
}

// A decimal price is currency per whole RF; CCA prices are currency base units
// per token base unit in Q96. Always round down to preserve the chosen limit.
export function launchPriceLimit(input: string, state: Pick<LaunchState, "currencyDecimals" | "tokenDecimals" | "tick">) {
  input = input.trim().replace(/^\./, "0.");
  if (!/^\d+(\.\d*)?$/.test(input) || (input.split(".")[1]?.length ?? 0) > state.currencyDecimals) throw new Error("Enter a valid maximum price.");
  const raw = parseUnits(input, state.currencyDecimals) * Q96 / 10n ** BigInt(state.tokenDecimals);
  return raw / state.tick * state.tick;
}

export function launchBidPrice(input: string, state: LaunchState) {
  const price = launchPriceLimit(input, state);
  if (price <= state.price) throw new Error("Your maximum price must be above the current clearing price.");
  if (price > state.maxBidPrice) throw new Error("This maximum price exceeds the auction's limit.");
  return price;
}

/** Implied value of the full outstanding supply in currency base units. */
export function launchImpliedValue(price: bigint, state: Pick<LaunchState, "tokenSupply">) {
  return price * state.tokenSupply / Q96;
}

export function launchPriceInput(price: bigint, state: Pick<LaunchState, "tokenDecimals" | "currencyDecimals">) {
  return formatUnits(price * 10n ** BigInt(state.tokenDecimals) / Q96, state.currencyDecimals);
}

export function launchAmount(input: string, decimals: number) {
  input = input.trim().replace(/^\./, "0.");
  if (!/^\d+(\.\d*)?$/.test(input) || (input.split(".")[1]?.length ?? 0) > decimals) throw new Error("Enter a valid bid amount.");
  const amount = parseUnits(input, decimals);
  if (amount <= 0n || amount >= 1n << 128n) throw new Error("Enter a valid bid amount.");
  return amount;
}

type IndexedBid = LaunchBid & { owner: Address };
type AuctionIndex = {
  block: bigint; hash: Hex; funded: boolean;
  bids: Map<bigint, IndexedBid>; owners: Map<string, bigint[]>; checkpoints: LaunchCheckpoint[]; ticks: Set<bigint>;
};
const indexes = new Map<string, AuctionIndex>();
const indexing = new Map<string, Promise<AuctionIndex>>();
const INCOMPLETE_HISTORY = "The auction's bid history is incomplete. Check its deployment block.";

function auctionKey(config: LaunchConfig, wallet: WalletRpc) {
  return `${walletRpcScope(wallet)}:${config.chainId}:${config.auctionAddress.toLowerCase()}:${config.auctionDeploymentBlock}:${config.tokenAddress.toLowerCase()}`;
}

async function auctionIndex(config: LaunchConfig, client: LaunchClient, wallet: WalletRpc, block: bigint, hash: Hex): Promise<AuctionIndex> {
  const key = auctionKey(config, wallet);
  const requestKey = `${key}:${hash}`;
  const pending = indexing.get(requestKey);
  if (pending) return pending;
  const work = readAuctionIndex(config, client, block, hash, key).finally(() => { indexing.delete(requestKey); });
  indexing.set(requestKey, work);
  return work;
}

async function readAuctionIndex(config: LaunchConfig, client: LaunchClient, block: bigint, hash: Hex, key: string): Promise<AuctionIndex> {
  let previous = indexes.get(key);
  if (previous?.block === block && previous.hash === hash) return previous;
  if (previous) {
    // A reverted Anvil snapshot or chain reorganization invalidates the history,
    // even when the auction address and chain ID did not change.
    const canonical = previous.block <= block ? await client.getBlock({ blockNumber: previous.block }) : null;
    if (canonical?.hash !== previous.hash) {
      indexes.delete(key);
      previous = undefined;
    }
  }
  const index: AuctionIndex = {
    block, hash, funded: previous?.funded ?? false,
    bids: new Map(previous?.bids), owners: new Map(previous?.owners), checkpoints: [...previous?.checkpoints ?? []], ticks: new Set(previous?.ticks),
  };
  let from = previous ? previous.block + 1n : BigInt(config.auctionDeploymentBlock);
  let window = 50_000n;
  try {
    while (from <= block) {
      const to = from + window - 1n > block ? block : from + window - 1n;
      let logs;
      try {
        logs = await client.getLogs({ address: config.auctionAddress, fromBlock: from, toBlock: to });
      } catch (error) {
        // Busy auctions can exceed a provider's response cap long before its
        // block-range cap. Split the same range without skipping any events.
        if (window <= 1n || walletReadUnavailable(error)) throw error;
        window = window / 2n || 1n;
        continue;
      }
      for (const log of logs) {
        let event;
        try { event = decodeEventLog({ abi: launchAbi, data: log.data, topics: log.topics }); }
        catch { continue; }
        if (event.eventName === "TokensReceived") index.funded = true;
        if (event.eventName === "CheckpointUpdated") index.checkpoints.push({ block: event.args.blockNumber, price: event.args.clearingPriceQ96 });
        if (event.eventName === "TickInitialized") index.ticks.add(event.args.priceQ96);
        if (event.eventName === "BidSubmitted") {
          const owner = event.args.owner.toLowerCase();
          if (!index.bids.has(event.args.id)) index.owners.set(owner, [...index.owners.get(owner) ?? [], event.args.id]);
          index.bids.set(event.args.id, {
            id: event.args.id, owner: event.args.owner, startBlock: log.blockNumber!, amount: event.args.amount,
            maxPrice: event.args.priceQ96, exitedBlock: 0n, tokensFilled: 0n, purchased: 0n, refunded: 0n, claimed: false,
          });
        }
        if (event.eventName === "BidExited" || event.eventName === "TokensClaimed") {
          const bid = index.bids.get(event.args.bidId);
          if (!bid) throw new Error(INCOMPLETE_HISTORY);
          index.bids.set(bid.id, event.eventName === "BidExited"
            ? { ...bid, exitedBlock: log.blockNumber!, tokensFilled: event.args.tokensFilled, purchased: event.args.tokensFilled, refunded: event.args.currencyRefunded }
            : { ...bid, tokensFilled: 0n, claimed: true });
        }
      }
      from = to + 1n;
    }
  } catch (error) {
    // A settlement for a bid the retained history never saw means an earlier page was
    // incomplete (a lagging provider node can omit head logs). Rebuild once from the
    // deployment block instead of failing on every refresh until the process restarts.
    if (previous && error instanceof Error && error.message === INCOMPLETE_HISTORY) {
      indexes.delete(key);
      return readAuctionIndex(config, client, block, hash, key);
    }
    throw error;
  }
  if ((await client.getBlock({ blockNumber: block })).hash !== hash) throw new Error("The chain changed while reading the auction. Refresh to continue.");
  if (!indexes.has(key) || indexes.get(key)!.block <= block) indexes.set(key, index);
  while (indexes.size > 8) indexes.delete(indexes.keys().next().value!);
  return index;
}

type CurrencyMetadata = { tokenDecimals: number; currencyDecimals: number; currencySymbol: string };
const currencyMetadata = new Map<string, Promise<CurrencyMetadata>>();

async function readCurrencyMetadata(config: LaunchConfig, client: LaunchClient, snapshot: LaunchSnapshot, cacheKey?: string) {
  const pending = cacheKey ? currencyMetadata.get(cacheKey) : undefined;
  if (pending) return pending;
  const { token, currency, block: blockNumber } = snapshot;
  const native = currency === zeroAddress;
  const work = Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals", blockNumber }),
    native ? 18 : client.readContract({ address: currency, abi: erc20Abi, functionName: "decimals", blockNumber }),
    native ? "ETH" : client.readContract({ address: currency, abi: erc20Abi, functionName: "symbol", blockNumber }),
  ]).then(([tokenDecimals, currencyDecimals, currencySymbol]) => ({ tokenDecimals, currencyDecimals, currencySymbol }));
  if (cacheKey) {
    currencyMetadata.set(cacheKey, work);
    while (currencyMetadata.size > 8) currencyMetadata.delete(currencyMetadata.keys().next().value!);
    void work.catch(() => { if (currencyMetadata.get(cacheKey) === work) currencyMetadata.delete(cacheKey); });
  }
  return work;
}

/** The bidder details use the header's exact pinned snapshot, not another head read. */
export async function readLaunchDetails(config: LaunchConfig, wallet: WalletRpc, snapshot: LaunchSnapshot, owner?: Address,
  options: { fresh?: boolean } = {}): Promise<LaunchState> {
  const client = launchClient(config, wallet);
  const { head, token, ...state } = snapshot;
  const blockNumber = state.block;
  const native = state.currency === zeroAddress;
  const [index, metadata, tokenSupply, balance, allowance, endTime, contractBalance] = await Promise.all([
    auctionIndex(config, client, wallet, blockNumber, head.hash),
    readCurrencyMetadata(config, client, snapshot, options.fresh ? undefined : auctionKey(config, wallet)),
    client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply", blockNumber }),
    !owner ? null : native ? client.getBalance({ address: owner, blockNumber })
      : client.readContract({ address: state.currency, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber }),
    !owner || native ? 0n : client.readContract({ address: state.currency, abi: erc20Abi,
      functionName: "allowance", args: [owner, config.auctionAddress], blockNumber }),
    readEndTime(client, config.chainId, head, state.end),
    native ? client.getBalance({ address: config.auctionAddress, blockNumber })
      : client.readContract({ address: state.currency, abi: erc20Abi, functionName: "balanceOf", args: [config.auctionAddress], blockNumber }),
  ]);
  if ((await client.getBlock({ blockNumber })).hash !== head.hash) throw new Error("The chain changed while reading the auction. Refresh to continue.");
  if (index.funded !== state.funded) throw new Error("The auction funding history is incomplete. Check its deployment block.");
  let totalBidAmount = 0n;
  for (const bid of index.bids.values()) totalBidAmount += bid.amount;
  const bids = (owner ? index.owners.get(owner.toLowerCase()) ?? [] : []).map(id => index.bids.get(id)!);
  return { ...state, ...metadata, endTime, tokenSupply, totalBidAmount, contractBalance, balance, allowance,
    bids: bids.reverse(), checkpoints: index.checkpoints,
    ticks: [...new Set([state.floor, ...index.ticks])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0) };
}

/** Explicit fresh path for transaction review/validation: bypass all display caches. */
export async function readLaunch(config: LaunchConfig, wallet: WalletRpc, owner?: Address): Promise<LaunchState> {
  const snapshot = await readLaunchSnapshotWithClient(config, launchClient(config, wallet));
  return readLaunchDetails(config, wallet, snapshot, owner, { fresh: true });
}

export type LaunchWallet = WalletRpc & { address: Address; session: number };
export type LaunchProgress = (message: string, hash?: Hex) => void;
type PendingLaunch = { hash: Hex; replaced: boolean };
const pendingLaunches = new Map<string, PendingLaunch>();

function pendingLaunchKey(config: LaunchConfig, wallet: LaunchWallet) {
  return `rarefriends.pending.cca.${config.chainId}.${config.auctionAddress.toLowerCase()}.${wallet.address.toLowerCase()}`;
}

function rememberLaunch(key: string, pending: PendingLaunch | null) {
  if (pending) pendingLaunches.set(key, pending); else pendingLaunches.delete(key);
  try { if (pending) localStorage.setItem(key, JSON.stringify(pending)); else localStorage.removeItem(key); } catch { /* In-memory protection remains available when storage is blocked. */ }
}

function pendingLaunch(key: string): PendingLaunch | null {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as PendingLaunch | null;
    if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored.hash)) return { hash: stored.hash, replaced: stored.replaced === true };
  } catch { /* Fall back to this tab's pending submission. */ }
  return pendingLaunches.get(key) ?? null;
}

const LAUNCH_READ_TIMEOUT_MS = 30_000;
const LAUNCH_READ_TIMEOUT_MESSAGE = "The auction or wallet RPC did not respond in time. Check the RPC configured in your wallet and try again.";
class LaunchReadTimeout extends Error {
  constructor() { super(LAUNCH_READ_TIMEOUT_MESSAGE); this.name = "LaunchReadTimeout"; }
}

/** Only wrap reads: a timed-out read must never resume into a transaction submission. */
async function boundedLaunchRead<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LaunchReadTimeout()), LAUNCH_READ_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function assertLaunchWallet(config: LaunchConfig, wallet: LaunchWallet) {
  if (wallet.session !== wallet.getSession()) throw new Error("Your wallet session changed. Review this action again.");
  const [accounts, chain] = await boundedLaunchRead(() => Promise.all([wallet.request("eth_accounts"), wallet.request("eth_chainId")]));
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Your wallet account changed. Review this action again.");
  if (typeof chain !== "string" || BigInt(chain) !== BigInt(config.chainId)) throw new Error(`Switch your wallet to ${config.chainName} and try again.`);
  if (wallet.session !== wallet.getSession()) throw new Error("Your wallet session changed. Review this action again.");
}

export async function switchLaunchChain(config: LaunchConfig, wallet: Pick<LaunchWallet, "address" | "request">) {
  try {
    await wallet.request("wallet_switchEthereumChain", [{ chainId: toHex(config.chainId) }]);
  } catch (error) {
    if (typeof error !== "object" || !error || !("code" in error) || error.code !== 4902) throw error;
    const rpcUrl = new URL(config.rpcUrl, window.location.origin).href;
    await wallet.request("wallet_addEthereumChain", [{ chainId: toHex(config.chainId), chainName: config.chainName,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [rpcUrl],
      ...(config.explorerUrl ? { blockExplorerUrls: [config.explorerUrl] } : {}) }]);
    await wallet.request("wallet_switchEthereumChain", [{ chainId: toHex(config.chainId) }]);
  }
}

async function send(config: LaunchConfig, wallet: LaunchWallet, to: Address, data: Hex, value: bigint, title: string, progress: LaunchProgress) {
  const client = launchClient(config, wallet);
  const gas = await boundedLaunchRead(async () => {
    await assertLaunchWallet(config, wallet);
    progress(`Checking ${title}…`);
    const estimate = await client.estimateGas({ account: wallet.address, to, data, value });
    await assertLaunchWallet(config, wallet);
    return estimate;
  });
  return sendWithGas(config, wallet, to, data, value, gas * 120n / 100n, title, progress);
}

/** Both preparation paths submit the same locally encoded transaction. */
async function sendWithGas(config: LaunchConfig, wallet: LaunchWallet, to: Address, data: Hex, value: bigint, gas: bigint,
  title: string, progress: LaunchProgress) {
  progress(`Confirm ${title} in your wallet.`);
  const hash = await wallet.request("eth_sendTransaction", [{ from: wallet.address, to, data, chainId: toHex(config.chainId), value: toHex(value), gas: toHex(gas) }]);
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Your wallet did not return a transaction hash.");
  const pending = { hash: hash as Hex, replaced: false };
  rememberLaunch(pendingLaunchKey(config, wallet), pending);
  progress(`Waiting for ${title}…`, pending.hash);
  const receipt = await waitForLaunchConfirmation(config, wallet, pending, title, progress);
  if (receipt.status !== "success") throw new Error(`${title} reverted. Your bid was not changed by this transaction.`);
  return receipt.transactionHash;
}

async function waitForLaunchConfirmation(config: LaunchConfig, wallet: LaunchWallet, pending: PendingLaunch, title: string, progress: LaunchProgress) {
  const client = launchClient(config, wallet);
  const key = pendingLaunchKey(config, wallet);
  // A timeout or a temporarily unavailable RPC does not cancel a submitted
  // transaction. A changed connection retains its hash for a safe reconnect.
  const receipt = await (async () => {
    for (;;) {
      try {
        if (wallet.session !== wallet.getSession()) throw new Error("Wallet session changed.");
        return await client.waitForTransactionReceipt({ hash: pending.hash, timeout: 30_000,
          onReplaced: replacement => {
            pending.replaced ||= replacement.reason !== "repriced";
            pending.hash = replacement.transaction.hash;
            rememberLaunch(key, pending);
            progress(`Waiting for ${title}…`, pending.hash);
          } });
      } catch {
        if (wallet.session !== wallet.getSession()) throw new Error(`Your ${title} transaction was submitted (${pending.hash}). Your wallet connection changed; reconnect to ${config.chainName} to check its confirmation before continuing.`);
        progress(`Your ${title} transaction was submitted. Still waiting for confirmation…`, pending.hash);
        await new Promise(resolve => setTimeout(resolve, 3_000));
      }
    }
  })();
  rememberLaunch(key, null);
  if (pending.replaced) throw new Error(`Your ${title} transaction was cancelled or replaced in your wallet. Review again to continue.`);
  return receipt;
}

async function checkPendingLaunch(config: LaunchConfig, wallet: LaunchWallet, progress: LaunchProgress) {
  const pending = pendingLaunch(pendingLaunchKey(config, wallet));
  if (!pending) return;
  progress("Checking your previously submitted auction transaction…", pending.hash);
  await waitForLaunchConfirmation(config, wallet, pending, "previous auction", progress);
  throw new Error("Your previous auction transaction has settled. Review the updated auction and remaining steps before continuing.");
}

/** Direct fallback bidding checks do not need bidder history, chart data, or an event index. */
async function readLaunchBidPreparation(config: LaunchConfig, wallet: LaunchWallet, maxPrice: bigint, previousTickHint?: bigint) {
  const client = launchClient(config, wallet);
  const snapshot = await readLaunchSnapshotWithClient(config, client);
  const { block, currency, floor, tick, maxBidPrice } = snapshot;
  const native = currency === zeroAddress;
  const hint = typeof previousTickHint === "bigint" && previousTickHint > floor && previousTickHint < maxPrice
    && previousTickHint <= maxBidPrice && previousTickHint % tick === 0n ? previousTickHint : null;
  const [balance, allowance, currencySymbol, previousTick] = await Promise.all([
    native ? client.getBalance({ address: wallet.address, blockNumber: block })
      : client.readContract({ address: currency, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address], blockNumber: block }),
    native ? 0n : client.readContract({ address: currency, abi: erc20Abi, functionName: "allowance",
      args: [wallet.address, config.auctionAddress], blockNumber: block }),
    native ? "ETH" : client.readContract({ address: currency, abi: erc20Abi, functionName: "symbol", blockNumber: block }),
    hint === null ? floor : client.readContract({ address: config.auctionAddress, abi: launchAbi,
      functionName: "ticks", args: [hint], blockNumber: block }).then(value => value.next !== 0n ? hint : floor),
  ]);
  if ((await client.getBlock({ blockNumber: block })).hash !== snapshot.head.hash) {
    throw new Error("The chain changed while checking your bid. Refresh to continue.");
  }
  return { ...snapshot, balance, allowance, currencySymbol, previousTick };
}

export async function submitLaunchBid(config: LaunchConfig, wallet: LaunchWallet, amount: bigint, maxPrice: bigint,
  progress: LaunchProgress, previousTickHint?: bigint) {
  progress("Checking auction and wallet…");
  if (wallet.session !== wallet.getSession()) throw new Error("Your wallet session changed. Review this action again.");
  if (amount <= 0n || amount >= 1n << 128n) throw new Error("Enter a valid bid amount.");
  if (maxPrice <= 0n || maxPrice >= 1n << 256n) throw new Error("Choose a valid maximum price.");
  // A recorded submission must settle before either preparation path can bid again.
  if (pendingLaunch(pendingLaunchKey(config, wallet))) {
    await assertLaunchWallet(config, wallet);
    await checkPendingLaunch(config, wallet, progress);
  }
  await assertLaunchWallet(config, wallet);
  await checkPendingLaunch(config, wallet, progress);
  const state = await boundedLaunchRead(() => readLaunchBidPreparation(config, wallet, maxPrice, previousTickHint));
  if (!state.funded) throw new Error("The auction's tokens have not been deposited yet.");
  if (state.block < state.start || state.block >= state.end) throw new Error("The auction is not accepting bids now.");
  if (state.soldOut) throw new Error("All auction supply has been released. No further bids can be accepted.");
  if (amount <= 0n || amount >= 1n << 128n) throw new Error("Enter a valid bid amount.");
  if (maxPrice > state.maxBidPrice || maxPrice < state.floor || maxPrice % state.tick !== 0n) throw new Error("Choose a valid price on the auction's tick grid.");
  if (maxPrice <= state.price) throw new Error("The clearing price moved above your limit. Review a new maximum price.");
  if (state.balance === null || amount > state.balance) throw new Error(`You do not have enough ${state.currencySymbol}.`);
  if (state.validationHook !== zeroAddress) throw new Error("This auction requires bid eligibility data that has not been configured.");
  const hashes: Hex[] = [];
  if (state.currency !== zeroAddress && state.allowance < amount) {
    hashes.push(await send(config, wallet, state.currency, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [config.auctionAddress, amount] }), 0n, `${state.currencySymbol} approval`, progress));
  }
  hashes.push(await send(config, wallet, config.auctionAddress,
    encodeFunctionData({ abi: launchAbi, functionName: "submitBid", args: [maxPrice, amount, wallet.address, state.previousTick, "0x"] }),
    state.currency === zeroAddress ? amount : 0n, "bid", progress));
  return hashes;
}

export async function settleLaunchBid(config: LaunchConfig, wallet: LaunchWallet, bidId: bigint, progress: LaunchProgress) {
  await assertLaunchWallet(config, wallet);
  await checkPendingLaunch(config, wallet, progress);
  const hashes: Hex[] = [];
  for (let step = 0; step < 4; step++) {
    await assertLaunchWallet(config, wallet);
    const response = await fetch("/api/protocol/settlement", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: wallet.address, bidId: bidId.toString() }) });
    const prepared = await response.json().catch(() => undefined) as { error?: string; action?: string; to?: Address; data?: Hex; value?: string; gas?: string } | undefined;
    if (!response.ok) throw new Error(typeof prepared?.error === "string" ? prepared.error : "The settlement check could not be completed.");
    if (!prepared || prepared.action === "done") break;
    if (!prepared.to || !prepared.data || !prepared.gas) throw new Error("The settlement preparation was incomplete. Refresh and try again.");
    const label = prepared.action === "checkpoint" ? "auction settlement checkpoint" : prepared.action === "claim" ? "$RAREFRIENDS claim" : "bid exit and refund";
    hashes.push(await sendWithGas(config, wallet, prepared.to, prepared.data, BigInt(prepared.value ?? "0x0"), BigInt(prepared.gas) * 120n / 100n, label, progress));
  }
  return hashes;
}

export function launchError(error: unknown) {
  const messages: Record<string, string> = {
    BidMustBeAboveClearingPrice: "The clearing price moved. Review a higher maximum price before bidding again.",
    CannotPartiallyExitBidBeforeGraduation: "This outbid bid can be settled once the auction reaches its minimum raise, or refunded after the auction ends.",
  };
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  for (let index = 0; index < queue.length && index < 40; index++) {
    const item = queue[index];
    if (seen.has(item)) continue;
    seen.add(item);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (record.name === "LaunchReadTimeout") return LAUNCH_READ_TIMEOUT_MESSAGE;
      if (typeof record.errorName === "string" && Object.hasOwn(messages, record.errorName)) return messages[record.errorName];
      for (const field of ["cause", "data", "error", "details", "message", "shortMessage"]) if (record[field] !== undefined) queue.push(record[field]);
    } else if (typeof item === "string") {
      if (item.includes(LAUNCH_READ_TIMEOUT_MESSAGE)) return LAUNCH_READ_TIMEOUT_MESSAGE;
      if (item.includes("Your wallet RPC did not respond.")) return "Your wallet RPC did not respond. Check the RPC configured in your wallet and try again.";
      for (const [name, message] of Object.entries(messages)) if (new RegExp(`\\b${name}\\b`).test(item)) return message;
      // Some RPCs retain ABI revert data; others include the selector only in
      // their error message. Decode only explicit revert data, not transaction input.
      const data = /^0x[\da-f]+$/i.test(item) ? [item]
        : [...item.matchAll(/\b(?:custom error|revert(?:ed)?(?: data)?|return data)[\s:(]*(0x[\da-f]+)/gi)].map(match => match[1]);
      for (const value of data) {
        try {
          const decoded = decodeErrorResult({ abi: launchAbi, data: value as Hex });
          if (Object.hasOwn(messages, decoded.errorName)) return messages[decoded.errorName];
        } catch { /* Preserve the original message for unrelated contract errors. */ }
      }
    }
  }
  if (typeof error === "object" && error && "shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage;
  return error instanceof Error ? error.message : "The request could not be completed. Try again.";
}
