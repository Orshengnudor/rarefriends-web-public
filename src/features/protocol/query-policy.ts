/** Display snapshots live in the QueryClient for this browser session, not a timer. */
export const sessionDisplayCache = {
  gcTime: Infinity,
  refetchInterval: false,
  refetchOnReconnect: false,
  retry: false,
} as const;

export const metadataReadPolicy = {
  ...sessionDisplayCache,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
} as const;

export function protocolReadPolicy(pathname: string | null, walletReady: boolean) {
  const portfolio = pathname === "/portfolio" || Boolean(pathname?.startsWith("/portfolio/"));
  const homepage = pathname === "/";
  return {
    ...sessionDisplayCache,
    kind: portfolio ? "portfolio" : "protocol",
    includeAccount: portfolio,
    // The homepage reads protocol figures for every visitor; portfolios need a ready wallet.
    enabled: homepage || portfolio && walletReady,
    staleTime: portfolio ? 60_000 : 5 * 60_000,
    refetchOnWindowFocus: portfolio,
  } as const;
}

/** Confirmed actions invalidate displays; transaction checks never use this cache. */
export const protocolDisplayQueryKeys = [["protocol-state"], ["protocol-wallet-balances"]] as const;
