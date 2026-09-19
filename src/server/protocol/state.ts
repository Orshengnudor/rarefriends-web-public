import { encodeAbiParameters, getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { FriendWallet, PortfolioEvent, PortfolioFriend, ProtocolAccount } from "@/src/features/protocol/model";
import type { ProtocolState, ProtocolData } from "@/src/features/protocol/types";
import { contractRead, ProtocolError, type ChainContext } from "@/src/lib/protocol/chain-context";
import { readOnchainArtwork } from "@/src/lib/protocol/chain-artwork";
import { addressValue, artworkRevision, chainIndex, integer, mapBounded, ownedRewardFriends, rewardHistory, supportsFriendRewards, units, type ChainIndex, type IndexedNft } from "../../lib/protocol/indexer";
import { readEthUsdPrice } from "./prices";
import { readReserveStatus } from "../../lib/protocol/reserve";
import { rewardApyPercent } from "../../lib/protocol/metrics";

export async function poolState(context: ChainContext, blockNumber?: bigint) {
  const ready = await contractRead<boolean>(context, "Market", "seedComplete", [], blockNumber);
  if (!ready) return { ready: false, sqrtPriceX96: 0n, rfEth: 0, wethFirst: false };
  const [poolId, wethFirst] = await Promise.all([
    contractRead<Hex>(context, "Hook", "poolId", [], blockNumber),
    contractRead<boolean>(context, "Market", "wethIsCurrency0", [], blockNumber),
  ]);
  // Uniswap v4 StateLibrary: pools mapping slot 6; Slot0's low 160 bits hold sqrtPriceX96.
  const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, 6n]));
  const packed = await contractRead<Hex>(context, "PoolManager", "extsload", [slot], blockNumber);
  const sqrtPriceX96 = BigInt(packed) & ((1n << 160n) - 1n);
  const ratio = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  const rfEth = wethFirst ? 1 / ratio : ratio;
  if (!Number.isFinite(rfEth) || rfEth <= 0) throw new ProtocolError("The market does not have a usable price.", 503);
  return { ready, sqrtPriceX96, rfEth, wethFirst };
}

export async function chainPrices(context: ChainContext, blockNumber?: bigint, usdReader = readEthUsdPrice): Promise<ProtocolData["prices"] & { marketReady: boolean }> {
  const [pool, usd] = await Promise.all([poolState(context, blockNumber), usdReader()]);
  return { ...usd, rfUsd: pool.rfEth * usd.ethUsd, marketReady: pool.ready,
    label: usd.usdAvailable ? `RF: pool · ETH/USD: CoinGecko${usd.usdStale ? " (cached)" : ""} · NFT values excluded` : "RF/ETH: pool · USD unavailable · NFT values excluded",
  };
}

function safeId(id: bigint) {
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) throw new ProtocolError("This NFT identifier is outside the supported display range.", 503);
  return Number(id);
}

export type ProtocolArtworkReader = typeof readOnchainArtwork;

async function readWallet(context: ChainContext, index: ChainIndex, nft: IndexedNft, prices: ProtocolData["prices"], artwork: ProtocolArtworkReader): Promise<FriendWallet> {
  const address = await contractRead<Address>(context, nft.collection, "tokenBoundAccount", [nft.id], index.block);
  const [eth, rf, weth] = await Promise.all([
    context.client.getBalance({ address, blockNumber: index.block }),
    contractRead<bigint>(context, "RF", "balanceOf", [address], index.block),
    contractRead<bigint>(context, "WETH", "balanceOf", [address], index.block),
  ]);
  const tokens = [
    { symbol: "ETH", name: "Ether", balance: units(eth), rawBalance: String(eth), usd: units(eth) * prices.ethUsd },
    { symbol: "WETH", name: "Wrapped Ether", balance: units(weth), rawBalance: String(weth), usd: units(weth) * prices.ethUsd },
    { symbol: "$RAREFRIENDS", name: "Rare Friends", balance: units(rf), rawBalance: String(rf), usd: units(rf) * prices.rfUsd },
  ].filter((token) => token.balance > 0);
  const nested = [...index.nfts.values()].filter((item) => item.owner.toLowerCase() === address.toLowerCase());
  const nfts = await mapBounded(nested, async (item) => {
    const id = safeId(item.id);
    const generation = item.collection === "Generations" ? Number(await contractRead<number>(context, "Generations", "generation", [item.id], index.block)) : 0;
    return { collection: item.collection, id, portrait: id % (item.collection === "Genesis" ? 32 : 8),
      imageUrl: await artwork(context, item.collection, item.id, index.block, artworkRevision(index, item.collection, item.id)),
      name: item.collection === "Genesis" ? `Genesis #${id}` : generation === 0 ? `Temporary Friend #${id}` : `Generation ${generation} #${id}` };
  });
  return { address, tokens, nfts, totalUsd: tokens.reduce((sum, token) => sum + token.usd, 0) };
}

async function readFriend(context: ChainContext, index: ChainIndex, nft: IndexedNft, prices: ProtocolData["prices"], artwork: ProtocolArtworkReader): Promise<PortfolioFriend> {
  const id = safeId(nft.id);
  const friendRewards = supportsFriendRewards(context);
  const collectionAddress = context.manifest.contracts[nft.collection].address;
  const [position, generation] = await Promise.all([
    contractRead<readonly unknown[]>(context, "ActivationManager", "positions", [collectionAddress, nft.id], index.block),
    nft.collection === "Generations" ? contractRead<number>(context, "Generations", "generation", [nft.id], index.block) : Promise.resolve(0),
  ]);
  const hardwired = nft.collection === "Genesis" || Number(generation) > 0;
  const weight = integer(position[friendRewards ? 1 : 2]);
  const activated = hardwired && weight > 0n && (friendRewards || addressValue(position[0]) === nft.owner.toLowerCase());
  const [wallet, earnedRf, earnedWeth, imageUrl] = await Promise.all([
    hardwired ? readWallet(context, index, nft, prices, artwork) : Promise.resolve(null),
    hardwired && friendRewards ? contractRead<bigint>(context, "ActivationManager", "earned", [context.manifest.contracts.RF.address, collectionAddress, nft.id], index.block) : Promise.resolve(0n),
    hardwired && friendRewards ? contractRead<bigint>(context, "ActivationManager", "earned", [context.manifest.contracts.WETH.address, collectionAddress, nft.id], index.block) : Promise.resolve(0n),
    artwork(context, nft.collection, nft.id, index.block, artworkRevision(index, nft.collection, nft.id)),
  ]);
  return { id, collection: nft.collection, generation: Number(generation), tier: activated ? Number(position[friendRewards ? 0 : 1]) : 0,
    activated, hardwired, earnings: units(earnedRf), earningsWeth: units(earnedWeth), portrait: id % (nft.collection === "Genesis" ? 32 : 8),
    weight: activated ? units(weight) : 0, wallet,
    imageUrl,
  };
}

function holderActivity(context: ChainContext, index: ChainIndex, address: Address): PortfolioEvent[] {
  const holder = address.toLowerCase();
  const friendRewards = supportsFriendRewards(context);
  const owned = ownedRewardFriends(context, index, address);
  return index.events.flatMap((event): PortfolioEvent[] => {
    const args = event.args;
    const friendClaim = friendRewards && event.contract === "ActivationManager" && event.name === "Claimed"
      && owned.has(`${addressValue(args.collection)}:${integer(args.tokenId)}`);
    const relevant = friendClaim || [args.holder, args.payer, args.from, args.to].some((value) => addressValue(value) === holder);
    if (!relevant) return [];
    let title = "";
    let amount: string | undefined;
    const asset = addressValue(args.asset) === context.manifest.contracts.WETH.address.toLowerCase() ? "WETH" : "$RAREFRIENDS";
    if (event.name === "Claimed") {
      title = friendClaim ? `${addressValue(args.collection) === context.manifest.contracts.Genesis.address.toLowerCase() ? "Genesis" : "Generations"} #${args.tokenId} · claimed ${asset}` : `Claimed ${asset} rewards`;
      amount = `${units(integer(args.amount))} ${asset}`;
    }
    else if (event.name === "Swapped") { title = args.buy ? "Bought $RAREFRIENDS" : "Sold $RAREFRIENDS"; amount = `${units(integer(args.amountOut))} ${args.buy ? "$RAREFRIENDS" : "WETH"}`; }
    else if (event.name === "Activated") { title = `${Number(args.tier) > 0 ? "Upgraded" : "Activated"} ${addressValue(args.collection) === context.manifest.contracts.Genesis.address.toLowerCase() ? "Genesis" : "Generations"} #${args.tokenId}`; amount = `−${units(integer(args.payment))} $RAREFRIENDS`; }
    else if (event.name === "Hardwired") title = `Hardwired Generations #${args.tokenId}`;
    else if (event.name === "Transfer") title = `${addressValue(args.to) === holder ? "Received" : "Transferred"} ${event.contract} #${args.tokenId}`;
    if (!title) return [];
    return [{ id: `${event.transactionHash}-${event.logIndex}`, title, amount, at: event.at * 1000 }];
  }).reverse().slice(0, 100);
}

export type ProtocolHead = { number: bigint; timestamp: bigint; hash: Hex };

/** Global work is shared by all owners collected at this canonical head. */
export async function readProtocolBase(context: ChainContext, block: ProtocolHead, index: ChainIndex, usdReader = readEthUsdPrice): Promise<ProtocolState> {
  const blockNumber = block.number;
  if (index.block !== blockNumber || index.at !== Number(block.timestamp)) throw new ProtocolError("Portfolio index does not match the selected block.", 503);
  const [prices, initialSupply, currentSupply, inventory, rfStream, wethStream, reserve] = await Promise.all([
    chainPrices(context, blockNumber, usdReader),
    contractRead<bigint>(context, "RF", "INITIAL_SUPPLY", [], blockNumber),
    contractRead<bigint>(context, "RF", "totalSupply", [], blockNumber),
    contractRead<bigint>(context, "Reserve", "inventoryCount", [], blockNumber),
    contractRead<readonly bigint[]>(context, "ActivationManager", "streams", [context.manifest.contracts.RF.address], blockNumber),
    contractRead<readonly bigint[]>(context, "ActivationManager", "streams", [context.manifest.contracts.WETH.address], blockNumber),
    readReserveStatus(context, blockNumber),
  ]);
  const reward = rewardHistory(context, index);
  let genesisWeight = 0n;
  let generationsWeight = 0n;
  let activatedGenesis = 0;
  for (const position of index.positions.values()) {
    if (position.collection === context.manifest.contracts.Genesis.address.toLowerCase()) { activatedGenesis++; genesisWeight += position.weight; }
    else generationsWeight += position.weight;
  }
  const ammVolume = index.events.reduce((sum, event) => event.contract === "Market" && event.name === "Swapped" ? sum + integer(event.args.buy ? event.args.amountIn : event.args.amountOut) : sum, 0n);
  const makeStream = (asset: "RF" | "WETH", stored: readonly bigint[]) => {
    const cycle = reward.cycles[asset];
    // Contract accrual cannot move backward past its last update, including after an Anvil restore.
    const accountedUntil = block.timestamp > stored[3] ? block.timestamp : stored[3];
    const remainingSeconds = stored[2] > accountedUntil ? stored[2] - accountedUntil : 0n;
    const idleUntil = block.timestamp < stored[2] ? block.timestamp : stored[2];
    const idleEmission = genesisWeight + generationsWeight === 0n && idleUntil > stored[3] ? (idleUntil - stored[3]) * stored[1] : 0n;
    return { asset, start: cycle.start * 1000, end: cycle.finish * 1000, budget: units(cycle.budget), dripped: units(cycle.dripped), pending: units(stored[0] + idleEmission), remaining: units(stored[1] * remainingSeconds) };
  };
  const claimed = index.events.reduce((totals, event) => {
    if (event.contract === "ActivationManager" && event.name === "Claimed") {
      if (addressValue(event.args.asset) === context.manifest.contracts.RF.address.toLowerCase()) totals.rf += integer(event.args.amount);
      if (addressValue(event.args.asset) === context.manifest.contracts.WETH.address.toLowerCase()) totals.weth += integer(event.args.amount);
    }
    return totals;
  }, { rf: 0n, weth: 0n });
  const streams = [makeStream("RF", rfStream), makeStream("WETH", wethStream)];
  const activeRate = (stored: readonly bigint[]) => (stored[2] ?? 0n) > BigInt(index.at) ? stored[1] ?? 0n : 0n;
  const activationPaid = index.events.reduce((sum, event) => event.contract === "ActivationManager" && event.name === "Activated" ? sum + integer(event.args.payment) : sum, 0n);
  const thisWeek = reward.weekly.find(week => week.start <= index.at * 1000 && week.start + 7 * 86_400_000 > index.at * 1000);
  const protocol: ProtocolData = { reserve, metrics: {
    initialSupply: units(initialSupply), supplyBurned: units(initialSupply - currentSupply), vaultInventory: Number(inventory),
    ammVolumeEth: units(ammVolume), ammVolumeUsd: units(ammVolume) * prices.ethUsd, activatedGenesis,
    genesisWeight: units(genesisWeight), generationsWeight: units(generationsWeight), distributedRf: units(claimed.rf), distributedWeth: units(claimed.weth),
    distributedUsd: units(claimed.rf) * prices.rfUsd + units(claimed.weth) * prices.ethUsd,
    streamRemainingRf: streams[0].remaining + streams[0].pending, streamRemainingWeth: streams[1].remaining + streams[1].pending,
    streamRemainingUsd: (streams[0].remaining + streams[0].pending) * prices.rfUsd + (streams[1].remaining + streams[1].pending) * prices.ethUsd,
    weekRewardsRf: thisWeek?.rf ?? 0, weekRewardsWeth: thisWeek?.weth ?? 0,
    weekRewardsUsd: (thisWeek?.rf ?? 0) * prices.rfUsd + (thisWeek?.weth ?? 0) * prices.ethUsd,
    rewardApy: rewardApyPercent({ rateRf: activeRate(rfStream), rateWeth: activeRate(wethStream), pendingRf: rfStream[0] ?? 0n, pendingWeth: wethStream[0] ?? 0n }, activationPaid, prices),
    friendsPlaying: index.positions.size,
  }, streams, weekly: reward.weekly, holderWeekly: reward.holderWeekly,
    prices: { ethUsd: prices.ethUsd, rfUsd: prices.rfUsd, label: prices.label, usdAvailable: prices.usdAvailable,
      usdSource: prices.usdSource, usdUpdatedAt: prices.usdUpdatedAt, usdStale: prices.usdStale }, marketReady: prices.marketReady,
    coverage: { fromBlock: String(context.fromBlock), toBlock: String(blockNumber), rewards: "since-deployment", portfolio: "current-snapshot", nfts: "known-collections" },
  };
  return { account: null, protocol, blockNumber: String(blockNumber), timestamp: index.at * 1000 };
}

/** Display-only adapter. Transaction preparation never consumes these snapshots. */
export async function readIndexedProtocolState(address: Address | undefined, context: ChainContext, index: ChainIndex, base: ProtocolState,
  artwork: ProtocolArtworkReader = readOnchainArtwork): Promise<ProtocolState> {
  const blockNumber = index.block;
  if (base.blockNumber !== String(blockNumber) || base.timestamp !== index.at * 1000) throw new ProtocolError("Portfolio base does not match its index.", 503);
  const friendRewards = supportsFriendRewards(context);
  const prices = base.protocol.prices;
  const reward = rewardHistory(context, index, address);
  let account: ProtocolAccount | null = null;
  if (address) {
    const owned = [...index.nfts.values()].filter((nft) => nft.owner.toLowerCase() === address.toLowerCase());
    if (owned.length > 1500) throw new ProtocolError("This wallet requires paginated NFT indexing.", 503);
    const [native, rf, weth, earnedRf, earnedWeth, friends] = await Promise.all([
      context.client.getBalance({ address, blockNumber }),
      contractRead<bigint>(context, "RF", "balanceOf", [address], blockNumber),
      contractRead<bigint>(context, "WETH", "balanceOf", [address], blockNumber),
      friendRewards ? Promise.resolve(0n) : contractRead<bigint>(context, "ActivationManager", "earned", [context.manifest.contracts.RF.address, address], blockNumber),
      friendRewards ? Promise.resolve(0n) : contractRead<bigint>(context, "ActivationManager", "earned", [context.manifest.contracts.WETH.address, address], blockNumber),
      mapBounded(owned, (nft) => readFriend(context, index, nft, prices, artwork), 3),
    ]);
    const rewardCredit = friendRewards ? friends.reduce((sum, friend) => sum + friend.earnings, 0) : units(earnedRf);
    const rewardCreditWeth = friendRewards ? friends.reduce((sum, friend) => sum + (friend.earningsWeth ?? 0), 0) : units(earnedWeth);
    const valueUsd = (units(native + weth) + rewardCreditWeth) * prices.ethUsd + (units(rf) + rewardCredit) * prices.rfUsd + friends.reduce((sum, friend) => sum + (friend.wallet?.totalUsd ?? 0), 0);
    account = { live: true, address: getAddress(address), eth: units(native), weth: units(weth), tokenBalance: units(rf), friends,
      activity: holderActivity(context, index, address), claimed: units(reward.claimedRf), claimedWeth: units(reward.claimedWeth),
      rewardAccounting: friendRewards ? "friend" : "holder", rewardCredit, rewardCreditWeth,
      history: [{ at: index.at * 1000, value: valueUsd, earnings: rewardCredit + units(reward.claimedRf), earningsWeth: rewardCreditWeth + units(reward.claimedWeth) }],
      valueUsd,
    };
  }
  return { ...base, account, protocol: { ...base.protocol, holderWeekly: reward.holderWeekly } };
}

/** Wallet fallback retains its own provider-scoped index and authentic embedded artwork. */
export async function readProtocolState(address: Address | undefined, context: ChainContext, usdReader = readEthUsdPrice): Promise<ProtocolState> {
  const block = await context.client.getBlock();
  if (block.number === null || block.hash === null) throw new ProtocolError("The latest block is unavailable.", 503);
  const index = await chainIndex(context, { number: block.number, timestamp: block.timestamp, hash: block.hash });
  const base = await readProtocolBase(context, block, index, usdReader);
  return readIndexedProtocolState(address, context, index, base);
}

/** Read block tag conversion is shared with transaction quotation. */
export const blockTag = (blockNumber: bigint) => toHex(blockNumber);
