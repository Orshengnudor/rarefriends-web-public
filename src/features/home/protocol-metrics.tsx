"use client";

import { metricsContent as copy } from "@/src/content/home";
import { useProtocol } from "../protocol/protocol-provider";
import { formatAmount } from "../portfolio/analytics-data";

/** Public protocol context remains visible before someone connects a wallet. */
export function ProtocolMetrics() {
  const { snapshot, publicSnapshot, publicLoading, publicError, loading } = useProtocol();
  const protocol = publicSnapshot?.protocol ?? snapshot?.protocol;
  const blockNumber = publicSnapshot?.blockNumber ?? snapshot?.blockNumber;
  const metrics = protocol?.metrics;
  const usdAvailable = ((protocol?.prices.ethUsd ?? 0) > 0 && (protocol?.prices.rfUsd ?? 0) > 0);
  const money = (usd: number | undefined) => usd !== undefined && usdAvailable ? `$${formatAmount(usd, 0)}` : "—";
  const amounts = (rf: number | undefined, weth: number | undefined, note: string) =>
    rf !== undefined && weth !== undefined ? `${formatAmount(rf)} RF · ${formatAmount(weth, 4)} WETH · ${note}` : note;
  const items = [
    { label: copy.friends.label, value: metrics?.friendsPlaying !== undefined ? formatAmount(metrics.friendsPlaying, 0) : "—", detail: metrics?.friendsPlaying !== undefined ? `${formatAmount(metrics.activatedGenesis, 0)} Genesis · ${formatAmount(metrics.friendsPlaying - metrics.activatedGenesis, 0)} Generations` : copy.friends.detail },
    { label: copy.reserve.label, value: metrics ? formatAmount(metrics.vaultInventory) : "—", detail: copy.reserve.detail },
    { label: copy.weight.label, value: metrics ? formatAmount(metrics.genesisWeight + metrics.generationsWeight, 0) : "—", detail: copy.weight.detail },
    { label: copy.paid.label, value: money(metrics?.weekRewardsUsd), detail: amounts(metrics?.weekRewardsRf, metrics?.weekRewardsWeth, copy.paid.detail) },
    { label: copy.pending.label, value: money(metrics?.streamRemainingUsd), detail: amounts(metrics?.streamRemainingRf, metrics?.streamRemainingWeth, copy.pending.detail) },
    { label: copy.apy.label, value: metrics?.rewardApy !== undefined && usdAvailable ? `${formatAmount(metrics.rewardApy, 2)}%` : "—", detail: copy.apy.detail },
  ];
  return <section id="protocol-stats" className="app-protocol" aria-labelledby="app-protocol-title">
    <div className="app-protocol-inner"><div className="app-protocol-heading"><h2 id="app-protocol-title">{copy.title}</h2><span className="app-protocol-example">{protocol ? `${publicError ? copy.cached : copy.onchain} · block ${blockNumber}${protocol.prices.usdStale ? copy.cachedPrice : ""}` : publicLoading || loading ? copy.loading : copy.unavailable}</span></div>
      <dl className="app-protocol-grid">{items.map(item => <div key={item.label} className="app-protocol-stat"><dt>{item.label}</dt><dd>{item.value}</dd><p>{item.detail}</p></div>)}</dl>
    </div>
  </section>;
}
