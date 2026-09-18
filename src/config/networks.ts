/** Official network settings: https://docs.robinhood.com/chain/connecting/ */
export const ROBINHOOD_MAINNET = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://robinhoodchain.blockscout.com" },
  },
  testnet: false,
} as const;

export const ANVIL = {
  id: 31337,
  name: "Rare Friends Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
} as const;

export function isSupportedChain(chainId: number) {
  return chainId === ROBINHOOD_MAINNET.id || chainId === ANVIL.id;
}
