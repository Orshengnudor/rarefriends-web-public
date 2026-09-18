/** Wallet links may use HTTPS or an installed app's custom scheme, never executable URLs. */
export function walletAppLink(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return;
  try {
    const url = new URL(value);
    if (["javascript:", "data:", "vbscript:", "file:", "blob:", "http:", "about:"].includes(url.protocol)
      || url.username || url.password) return;
    return value;
  } catch { return; }
}
