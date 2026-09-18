"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export type WalletProvider = {
  request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
  getWalletLink?: () => string | undefined;
};
type WalletChoice = { id: string; name: string; provider: WalletProvider };
export type PublicNetwork = { explorerUrl: string };
type WalletContextValue = {
  network: PublicNetwork;
  address?: string;
  chainId?: string;
  connecting: boolean;
  choices: WalletChoice[];
  connect: (choice: WalletChoice) => Promise<void>;
  connectMobile?: () => Promise<void>;
  pickerOpen?: boolean;
  connectionError?: string;
  walletLink?: string;
  disconnect: () => void;
  getSession: () => number;
  request: (method: string, params?: unknown[]) => Promise<unknown>;
};
export const WalletContext = createContext<WalletContextValue | null>(null);
const addressValue = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : undefined;
const chainValue = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) ? value : undefined;
const DISCONNECTED_KEY = "rarefriends.wallet.disconnected";

function rememberDisconnect(disconnected: boolean) {
  try {
    if (disconnected) {
      localStorage.setItem(DISCONNECTED_KEY, "true");
      localStorage.removeItem("rarefriends.walletconnect");
    } else localStorage.removeItem(DISCONNECTED_KEY);
  } catch { /* Keep the in-memory choice when browser storage is unavailable. */ }
}

/** Public pages do not receive deployment settings or a contract/RPC client. */
export function PublicWalletProvider({ network, children }: {
  network: PublicNetwork;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [choices, setChoices] = useState<WalletChoice[]>([]);
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [activeProvider, setActiveProvider] = useState<WalletProvider>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const disconnected = useRef(false);
  const selected = useRef<WalletProvider | undefined>(undefined);
  const session = useRef(0);
  const connectionAttempt = useRef(0);
  const getSession = useCallback(() => session.current, []);

  useEffect(() => {
    let mounted = true;
    try { disconnected.current = localStorage.getItem(DISCONNECTED_KEY) === "true"; } catch {}
    const register = (choice: WalletChoice) => {
      setChoices((current) => current.some((entry) => entry.provider === choice.provider) ? current : [...current, choice]);
      if (disconnected.current) return;
      const discoveredSession = session.current;
      // eth_accounts only checks an existing wallet permission; it never opens a prompt.
      void choice.provider.request({ method: "eth_accounts" }).then(async (accounts) => {
        const account = Array.isArray(accounts) ? addressValue(accounts[0]) : undefined;
        if (!mounted || disconnected.current || !account) return;
        const chain = await choice.provider.request({ method: "eth_chainId" });
        if (!mounted || disconnected.current || selected.current || session.current !== discoveredSession) return;
        session.current += 1;
        selected.current = choice.provider;
        setActiveProvider(choice.provider);
        setAddress(account);
        setChainId(chainValue(chain));
      }).catch(() => {});
    };
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string }; provider?: WalletProvider }>).detail;
      if (detail?.provider?.request && detail.info?.uuid && detail.info.name) {
        register({ id: detail.info.uuid, name: detail.info.name, provider: detail.provider });
      }
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as Window & { ethereum?: WalletProvider }).ethereum;
    if (injected?.request) register({ id: "injected", name: "wallet", provider: injected });
    // Only returning WalletConnect users initialize the relay during page load.
    let restore = false;
    try { restore = localStorage.getItem("rarefriends.walletconnect") === "connected"; } catch {}
    if (restore && !disconnected.current) {
      void import("./walletconnect").then(module => module.getWalletConnect()).then(async client => {
        if (!mounted || disconnected.current || selected.current || !client.restored()) return;
        const discoveredSession = session.current;
        const [accounts, chain] = await Promise.all([
          client.provider.request({ method: "eth_accounts" }), client.provider.request({ method: "eth_chainId" }),
        ]);
        const account = Array.isArray(accounts) ? addressValue(accounts[0]) : undefined;
        if (!mounted || disconnected.current || selected.current || session.current !== discoveredSession || !account) return;
        session.current += 1;
        selected.current = client.provider;
        setActiveProvider(client.provider);
        setAddress(account);
        setChainId(chainValue(chain));
      }).catch(() => {});
    }
    return () => {
      mounted = false;
      session.current += 1;
      connectionAttempt.current += 1;
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, []);

  useEffect(() => {
    if (!activeProvider) return;
    const accounts = (value: unknown) => {
      if (selected.current !== activeProvider) return;
      session.current += 1;
      setAddress(Array.isArray(value) ? addressValue(value[0]) : undefined);
    };
    const chain = (value: unknown) => {
      if (selected.current !== activeProvider) return;
      session.current += 1;
      setChainId(chainValue(value));
    };
    const close = () => {
      if (selected.current !== activeProvider) return;
      session.current += 1;
      connectionAttempt.current += 1;
      selected.current = undefined;
      setAddress(undefined);
      setChainId(undefined);
      setActiveProvider(undefined);
      setConnecting(false);
      queryClient.clear();
    };
    activeProvider.on?.("accountsChanged", accounts);
    activeProvider.on?.("chainChanged", chain);
    activeProvider.on?.("disconnect", close);
    return () => {
      activeProvider.removeListener?.("accountsChanged", accounts);
      activeProvider.removeListener?.("chainChanged", chain);
      activeProvider.removeListener?.("disconnect", close);
    };
  }, [activeProvider, queryClient]);

  const request = useCallback(async (method: string, params?: unknown[]) => {
    if (!activeProvider || selected.current !== activeProvider) throw new Error("Connect your wallet to continue.");
    return activeProvider.request({ method, params });
  }, [activeProvider]);

  async function connect(choice: WalletChoice) {
    const attempt = ++connectionAttempt.current;
    session.current += 1;
    setConnecting(true);
    try {
      const accounts = await choice.provider.request({ method: "eth_requestAccounts" });
      const account = Array.isArray(accounts) ? addressValue(accounts[0]) : undefined;
      if (!account) throw new Error("Wallet connection was not completed.");
      const chain = await choice.provider.request({ method: "eth_chainId" });
      if (attempt !== connectionAttempt.current) throw new Error("Wallet connection was not completed.");
      session.current += 1;
      disconnected.current = false;
      rememberDisconnect(false);
      selected.current = choice.provider;
      setActiveProvider(choice.provider);
      setAddress(account);
      setChainId(chainValue(chain));
    } finally { if (attempt === connectionAttempt.current) setConnecting(false); }
  }

  async function connectMobile() {
    if (connecting) return;
    const attempt = ++connectionAttempt.current;
    session.current += 1;
    setConnecting(true);
    setConnectionError("");
    try {
      const client = await (await import("./walletconnect")).getWalletConnect();
      if (attempt !== connectionAttempt.current) return;
      const provider = await client.connect(setPickerOpen);
      if (attempt !== connectionAttempt.current) { await provider.disconnect?.(); return; }
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" }),
      ]);
      const account = Array.isArray(accounts) ? addressValue(accounts[0]) : undefined;
      if (attempt !== connectionAttempt.current) { await provider.disconnect?.(); return; }
      if (!account || !chainValue(chain)) throw new Error("Your wallet did not approve this network.");
      session.current += 1;
      disconnected.current = false;
      rememberDisconnect(false);
      selected.current = provider;
      setActiveProvider(provider);
      setAddress(account);
      setChainId(chainValue(chain));
    } catch {
      if (attempt === connectionAttempt.current) setConnectionError("Wallet connection was not completed. Choose WalletConnect to try again, or open this page in Safari or Chrome.");
    } finally {
      if (attempt === connectionAttempt.current) setConnecting(false);
    }
  }

  function disconnect() {
    const provider = selected.current;
    session.current += 1;
    connectionAttempt.current += 1;
    disconnected.current = true;
    // Save the user's choice before asynchronous wallet cleanup or a possible reload.
    rememberDisconnect(true);
    selected.current = undefined;
    setAddress(undefined);
    setChainId(undefined);
    setActiveProvider(undefined);
    setConnecting(false);
    queryClient.clear();
    void provider?.disconnect?.().catch(() => {
      setConnectionError("Disconnected here. Remove Rare Friends from your wallet’s connected apps if it still appears there.");
    });
  }

  return (
    <WalletContext.Provider value={{ network, address, chainId, connecting, choices, connect, connectMobile,
      pickerOpen, connectionError, walletLink: activeProvider?.getWalletLink?.(), disconnect, getSession, request }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WalletContext.Provider>
  );
}

export function usePublicWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("Wallet is unavailable.");
  return context;
}
