"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/src/components/ui/button";
import { Icon } from "@/src/components/ui/icon";
import { TokenMark } from "@/src/components/art/friend-sprite";
import { swapContent as copy } from "@/src/content/home";
import { useOpenWalletDialog } from "@/src/wallet/wallet-dialog-context";
import { usePublicWallet } from "@/src/wallet/wallet-provider";
import { walletRpcScope } from "@/src/wallet/wallet-rpc";
import { RF_SYMBOL } from "../protocol/model";
import { useProtocol } from "../protocol/protocol-provider";
import { prepareTransaction } from "../protocol/transaction-client";

const format = (amount: number, maximumFractionDigits = 4) => amount.toLocaleString("en-US", { maximumFractionDigits });

export function SwapCard() {
  const { walletBalances, swap, snapshot, publicSnapshot, publicError, config, busy } = useProtocol();
  const protocol = publicSnapshot?.protocol ?? snapshot?.protocol;
  const wallet = usePublicWallet();
  const walletReady = Boolean(config && wallet.address && wallet.chainId && BigInt(wallet.chainId) === BigInt(config.chainId));
  const openWallet = useOpenWalletDialog();
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [settings, setSettings] = useState(false);
  const [slippage, setSlippage] = useState("1");
  const numeric = Number(amount);
  const valid = /^\d*\.?\d*$/.test(amount) && Number.isFinite(numeric) && numeric > 0;
  const [debouncedAmount, setDebouncedAmount] = useState("");
  // Buy side only: WETH holders swap directly without wrapping; sells still unwrap into ETH.
  const [payWith, setPayWith] = useState<"ETH" | "WETH">("ETH");
  const payWeth = buy && payWith === "WETH";
  const swapInput = (value: string) => ({ buy, amount: value, slippageBps: Number(slippage) * 100, ...(payWeth ? { payWith: "WETH" as const } : {}) });
  useEffect(() => { const timer = setTimeout(() => setDebouncedAmount(amount), 350); return () => clearTimeout(timer); }, [amount]);
  const liveQuote = useQuery({ queryKey: ["protocol-swap-quote", walletRpcScope(wallet), config?.chainId, wallet.address, buy, payWeth, debouncedAmount, slippage],
    queryFn: ({ signal }) => prepareTransaction({ address: wallet.address!, swap: swapInput(debouncedAmount) }, config!, wallet, signal),
    enabled: !publicError && walletReady && Boolean(protocol?.marketReady && Number(debouncedAmount) > 0),
    staleTime: 10_000, refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false });
  const quote = walletReady && !publicError && valid && debouncedAmount === amount ? liveQuote.data?.swapQuote ?? null : null;
  const ethPrice = protocol?.prices.ethUsd ?? 0;
  const rfPrice = protocol?.prices.rfUsd ?? 0;
  const ready = Boolean(protocol?.marketReady && !publicError);

  const from = buy ? payWith : RF_SYMBOL;
  const to = buy ? RF_SYMBOL : "ETH";
  const balances = walletBalances;
  const balance = balances ? buy ? payWeth ? balances.weth : balances.eth : balances.tokenBalance : null;

  return <div className="app-swap-area"><div className="app-swap">
    <div className="app-swap-toolbar"><div className="app-swap-tabs" aria-label="Trade direction"><button type="button" aria-pressed={buy} onClick={() => { setBuy(true); setAmount(""); }}>{copy.buy}</button><button type="button" aria-pressed={!buy} onClick={() => { setBuy(false); setAmount(""); }}>{copy.sell}</button></div><button type="button" className="app-settings-button" aria-label={copy.settings} aria-expanded={settings} onClick={() => setSettings(!settings)}><Icon name="sliders" size={24} /></button></div>
    {settings && <div className="app-swap-settings"><span className="app-mono">{copy.slippage}</span><div className="app-settings-options">{["0.1", "0.5", "1", "5"].map(value => <button type="button" aria-pressed={slippage === value} onClick={() => setSlippage(value)} key={value}>{value}%</button>)}</div><p>{copy.slippageDescription}</p></div>}
    <div className="app-swap-field"><label htmlFor="app-swap-amount">{copy.pay}</label><div className="app-swap-input-row"><input id="app-swap-amount" inputMode="decimal" autoComplete="off" placeholder="0" value={amount} onChange={event => { if (/^\d*\.?\d*$/.test(event.target.value)) setAmount(event.target.value); }} aria-describedby="app-swap-balance" />{buy
        ? <button type="button" className="app-currency app-currency-toggle" aria-label={`Paying with ${payWith}. Switch to ${payWeth ? "ETH" : "WETH"}`} onClick={() => { setPayWith(payWeth ? "ETH" : "WETH"); }}><TokenMark eth />{from}<span className="app-currency-switch">⇄ {payWeth ? "ETH" : "WETH"}</span></button>
        : <span className="app-currency"><TokenMark eth={buy} />{from}</span>}</div><div className="app-swap-meta"><span>{protocol && valid && (buy ? ethPrice : rfPrice) > 0 ? `$${format(numeric * (buy ? ethPrice : rfPrice), 2)}` : "$—"}</span><span id="app-swap-balance">{copy.balance}: {balance === null ? "—" : format(balance)}{balance !== null && <button type="button" onClick={() => setAmount(String(buy && !payWeth ? Math.max(0, balance - 0.002) : balance))}>{copy.max}</button>}</span></div></div>
    <div className="app-swap-divider"><button type="button" aria-label="Reverse swap direction" onClick={() => { setBuy(!buy); setAmount(""); }}><Icon name="arrow-down" size={24} /></button></div>
    <div className="app-swap-field app-swap-output"><span className="app-mono">{copy.receive}</span><div className="app-swap-input-row"><output aria-live="polite">{quote ? format(quote.output) : "0"}</output><span className="app-currency"><TokenMark eth={!buy} />{to}</span></div><div className="app-swap-meta"><span>{quote && (buy ? rfPrice : ethPrice) > 0 ? `$${format(quote.output * (buy ? rfPrice : ethPrice), 2)}` : "$—"}</span><span>{copy.estimate}</span></div></div>
    {quote && <div className="app-quote-detail"><span>{copy.minimum} · {slippage}% slippage</span><span>{format(quote.minimumReceived)} {to}</span></div>}
    {valid && liveQuote.error && <p className="app-fp-action-error" role="alert">{liveQuote.error.message}</p>}
    <Button block size="lg" variant="primary" disabled={busy || ((Boolean(wallet.address)) && (!ready || !valid || !quote?.enabled || (liveQuote.isFetching)))} onClick={() => {
      if (!wallet.address) openWallet();
      else if (valid && quote?.enabled) swap(buy, amount, Number(slippage) * 100, payWeth ? "WETH" : undefined);
    }}>
      {!wallet.address ? copy.connect : !config ? copy.unavailable : !walletReady ? copy.switchNetwork : !ready ? !protocol || publicError ? copy.unavailable : copy.poolUnavailable : !valid ? copy.enterAmount : (liveQuote.isFetching || debouncedAmount !== amount) ? copy.quoting : quote && !quote.enabled ? copy.insufficient : copy.review}
    </Button>
    <div className="app-swap-foot"><span>ETH / RAREFRIENDS{publicError && protocol ? copy.priceUnavailable : protocol?.prices.usdStale ? copy.cachedPrice : ""}</span></div>
  </div>
  <Link href="/portfolio" className="app-preview-link">{copy.portfolioLink}</Link>
  </div>;
}
