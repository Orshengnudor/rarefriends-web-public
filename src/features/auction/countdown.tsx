"use client";

import { auctionContent } from "@/src/content/auction";
import { ccaCountdown, ccaPhase } from "@/src/lib/cca-lifecycle";
import { auctionBiddingClosed } from "./ui-policy";

type ClockState = Parameters<typeof ccaPhase>[0] & { head?: { timestamp: bigint } };

export function LaunchCountdown({ state, chainId, loading = false, error = false, compact = false, walletStatus }: {
  state: ClockState | null;
  chainId?: number;
  loading?: boolean;
  error?: boolean;
  compact?: boolean;
  walletStatus?: "disconnected" | "wrong-chain";
}) {
  const className = compact ? "app-launch-countdown app-launch-countdown-compact" : "app-launch-countdown";
  if (auctionBiddingClosed(chainId)) {
    const copy = auctionContent.completed;
    return <div className={className} role="status" aria-label={`${copy.summaryLabel}: ${copy.summaryTitle}. ${copy.summaryDetail}`}>
      <span>{copy.summaryLabel}</span><strong>{copy.summaryTitle}</strong>
      {!compact && <small>{copy.summaryDetail}</small>}
    </div>;
  }

  const copy = auctionContent.countdown;
  const phase = state ? ccaPhase(state) : null;
  const countdown = state ? ccaCountdown(state) : null;
  const available = !!state && !error && !walletStatus;
  let label: string = loading ? copy.reading : copy.label;
  let value: string = loading ? copy.loading : copy.unavailable;
  let detail: string = copy.needsData;

  if (walletStatus) {
    label = copy.label;
    value = walletStatus === "disconnected" ? copy.connect : copy.switch;
    detail = walletStatus === "disconnected" ? copy.connectDetail : copy.switchDetail;
  }

  if (available && countdown && phase) {
    label = copy.events[countdown.event];
    value = countdown.target === null ? auctionContent.phases[phase]
      : `${countdown.blocks.toLocaleString("en-US")} ${countdown.blocks === 1n ? "block" : "blocks"}`;
    detail = copy.detail;
    if (phase === "settlement" && countdown.event === "claim") label = copy.settlement;
    if (phase === "sold-out" && countdown.event === "end") label = copy.soldOut;
    if (phase === "unfunded" && countdown.event !== "complete") {
      label = copy.unfunded[countdown.event];
    }
  }

  return <div className={className}
    data-live={available && phase === "live"} role="timer" aria-live="off"
    aria-label={`${label}: ${value}. ${detail}`}>
    <span>{label}</span>
    <strong>{value}</strong>
    {!compact && <small>{detail}</small>}
  </div>;
}
