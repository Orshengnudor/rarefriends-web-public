import { ccaPhase } from "../../lib/cca-lifecycle";
import type { LaunchClockState, LaunchConfig } from "./chain";
import { walletRpcScope, type WalletRpc } from "../../wallet/wallet-rpc";

export const LIVE_AUCTION_REFRESH_MS = 15_000;
export const AUCTION_BOUNDARY_MAX_MS = 5 * 60_000;

export function launchSnapshotKey(config: LaunchConfig | null | undefined, wallet: WalletRpc) {
  return ["launch-auction", walletRpcScope(wallet), config?.chainId, config?.auctionAddress.toLowerCase(),
    config?.auctionDeploymentBlock, config?.tokenAddress.toLowerCase()] as const;
}

/** Idle phases retain the session snapshot. Only scheduled boundaries need a cheap head check. */
export function launchRefreshPolicy(state: LaunchClockState | undefined, chainId: number | undefined,
  lastReadAt: number, now = Date.now()): { mode: "snapshot" | "boundary"; delay: number; target?: bigint } | null {
  if (!state) return null;
  const phase = ccaPhase(state);
  if (phase === "live") return { mode: "snapshot", delay: LIVE_AUCTION_REFRESH_MS };
  const target = state.block < state.start ? state.start
    : state.block < state.end && state.soldOut ? state.end
      : state.block < state.claim && state.graduated ? state.claim : undefined;
  if (target === undefined) return null;
  // Chain time only schedules a check; the UI never guesses a block or phase.
  // Unknown chains use the bounded five-minute check instead of assuming cadence.
  const estimate = chainId === 4663 ? Number(target - state.block) * 100 - Math.max(0, now - lastReadAt) : AUCTION_BOUNDARY_MAX_MS;
  return { mode: "boundary", target,
    delay: Math.max(LIVE_AUCTION_REFRESH_MS, Math.min(AUCTION_BOUNDARY_MAX_MS, estimate)) };
}
