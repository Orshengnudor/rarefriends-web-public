export interface EthUsdPrice {
  ethUsd: number;
  usdAvailable: boolean;
  usdSource: "coingecko" | null;
  /** CoinGecko's observation time in Unix milliseconds, independent of chain time. */
  usdUpdatedAt: number | null;
  usdStale: boolean;
}

/** The browser reads the server's cached quote without contacting the price feed. */
export async function readEthUsdPrice(): Promise<EthUsdPrice> {
  try {
    const response = await fetch("/api/protocol/prices", { cache: "no-store", signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error("ETH/USD feed unavailable.");
    const body: EthUsdPrice = await response.json();
    if (body.usdAvailable && body.usdSource === "coingecko" && Number.isFinite(body.ethUsd) && body.ethUsd > 0
      && Number.isSafeInteger(body.usdUpdatedAt) && body.usdUpdatedAt! > 0 && body.usdUpdatedAt! <= Date.now() + 300_000
      && typeof body.usdStale === "boolean") return body;
  } catch { /* Off-chain USD estimates never block wallet RPC reads or actions. */ }
  return { ethUsd: 0, usdAvailable: false, usdSource: null, usdUpdatedAt: null, usdStale: false };
}
