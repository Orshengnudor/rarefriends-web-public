"use client";

import { useState } from "react";
import { walletContent as copy } from "@/src/content/wallet";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/src/components/ui/button";
import { shortAddress } from "@/src/lib/format";
import { usePublicWallet } from "./wallet-provider";
import { isWalletNetwork, type WalletNetworkDetails } from "./wallet-network";

async function readWalletNetwork(): Promise<WalletNetworkDetails> {
  const response = await fetch("/api/wallet/network", { cache: "no-store" });
  if (!response.ok) throw new Error(copy.networkError);
  const body = await response.json();
  if (!isWalletNetwork(body)) throw new Error(copy.networkError);
  return body;
}

/** Connection details are fetched only in the wallet dialog and are visible here. */
export function PublicWalletControls() {
  const wallet = usePublicWallet();
  const network = useQuery({ queryKey: ["wallet-network"], queryFn: readWalletNetwork, staleTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const wrongNetwork = network.data && wallet.chainId && BigInt(wallet.chainId) !== BigInt(network.data.chainId);

  async function switchNetwork() {
    if (!network.data) return;
    setError("");
    setSwitching(true);
    const chainId = `0x${network.data.chainId.toString(16)}`;
    try {
      try { await wallet.request("wallet_switchEthereumChain", [{ chainId }]); }
      catch (cause) {
        if ((cause as { code?: number }).code !== 4902) throw cause;
        await wallet.request("wallet_addEthereumChain", [{
          chainId, chainName: network.data.name,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [network.data.rpcUrl],
          ...(network.data.explorerUrl ? { blockExplorerUrls: [network.data.explorerUrl] } : {}),
        }]);
        await wallet.request("wallet_switchEthereumChain", [{ chainId }]);
      }
    } catch { setError(copy.switchError); }
    finally { setSwitching(false); }
  }

  return (
    <div className="stack-sm">
      {wallet.connecting ? <p role="status">{copy.connecting}</p> : wallet.address ? (
        <>
          <div className="wallet-controls-row">
            <span className="rf-data" title={wallet.address}>{shortAddress(wallet.address)}</span>
            <Button size="sm" variant="ghost" onClick={wallet.disconnect}>{copy.disconnect}</Button>
          </div>
          {wallet.walletLink ? <a href={wallet.walletLink}>{copy.openApp}</a> : null}
          {wrongNetwork ? <>
            <p className="rf-label">{copy.switchNotice}</p>
            <Button onClick={switchNetwork} loading={switching}>{copy.switch}</Button>
          </> : null}
        </>
      ) : (
        <>
          <div className="button-row">
            {wallet.choices.map((choice) => <Button key={choice.id} variant="primary" icon="wallet"
              onClick={async () => {
                setError("");
                try { await wallet.connect(choice); }
                catch { setError(copy.connectError); }
              }}>connect {choice.name}</Button>)}
            {wallet.connectMobile ? <Button variant="primary" icon="qr-code" onClick={wallet.connectMobile}>
              WalletConnect
            </Button> : null}
          </div>
          {!wallet.choices.length && !wallet.connectMobile ? <p>{copy.installNotice}</p> : null}
          <p className="rf-label">{copy.connectNotice}</p>
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {wallet.connectionError ? <p role="alert">{wallet.connectionError}</p> : null}
      {network.data ? <details className="wallet-network-details">
        <summary>{copy.network.title}</summary>
        <dl>
          <dt>{copy.network.name}</dt><dd>{network.data.name}</dd>
          <dt>{copy.network.chain}</dt><dd>{network.data.chainId}</dd>
          <dt>{copy.network.currency}</dt><dd>ETH · 18 decimals</dd>
          <dt>{copy.network.rpc}</dt><dd><a href={network.data.rpcUrl} target="_blank" rel="noreferrer">{network.data.rpcUrl}</a></dd>
          <dt>{copy.network.explorer}</dt><dd>{network.data.explorerUrl
            ? <a href={network.data.explorerUrl} target="_blank" rel="noreferrer">{network.data.explorerUrl}</a>
            : copy.network.unavailable}</dd>
        </dl>
      </details> : null}
    </div>
  );
}
