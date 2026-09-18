import { ANVIL, isSupportedChain } from "@/src/config/networks";

export type WalletNetworkDetails = { name: string; chainId: number; rpcUrl: string; explorerUrl: string };

function isLocalHost(hostname: string) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 127 || first === 10 || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31);
}

function isNetworkUrl(value: unknown, local: boolean) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || decodeURIComponent(url.pathname).replace(/\/+$/, "") === "/api/protocol/rpc") return false;
    return local
      ? ["http:", "https:"].includes(url.protocol) && isLocalHost(url.hostname)
      : url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Local wallet setup may use a LAN RPC and has no block explorer. */
export function isWalletNetwork(value: unknown): value is WalletNetworkDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== "chainId,explorerUrl,name,rpcUrl") return false;
  const data = value as Record<string, unknown>;
  if (typeof data.name !== "string" || !data.name.trim() || typeof data.chainId !== "number"
    || !isSupportedChain(data.chainId)) return false;
  const local = data.chainId === ANVIL.id;
  return isNetworkUrl(data.rpcUrl, local)
    && ((local && data.explorerUrl === "") || isNetworkUrl(data.explorerUrl, local));
}
