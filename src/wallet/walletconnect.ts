import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { createAppKit } from "@reown/appkit/core";
import { isWalletNetwork } from "./wallet-network";
import type { WalletProvider } from "./wallet-provider";
import { walletAppLink } from "./wallet-app-link";

// WalletConnect otherwise sends unapproved read methods to its HTTP rpcMap.
// Request wallet support explicitly and never use that fallback for app reads.
export const WALLET_RPC_METHODS = [
  "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_getBalance", "eth_getCode", "eth_getStorageAt",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "web3_clientVersion", "net_version",
] as const;
const walletRpcMethods = new Set<string>(WALLET_RPC_METHODS);

export const SESSION_KEY = "rarefriends.walletconnect";
export const hasWalletConnectSession = () => {
  try { return localStorage.getItem(SESSION_KEY) === "connected"; } catch { return false; }
};
function remember(connected: boolean) {
  try {
    if (connected) localStorage.setItem(SESSION_KEY, "connected");
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* Storage may be unavailable in private browsing. */ }
}

let runtime: ReturnType<typeof initialize> | undefined;
export function getWalletConnect() {
  return runtime ??= initialize().catch(error => { runtime = undefined; throw error; });
}

function currentThemeMode() {
  return document.documentElement.getAttribute("data-theme") === "invert" ? "dark" : "light";
}

async function initialize() {
  const [settingsResponse, networkResponse] = await Promise.all([
    fetch("/api/wallet/walletconnect", { cache: "no-store", signal: AbortSignal.timeout(12_000) }),
    fetch("/api/wallet/network", { cache: "no-store", signal: AbortSignal.timeout(12_000) }),
  ]);
  if (!settingsResponse.ok || !networkResponse.ok) throw new Error("Mobile wallets are unavailable. Try again.");
  const settings = await settingsResponse.json();
  const network = await networkResponse.json();
  if (!settings.projectId || !/^[a-f0-9]{32}$/i.test(settings.projectId) || !isWalletNetwork(network)) {
    throw new Error("Mobile wallets are unavailable. Try again later.");
  }
  const metadata = { name: "Rare Friends", description: "Rare Friends token and portfolio", url: location.origin,
    icons: [`${location.origin}/icon.svg`] };
  const provider = await EthereumProvider.init({
    projectId: settings.projectId, metadata, showQrModal: false,
    optionalChains: [network.chainId],
    optionalMethods: ["eth_sendTransaction", "wallet_switchEthereumChain", "wallet_addEthereumChain", ...WALLET_RPC_METHODS],
    optionalEvents: ["accountsChanged", "chainChanged"],
    rpcMap: { [network.chainId]: network.rpcUrl, [`eip155:${network.chainId}`]: network.rpcUrl },
    // A new session requests the wallet's read methods and drops any cached
    // namespaces that still contain the retired application RPC URL.
    customStoragePrefix: `rarefriends-wallet-rpc-v2-${network.chainId}`,
    disableProviderPing: true, telemetryEnabled: false,
  });
  const modal = createAppKit({
    projectId: settings.projectId, metadata, universalProvider: provider.signer,
    manualWCControl: true, enableReconnect: false,
    networks: [{ id: network.chainId, name: network.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [network.rpcUrl] } },
      ...(network.explorerUrl ? { blockExplorers: { default: { name: "Explorer", url: network.explorerUrl } } } : {}),
    }],
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false },
    themeMode: currentThemeMode(), themeVariables: { "--w3m-accent": "#111111", "--w3m-border-radius-master": "0px",
      "--w3m-font-family": "Arial, sans-serif" },
  });

  let pairing: Promise<void> | undefined;
  let watching = false;
  let disconnecting: Promise<void> | undefined;
  async function disconnect() {
    remember(false);
    await modal.close();
    if (disconnecting) return disconnecting;
    disconnecting = (async () => {
      if (provider.session) await provider.disconnect();
    })().finally(() => { disconnecting = undefined; });
    return disconnecting;
  }
  const bridge: WalletProvider = {
    request: async ({ method, params }) => {
      // UniversalProvider returns a number here; the app's EIP-1193 boundary uses hex.
      if (method === "eth_chainId") return `0x${provider.chainId.toString(16)}`;
      if (walletRpcMethods.has(method)) {
        const session = provider.session;
        const chain = `eip155:${provider.chainId}`;
        const approved = session && Object.entries(session.namespaces).some(([key, namespace]) =>
          (key === chain || (key === "eip155" && (namespace.chains?.includes(chain)
            || namespace.accounts.some(account => account.startsWith(`${chain}:`)))))
          && namespace.methods.includes(method));
        if (!approved) {
          throw Object.assign(new Error(`Your mobile wallet has not approved ${method}. Reconnect to approve wallet RPC reads, or use a browser wallet that supports them.`), { code: 4200 });
        }
        // SignClient is the session transport to the actual wallet. Calling it
        // directly prevents UniversalProvider's implicit public-HTTP fallback.
        return provider.signer.client.request({ topic: session.topic, chainId: chain, request: { method, params: params ?? [] } });
      }
      return provider.request({ method, params });
    },
    on: (event, listener) => { provider.events.on(event, listener); },
    removeListener: (event, listener) => { provider.events.removeListener(event, listener); },
    disconnect,
    getWalletLink: () => {
      if (!provider.session) return;
      const redirect = provider.session.peer.metadata.redirect;
      const link = walletAppLink(redirect?.native) ?? walletAppLink(redirect?.universal);
      if (link) return link;
      try { return walletAppLink(JSON.parse(localStorage.getItem("WALLETCONNECT_DEEPLINK_CHOICE") ?? "null")?.href); }
      catch { return; }
    },
  };
  provider.on("disconnect", () => remember(false));

  return {
    provider: bridge,
    restored: () => Boolean(provider.session && hasWalletConnectSession()),
    async connect(onPicker: (open: boolean) => void) {
      await disconnecting;
      watching = true;
      let themeObserver: MutationObserver | undefined;
      try {
        if (!provider.session) {
          // Reopening a cancelled picker resumes its pairing instead of issuing duplicate proposals.
          pairing ??= provider.connect().then(async () => {
            if (!watching) await disconnect();
          }).finally(() => { pairing = undefined; });
          // Handle background rejection if the user closes the picker before the wallet responds.
          void pairing.catch(() => {});
          const syncTheme = () => modal.setThemeMode(currentThemeMode());
          themeObserver = new MutationObserver(syncTheme);
          themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
          syncTheme();
          onPicker(true);
          await modal.open();
          let unsubscribe = () => {};
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([pairing, new Promise<never>((_, reject) => {
              unsubscribe = modal.subscribeState(state => {
                if (!state.open && !provider.session) reject(new Error("Connection cancelled. Choose a wallet to try again."));
              });
              timer = setTimeout(() => reject(new Error("Connection timed out. Choose a wallet to try again.")), 180_000);
            })]);
          } finally { unsubscribe(); clearTimeout(timer); }
        }
        if (!provider.session || !provider.accounts.length) throw new Error("Your wallet did not approve this network. Choose another wallet.");
        remember(true);
        return bridge;
      } finally {
        watching = false;
        themeObserver?.disconnect();
        await modal.close();
        onPicker(false);
      }
    },
  };
}
