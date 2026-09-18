/**
 * Bidder lifecycle for the deployed ContinuousClearingAuction.
 *
 * `price`, `graduated` and `soldOut` must describe a checkpoint simulated at
 * `block`, not just the last stored checkpoint. `finalized` describes storage.
 * All blocks use the auction's BlockNumberish clock, never a wall-clock ETA.
 */
export type CcaClock = {
  block: bigint;
  start: bigint;
  end: bigint;
  claim: bigint;
  funded: boolean;
  graduated: boolean;
  finalized: boolean;
  soldOut?: boolean;
};

export type CcaState = CcaClock & { price: bigint };
export type CcaBid = {
  id: bigint;
  startBlock: bigint;
  exitedBlock: bigint;
  maxPrice: bigint;
  tokensFilled: bigint;
  claimed: boolean;
};
export type CcaCheckpoint = { block: bigint; price: bigint };
export type CcaPhase = "unfunded" | "upcoming" | "live" | "sold-out" | "settlement" | "refunds" | "claim-wait" | "claim";

export function ccaPhase(state: CcaClock): CcaPhase {
  if (!state.funded) return "unfunded";
  if (state.block < state.start) return "upcoming";
  if (state.block < state.end) return state.soldOut ? "sold-out" : "live";
  if (!state.finalized) return "settlement";
  if (!state.graduated) return "refunds";
  return state.block < state.claim ? "claim-wait" : "claim";
}

/** A sold-out auction still waits for the configured end and claim blocks. */
export function ccaCountdown(state: CcaClock): {
  event: "start" | "end" | "claim" | "complete";
  target: bigint | null;
  blocks: bigint;
} {
  if (state.block < state.start) return { event: "start", target: state.start, blocks: state.start - state.block };
  if (state.block < state.end) return { event: "end", target: state.end, blocks: state.end - state.block };
  if (!(state.finalized && !state.graduated) && state.block < state.claim) {
    return { event: "claim", target: state.claim, blocks: state.claim - state.block };
  }
  return { event: "complete", target: null, blocks: 0n };
}

/**
 * Ended bids remain actionable even before a final checkpoint is persisted:
 * the bidder's exit transaction can finalize the auction itself.
 */
export function ccaBidAction(bid: CcaBid, state: CcaState): "settle" | "claim" | null {
  if (!state.funded || state.block < state.start || bid.claimed) return null;
  if (bid.exitedBlock > 0n) {
    return state.graduated && state.block >= state.claim && bid.tokensFilled > 0n ? "claim" : null;
  }
  if (state.block >= state.end) return "settle";
  return state.graduated && bid.maxPrice < state.price ? "settle" : null;
}

export function ccaBidStatus(bid: CcaBid, state: CcaState): string {
  if (bid.claimed) return "claimed";
  if (bid.exitedBlock > 0n) {
    if (bid.tokensFilled === 0n) return "settled";
    return ccaBidAction(bid, state) === "claim" ? "ready to claim" : "waiting for claims";
  }
  if (!state.funded) return "awaiting auction funding";
  if (state.block < state.start) return "auction has not started";
  if (state.block >= state.end) {
    if (!state.finalized) return "ready to settle";
    if (!state.graduated) return "full refund available";
    const outcome = bid.maxPrice < state.price ? "outbid" : bid.maxPrice === state.price ? "partially filled" : "winning";
    return `${outcome} · ready to settle`;
  }
  if (bid.maxPrice < state.price) return state.graduated ? "outbid" : "outbid · minimum raise pending";
  return bid.maxPrice === state.price ? "partially filling" : "participating";
}

export type CcaExitPlan =
  | { kind: "exit"; functionName: "exitBid"; args: readonly [bigint] }
  | { kind: "exit"; functionName: "exitPartiallyFilledBid"; args: readonly [bigint, bigint, bigint] }
  | { kind: "checkpoint" | "blocked"; reason: string };

/**
 * Derive partial-exit hints only from persisted, complete checkpoint history.
 * Prices never decrease. The last fully filled checkpoint is strictly below
 * the limit; the outbid checkpoint is the FIRST strictly above it. At the final
 * clearing price, equality instead uses outbidBlock=0 after the end block.
 */
export function ccaExitPlan(
  bid: Pick<CcaBid, "id" | "startBlock" | "exitedBlock" | "maxPrice">,
  state: CcaState,
  checkpoints: readonly CcaCheckpoint[],
): CcaExitPlan {
  if (bid.exitedBlock > 0n) return { kind: "blocked", reason: "This bid has already been settled." };
  if (!state.funded || state.block < state.start) return { kind: "blocked", reason: "The auction is not active yet." };
  const ended = state.block >= state.end;
  if (ended && (!state.graduated || bid.maxPrice > state.price)) {
    return { kind: "exit", functionName: "exitBid", args: [bid.id] };
  }
  if (!ended && !state.graduated) {
    return { kind: "blocked", reason: "This bid can be settled once the minimum raise is reached, or refunded after the auction ends." };
  }
  if (!ended && bid.maxPrice >= state.price) {
    return { kind: "blocked", reason: "This bid is still participating. Settle it when outbid or after the auction ends." };
  }

  const target = ended ? state.end : state.block;
  const history = checkpoints.filter(point => point.block >= bid.startBlock && point.block <= target)
    .sort((left, right) => left.block < right.block ? -1 : left.block > right.block ? 1 : 0);
  const lastFullIndex = history.findLastIndex(point => point.price < bid.maxPrice);
  const lastFull = history[lastFullIndex];
  const next = history[lastFullIndex + 1];
  const outbid = history.find(point => point.price > bid.maxPrice);
  if (!lastFull || !next || next.price < bid.maxPrice || (!outbid && (!ended || bid.maxPrice !== state.price))) {
    return { kind: "checkpoint", reason: "The auction needs an updated checkpoint before this bid can be settled." };
  }
  return {
    kind: "exit",
    functionName: "exitPartiallyFilledBid",
    args: [bid.id, lastFull.block, outbid?.block ?? 0n],
  };
}
