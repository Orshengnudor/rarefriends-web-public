"use client";

import { usd } from "@/src/lib/format";
import { useProtocol } from "./protocol-provider";

/** A missing quote is unavailable, not a zero-dollar holding. */
export function useUsdFormat() {
  const { snapshot, publicSnapshot } = useProtocol();
  const prices = publicSnapshot?.protocol.prices ?? snapshot?.protocol.prices;
  return (value: number, asset: "ETH" | "RF" | "mixed" = "mixed") => {
    const available = Boolean(prices && prices.ethUsd > 0 && (asset === "ETH" || prices.rfUsd > 0));
    return available && Number.isFinite(value) ? usd(value) : "—";
  };
}
