import type { EthUsdPrice } from "@/src/lib/protocol/price-client";

const PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_last_updated_at=true";
const CACHE_SECONDS = 3600;
const RETRY_MS = 60_000;

let lastGood: { value: number; updatedAt: number } | undefined;
let nextAttemptAt = 0;
let failures = 0;
let pending: Promise<EthUsdPrice> | undefined;

function snapshot(): EthUsdPrice {
  return {
    ethUsd: lastGood?.value ?? 0,
    usdAvailable: Boolean(lastGood),
    usdSource: lastGood ? "coingecko" : null,
    usdUpdatedAt: lastGood?.updatedAt ?? null,
    usdStale: Boolean(lastGood && (failures > 0 || Date.now() - lastGood.updatedAt >= CACHE_SECONDS * 1000)),
  };
}

async function refresh(): Promise<EthUsdPrice> {
  try {
    const response = await fetch(PRICE_URL, {
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("ETH/USD feed unavailable.");
    const body: unknown = await response.json();
    const ethereum = body && typeof body === "object" && "ethereum" in body ? body.ethereum : null;
    const value = ethereum && typeof ethereum === "object" && "usd" in ethereum ? ethereum.usd : null;
    const timestamp = ethereum && typeof ethereum === "object" && "last_updated_at" in ethereum ? ethereum.last_updated_at : null;
    const now = Date.now();
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0
      || typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp * 1000 > now + 300_000) {
      throw new Error("ETH/USD feed returned an invalid price.");
    }
    const updatedAt = timestamp * 1000;
    if (!lastGood || updatedAt >= lastGood.updatedAt) lastGood = { value, updatedAt };
    failures = 0;
    // A stale Next cache entry can be served while it revalidates. Check again
    // shortly in that case instead of retaining it for another full hour.
    nextAttemptAt = Math.max(now + RETRY_MS, Math.min(now + CACHE_SECONDS * 1000, updatedAt + CACHE_SECONDS * 1000));
  } catch {
    failures = Math.min(failures + 1, 5);
    nextAttemptAt = Date.now() + Math.min(RETRY_MS * 2 ** (failures - 1), 15 * RETRY_MS);
  }
  return snapshot();
}

/** One upstream request per process at a time; failures never block chain reads. */
export function readEthUsdPrice(): Promise<EthUsdPrice> {
  if (pending) return pending;
  if (Date.now() < nextAttemptAt) return Promise.resolve(snapshot());
  pending = refresh().finally(() => { pending = undefined; });
  return pending;
}
