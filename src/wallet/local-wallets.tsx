"use client";

import { useEffect } from "react";
import type { WalletProvider } from "@/src/wallet/wallet-provider";
import { isWalletNetwork } from "@/src/wallet/wallet-network";
import { verifiedLocalWalletRpc } from "./local-wallet-rpc";
import { useProtocolConfig } from "../features/protocol/use-config";

/** Local Anvil accounts join the existing wallet picker. No keys enter the app. */
export function LocalWallets() {
  const { data: config } = useProtocolConfig();
  useEffect(() => {
    if (!config || config.chainId !== 31337 || !Array.isArray(config.localAccounts)
      || !isWalletNetwork({ name: config.chainName, chainId: config.chainId, rpcUrl: config.rpcUrl, explorerUrl: config.explorerUrl })) return;
    let disposed = false;
    const announces: (() => void)[] = [];
    const announce = () => announces.forEach(send => send());
    window.addEventListener("eip6963:requestProvider", announce);
    void verifiedLocalWalletRpc(config.rpcUrl).then(async rpc => {
      if (disposed) return;
      const names = ["Alice", "Bob", "Charlie"];
      for (const [index, address] of config.localAccounts!.slice(1, 4).entries()) {
        if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
        if (!rpc.accounts.some(account => account.toLowerCase() === address.toLowerCase())) continue;
        const id = `rarefriends-anvil-${address.toLowerCase()}`;
        let connected = false;
        try { connected = localStorage.getItem("rarefriends.anvil.account") === address; } catch {}
        const provider: WalletProvider = {
          async request({ method, params = [] }) {
            if (method === "eth_requestAccounts") {
              connected = true;
              try { localStorage.setItem("rarefriends.anvil.account", address); } catch {}
              return [address];
            }
            if (method === "eth_accounts") return connected ? [address] : [];
            if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
              if ((params[0] as { chainId?: string })?.chainId !== "0x7a69") throw new Error("This wallet is only available on local Anvil.");
              return null;
            }
            if (method === "eth_sendTransaction") {
              const transaction = params[0] as { from?: string };
              if (!connected || transaction.from?.toLowerCase() !== address.toLowerCase()) throw new Error("Reconnect this Anvil account.");
            }
            return rpc.request(method, params);
          },
          async disconnect() {
            connected = false;
            try { localStorage.removeItem("rarefriends.anvil.account"); } catch {}
          },
        };
        announces.push(() => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
          detail: { info: { uuid: id, name: `Anvil ${names[index]} · local` }, provider },
        })));
      }
      if (!disposed) announce();
    }).catch(() => {});
    return () => { disposed = true; window.removeEventListener("eip6963:requestProvider", announce); };
  }, [config]);
  return null;
}
