/** Wallet connection dialog and network messages. */
export const walletContent = {
  networkError: "Network request failed.",
  switchError: "The network switch was not completed. Try again in your wallet.",
  connectError: "Wallet connection was not completed. Open your wallet and try again.",
  connecting: "Connecting your wallet…",
  disconnect: "disconnect",
  openApp: "open wallet app",
  switchNotice: "Switch networks to continue.",
  switch: "switch network",
  installNotice: "Open this page in a browser with an Ethereum wallet installed.",
  connectNotice: "Connect your wallet to continue.",
  network: { title: "Network details", name: "Network", chain: "Chain ID", currency: "Currency", rpc: "RPC", explorer: "Explorer", unavailable: "Not available on local chain" },
} as const;
