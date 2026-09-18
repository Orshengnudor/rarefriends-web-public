import type { LaunchState } from "./chain";

const Q96 = 1n << 96n;

/** Frontend preview ceiling in USD; changing this does not change the auction. */
export const LAUNCH_MARKET_CAP_MAX_USD = 50_000_000;

type ValuationState = Pick<LaunchState, "tokenSupply" | "currencyDecimals">;
type PriceState = ValuationState & Pick<LaunchState, "floor" | "tick" | "maxBidPrice" | "price">;

export type LaunchMarketCapSlider = {
  minPrice: bigint;
  maxPrice: bigint;
  defaultPrice: bigint;
  tick: bigint;
  steps: number;
};

// Treat the displayed USD quote and selected cap as decimal fractions. Number
// arithmetic must never decide which integer tick a transaction will submit.
function fraction(value: string | number) {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("A USD price is unavailable.");
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 400) throw new Error("Enter a valid market cap.");
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) throw new Error("Enter a valid market cap.");
  const numerator = BigInt(`${match[1]}${match[2] ?? ""}`);
  return exponent >= 0
    ? { numerator: numerator * 10n ** BigInt(exponent), denominator: 1n }
    : { numerator, denominator: 10n ** BigInt(-exponent) };
}

function currencyScale(state: ValuationState) {
  if (state.tokenSupply <= 0n || !Number.isInteger(state.currencyDecimals)
    || state.currencyDecimals < 0 || state.currencyDecimals > 255) throw new Error("Auction valuation is unavailable.");
  return 10n ** BigInt(state.currencyDecimals);
}

/** Display-only USD valuation of the full outstanding token supply. */
export function launchMarketCapUsd(price: bigint, state: ValuationState, currencyUsd: number): number | null {
  try {
    const scale = currencyScale(state);
    if (price < 0n || !Number.isFinite(currencyUsd) || currencyUsd <= 0) return null;
    const value = Number(price * state.tokenSupply) / Number(Q96 * scale) * currencyUsd;
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

/** Q96 limit at or below a chosen USD cap, rounded down to the auction tick. */
export function launchMarketCapPrice(capUsd: string | number, state: PriceState, currencyUsd: number): bigint {
  const scale = currencyScale(state);
  const cap = fraction(capUsd);
  const quote = fraction(currencyUsd);
  if (cap.numerator <= 0n || quote.numerator <= 0n || state.tick <= 0n) throw new Error("A market cap and USD price are required.");
  const raw = cap.numerator * quote.denominator * Q96 * scale
    / (cap.denominator * quote.numerator * state.tokenSupply);
  return raw / state.tick * state.tick;
}

/** A practical preview range; the contract maximum remains the upper bound. */
export function launchMarketCapSlider(state: PriceState, currencyUsd: number): LaunchMarketCapSlider | null {
  try {
    if (state.tick <= 0n || state.floor < 0n || state.price < 0n || state.maxBidPrice <= 0n) return null;
    const minPrice = ((state.floor + state.tick - 1n) / state.tick || 1n) * state.tick;
    const absoluteMax = state.maxBidPrice / state.tick * state.tick;
    if (absoluteMax < minPrice) return null;
    const desiredMax = launchMarketCapPrice(LAUNCH_MARKET_CAP_MAX_USD, state, currencyUsd);
    if (desiredMax < minPrice) return null;
    const maxPrice = desiredMax > absoluteMax ? absoluteMax : desiredMax;
    // The implied cap uses the clearing price; bids must exceed it by a valid tick.
    const aboveClearing = (state.price / state.tick + 1n) * state.tick;
    const defaultPrice = aboveClearing > maxPrice ? maxPrice : aboveClearing < minPrice ? minPrice : aboveClearing;
    const ticks = (maxPrice - minPrice) / state.tick;
    return { minPrice, maxPrice, defaultPrice, tick: state.tick, steps: Number(ticks < 1000n ? ticks : 1000n) };
  } catch { return null; }
}

/** Integer-only curved scale gives lower caps finer control and every key a new tick. */
export function launchSliderPrice(position: number, range: LaunchMarketCapSlider): bigint {
  if (range.steps === 0) return range.minPrice;
  const point = BigInt(Math.max(0, Math.min(range.steps, Math.round(Number.isFinite(position) ? position : 0))));
  const steps = BigInt(range.steps);
  const span = (range.maxPrice - range.minPrice) / range.tick;
  const offset = point + (span - steps) * point * point / (steps * steps);
  return range.minPrice + offset * range.tick;
}

/** Nearest thumb position for a stored Q96 selection; this never changes its price. */
export function launchSliderPosition(price: bigint, range: LaunchMarketCapSlider): number {
  if (price <= range.minPrice || range.steps === 0) return 0;
  if (price >= range.maxPrice) return range.steps;
  let low = 0;
  let high = range.steps;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (launchSliderPrice(middle, range) < price) low = middle;
    else high = middle;
  }
  return price - launchSliderPrice(low, range) <= launchSliderPrice(high, range) - price ? low : high;
}
