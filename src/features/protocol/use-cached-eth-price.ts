"use client";

import { useQuery } from "@tanstack/react-query";
import { readEthUsdPrice, type EthUsdPrice } from "@/src/lib/protocol/price-client";
import { useProtocol } from "./protocol-provider";

/** Prefer the shared quote; retain the hourly HTTP cache as a fallback. */
export function useCachedEthUsdPrice(): EthUsdPrice | undefined {
  const { publicSnapshot, publicLoading, publicError } = useProtocol();
  const prices = publicSnapshot?.protocol.prices;
  const shared = prices?.usdAvailable && prices.usdSource === "coingecko"
    && Number.isFinite(prices.ethUsd) && prices.ethUsd > 0
    && Number.isSafeInteger(prices.usdUpdatedAt) && prices.usdUpdatedAt! > 0
    && prices.usdUpdatedAt! <= (publicSnapshot?.updatedAt ?? 0) + 300_000 ? prices : undefined;
  const query = useQuery({
    queryKey: ["protocol-cached-eth-usd"],
    enabled: !publicLoading && (!shared || Boolean(publicError)),
    queryFn: async () => {
      const price = await readEthUsdPrice();
      if (!price.usdAvailable || !Number.isFinite(price.ethUsd) || price.ethUsd <= 0) {
        throw new Error("The cached ETH/USD price is unavailable.");
      }
      return price;
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  // A lost stream can retain its last quote while the independent HTTP cache
  // recovers. Prefer a newer successful observation if that fallback has one.
  if (shared && (!publicError || !query.data || (shared.usdUpdatedAt ?? 0) >= (query.data.usdUpdatedAt ?? 0))) return {
    ethUsd: shared.ethUsd, usdAvailable: true, usdSource: shared.usdSource ?? null,
    usdUpdatedAt: shared.usdUpdatedAt ?? null, usdStale: Boolean(shared.usdStale || publicError) };
  // An unavailable refresh never turns the last usable cached quote into $0.
  return query.data && query.isError ? { ...query.data, usdStale: true } : query.data;
}
