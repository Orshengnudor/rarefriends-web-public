import { ANVIL, ROBINHOOD_MAINNET } from "../config/networks.ts";

export function isLocalRpcHost(hostname: string) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 127 || first === 10 || (first === 192 && second === 168)
    || (first === 172 && second >= 16 && second <= 31);
}

/** Wallet registration metadata; never expose the server's credentialed RPC. */
export function publicProtocolRpc(chainId: number, configuredPublicUrl?: string) {
  if (chainId === ROBINHOOD_MAINNET.id) return ROBINHOOD_MAINNET.rpcUrls.default.http[0];
  if (chainId !== ANVIL.id) throw new Error("Only Robinhood Chain production and Anvil are supported.");
  if (!configuredPublicUrl?.trim()) throw new Error("Configure the Anvil RPC URL for browser wallets.");
  let url: URL;
  try { url = new URL(configuredPublicUrl.trim()); }
  catch { throw new Error("Invalid public wallet RPC settings."); }
  if (url.username || url.password || url.search || url.hash
    || decodeURIComponent(url.pathname).replace(/\/+$/, "") === "/api/protocol/rpc"
    || !["http:", "https:"].includes(url.protocol) || !isLocalRpcHost(url.hostname)) {
    throw new Error("Invalid public wallet RPC settings.");
  }
  return url.href.replace(/\/$/, "");
}

/** Both public configuration endpoints share the same supported network metadata. */
export function publicProtocolNetwork(chainId: number, configuredPublicUrl?: string) {
  const rpcUrl = publicProtocolRpc(chainId, configuredPublicUrl);
  const network = chainId === ANVIL.id ? ANVIL : ROBINHOOD_MAINNET;
  return { chainId, name: network.name, rpcUrl,
    explorerUrl: chainId === ANVIL.id ? "" : ROBINHOOD_MAINNET.blockExplorers.default.url };
}
