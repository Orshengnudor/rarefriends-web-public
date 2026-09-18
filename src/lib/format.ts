/**
 * Locale-stable formatting. `Number.prototype.toLocaleString()` with no locale uses the
 * server's ICU default during SSR and the reader's browser locale on the client, which
 * throws a hydration error on every page for anyone outside en-US. Machine strings in this
 * design system are fixed data, not reader-localised text, so grouping is done explicitly.
 */
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Thousands-separated, two decimals — never `toLocaleString`, which breaks hydration. */
export function money(value: number) {
  const rounded = Math.abs(value).toFixed(2);
  const [whole, cents] = rounded.split(".");
  // The sign follows the rounded magnitude: -0.004 is two decimals of zero, and "-0.00" is not a number.
  const sign = value < 0 && Number(rounded) !== 0 ? "-" : "";
  return `${sign}${groupDigits(Number(whole))}.${cents}`;
}

export function usd(value: number) {
  return `$${money(value)}`;
}

/** A token amount: six decimals, thousands-separated — the precision a tokenized share carries. */
export function tokenAmount(value: number) {
  const [whole, fraction] = value.toFixed(6).split(".");
  return `${groupDigits(Number(whole))}.${fraction}`;
}

/** `0x8a3f19c2…b3d5` → `0x8a3f…b3d5`. Values that are already elided are left alone. */
export function shortAddress(value: string) {
  return value.length > 12 && !value.includes("…") ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
