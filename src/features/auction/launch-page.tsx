"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, zeroAddress, type Address, type Hex } from "viem";
import { TokenArt } from "@/src/components/art/token-art";
import { Button } from "@/src/components/ui/button";
import { shortAddress } from "@/src/lib/format";
import { ccaBidAction, ccaBidStatus, ccaPhase } from "@/src/lib/cca-lifecycle";
import { usePublicWallet } from "@/src/wallet/wallet-provider";
import { useOpenWalletDialog } from "@/src/wallet/wallet-dialog-context";
import { TokenMark } from "../../components/art/friend-sprite";
import { useProtocol } from "../protocol/protocol-provider";
import { LaunchCountdown } from "./countdown";
import { useCachedEthUsdPrice } from "../protocol/use-cached-eth-price";
import { useLaunchAuction } from "./use-auction";
import { protocolDisplayQueryKeys } from "../protocol/query-policy";
import { launchMarketCapSlider, launchSliderPosition, launchSliderPrice } from "./market-cap";
import { auctionBiddingClosed } from "./ui-policy";
import { GenesisMarketCard } from "./genesis-market-card";
import { PriceChart } from "./price-chart";
import { auctionContent as copy } from "@/src/content/auction";
import { siteContent } from "@/src/content/site";
import {
  Q96, launchAmount, launchError, launchImpliedValue, launchPriceInput,
  settleLaunchBid, submitLaunchBid, switchLaunchChain,
  type LaunchConfig, type LaunchState,
} from "./chain";

type Review = ({ kind: "bid"; amount: bigint; price: bigint } | { kind: "settle"; bidId: bigint }) & { owner: Address; session: number; auction: string };

function amountLabel(value: bigint, decimals: number, digits = 6) {
  const number = Number(formatUnits(value, decimals));
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function priceLabel(value: bigint, state: LaunchState) {
  const number = Number(launchPriceInput(value, state));
  return number.toLocaleString("en-US", { maximumSignificantDigits: 7 });
}

function visibleReadError(message: string) {
  // RPC nodes can briefly lag behind the confirmed block. Keep read guards active.
  return /\bBlock at number ["']?[\d,]+["']? could not be found\b/i.test(message) ? "" : message;
}

function marketCapLabel(price: bigint, state: LaunchState, currencyUsd: number | null) {
  const value = launchImpliedValue(price, state);
  if (currencyUsd === null) return "USD unavailable";
  const dollars = Number(formatUnits(value, state.currencyDecimals)) * currencyUsd;
  if (!Number.isFinite(dollars)) return "—";
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
}

function MarketCapComparison({ limit, state, currencyUsd }: { limit: bigint | null; state: LaunchState; currencyUsd: number | null }) {
  return <div className="app-launch-cap-comparison" aria-live="polite">
    <span>implied market cap</span>
    <div><span>at your limit</span><strong>{limit === null ? "—" : marketCapLabel(limit, state, currencyUsd)}</strong></div>
    <div><span>at clearing price</span><strong>{marketCapLabel(state.price, state, currencyUsd)}</strong></div>
    {limit !== null && <small>limit rounded to {priceLabel(limit, state)} {state.currencySymbol} per token</small>}
  </div>;
}

function EstimatedTokenAmount({ amount, limit, state }: { amount: string; limit: bigint | null; state: LaunchState | null }) {
  const belowClearing = !!state && limit !== null && limit < state.price;
  let estimatedTokens: bigint | null = null;
  if (state && limit !== null && limit > 0n) {
    try {
      // A full fill at the selected maximum price, rounded down to whole tokens.
      estimatedTokens = launchAmount(amount, state.currencyDecimals) * Q96 / limit / 10n ** BigInt(state.tokenDecimals);
    } catch { /* An unfinished or invalid bid amount has no estimate yet. */ }
  }
  return <div className="app-launch-price-comparison app-launch-token-estimate" data-below-clearing={belowClearing}>
    <div><strong aria-live="polite"><span>{estimatedTokens === null ? "—" : estimatedTokens.toLocaleString("en-US")}</span><span>$RAREFRIENDS</span></strong><small>estimated token amount if bid is fully successful</small></div>
    <span className="app-launch-price-warning" aria-live="polite">{belowClearing && <span role="img" aria-label="Selected price is below the current clearing price">!</span>}</span>
  </div>;
}

export function LaunchPage({ config: suppliedConfig }: { config?: LaunchConfig | null }) {
  const wallet = usePublicWallet();
  const queryClient = useQueryClient();
  const { config: economyConfig, error: economyError } = useProtocol();
  const cachedEthPrice = useCachedEthUsdPrice();
  const openWallet = useOpenWalletDialog();
  const supplied = suppliedConfig === undefined ? economyConfig?.launch ?? null : suppliedConfig;
  const { chainId, chainName, rpcUrl, explorerUrl, auctionAddress, auctionDeploymentBlock, tokenAddress } = supplied ?? {};
  // Unrelated portfolio/config refreshes must not start another auction read.
  const config = useMemo<LaunchConfig | null>(() => chainId === undefined || !chainName || !rpcUrl || !auctionAddress || !auctionDeploymentBlock || !tokenAddress
    ? null : { chainId, chainName, rpcUrl, explorerUrl, auctionAddress, auctionDeploymentBlock, tokenAddress },
  [chainId, chainName, rpcUrl, explorerUrl, auctionAddress, auctionDeploymentBlock, tokenAddress]);
  const biddingClosed = auctionBiddingClosed(config?.chainId ?? economyConfig?.chainId);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedLimit, setSelectedLimit] = useState<{ auction: string; value: bigint } | null>(null);
  const [draftReview, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hex>();
  const transactionBusy = useRef(false);
  const pageMounted = useRef(false);
  useEffect(() => {
    pageMounted.current = true;
    return () => { pageMounted.current = false; };
  }, []);
  const address = wallet.address as Address | undefined;
  const { snapshot: auctionSnapshot, details, refresh, accountError, bidsLoading } = useLaunchAuction(config, wallet, true, busy);
  const wrongChain = !!config && !!wallet.chainId && Number(BigInt(wallet.chainId)) !== config.chainId;
  const walletStatus = !address ? "disconnected" : !wallet.chainId || wrongChain ? "wrong-chain" : undefined;
  const canRead = !walletStatus;
  const auction = config ? `${config.chainId}:${config.rpcUrl}:${config.auctionAddress.toLowerCase()}` : "";
  const state = canRead ? details.data ?? null : null;
  const review = draftReview?.owner === address && draftReview?.session === wallet.getSession() && draftReview.auction === auction
    && !(biddingClosed && draftReview.kind === "bid") ? draftReview : null;
  const reading = auctionSnapshot.isFetching || details.isFetching;
  async function refreshAuction(afterAction = false) {
    if (!config || !canRead || !pageMounted.current) return;
    if (!afterAction && reading) return;
    await refresh();
  }

  const phase = state ? ccaPhase(state) : null;
  const claimsAction = state?.bids.some(bid => ccaBidAction(bid, state) === "claim") ? copy.completed.claimsAction
    : state?.bids.some(bid => ccaBidAction(bid, state)) ? copy.completed.settleAction : copy.completed.bidsAction;
  const active = phase === "live";
  const ended = !!state && state.block >= state.end;
  const failed = phase === "refunds";
  const configLoading = suppliedConfig === undefined && !economyConfig && !economyError;
  const readError = ((canRead) && (auctionSnapshot.error || details.error) ? launchError(auctionSnapshot.error || details.error) : "")
    || (!config && !configLoading ? economyError || "No auction is configured." : "");
  const stale = !!readError;
  const readErrorText = visibleReadError(readError);
  const accountErrorText = accountError ? visibleReadError(launchError(accountError)) : "";
  const status = biddingClosed ? copy.completed.status : stale ? "auction reads unavailable" : phase ? copy.phases[phase]
    : walletStatus === "disconnected" ? "connect wallet for live data"
      : walletStatus === "wrong-chain" ? "switch wallet network" : "connecting";
  const visibleStatus = status === "auction live" ? "" : status;
  const biddingEnabled = !biddingClosed && active && !stale && state?.validationHook === zeroAddress;
  const currentBid = review?.kind === "settle" ? state?.bids.find(bid => bid.id === review.bidId) : undefined;
  const settlementAction = currentBid && state ? ccaBidAction(currentBid, state) : null;
  const settlementSyncing = bidsLoading && !!address && !busy && !wrongChain && !stale;
  const reviewEnabled = !!address && !wrongChain && !stale
    && (review?.kind === "bid" ? biddingEnabled && !!state && review.price > state.price : !bidsLoading && !!settlementAction);
  const confirmLabel = review?.kind === "bid" ? "confirm bid"
    : settlementAction === "claim" ? "claim tokens" : failed ? "get refund" : "settle bid";
  const bidHeading = ended ? "Auction ended" : phase === "sold-out" ? "Auction sold out" : "Place a bid";
  const needsApproval = review?.kind === "bid" && state && state.currency !== zeroAddress && state.allowance < review.amount;
  const ethCurrency = state && (state.currency === zeroAddress || (config?.chainId === economyConfig?.chainId
    && state.currency.toLowerCase() === economyConfig?.contracts.WETH?.toLowerCase()));
  const ethUsd = cachedEthPrice?.ethUsd;
  const currencyUsd = ethCurrency && cachedEthPrice?.usdAvailable && ethUsd && Number.isFinite(ethUsd) && ethUsd > 0 ? ethUsd : null;
  const slider = state && currencyUsd !== null ? launchMarketCapSlider(state, currencyUsd) : null;
  // Keep the chosen contract price stable as the auction data and USD quote refresh.
  const limitPreview = selectedLimit?.auction === auction ? selectedLimit.value : slider?.defaultPrice ?? null;
  const bidButtonLabel = active && !stale
    ? state && slider && limitPreview !== null && limitPreview < state.price ? "market cap below clearing" : "review bid"
    : stale ? "auction unavailable" : !state ? "loading auction" : ended ? "auction ended"
      : phase === "sold-out" ? "auction sold out" : phase === "unfunded" ? "awaiting tokens" : "bidding opens soon";
  const sliderPosition = slider && limitPreview !== null ? launchSliderPosition(limitPreview, slider) : 0;
  const validLimit = !!state && !!slider && limitPreview !== null && state.tick > 0n
    && limitPreview > state.price && limitPreview >= state.floor
    && limitPreview <= state.maxBidPrice && limitPreview % state.tick === 0n;
  const selectedMarketCap = state && limitPreview !== null ? marketCapLabel(limitPreview, state, currencyUsd) : "—";

  function prepareBid() {
    if (biddingClosed || !state || !address || !biddingEnabled || !validLimit || limitPreview === null || wrongChain || busy) return;
    setError("");
    try {
      const parsedAmount = launchAmount(amount, state.currencyDecimals);
      if (state.balance === null) throw new Error("Your wallet balance is unavailable. Refresh before reviewing a bid.");
      if (parsedAmount > state.balance) throw new Error(`You do not have enough ${state.currencySymbol}.`);
      setReview({ kind: "bid", amount: parsedAmount, price: limitPreview, owner: address, session: wallet.getSession(), auction });
    } catch (failure) { setError(launchError(failure)); }
  }

  async function confirm() {
    if (!config || !address || !review || transactionBusy.current || (biddingClosed && review.kind === "bid")) return;
    if (!reviewEnabled) {
      setError("The auction state changed. Refresh and review the available action.");
      return;
    }
    transactionBusy.current = true;
    setBusy(true);
    setError("");
    setHash(undefined);
    const capturedReview = review;
    const update = (text: string, transactionHash?: Hex) => { setMessage(text); if (transactionHash) setHash(transactionHash); };
    try {
      const signer = { address, chainId: wallet.chainId, request: wallet.request, session: capturedReview.session, getSession: wallet.getSession };
      const hashes = capturedReview.kind === "bid"
        ? await submitLaunchBid(config, signer, capturedReview.amount, capturedReview.price, update,
          state?.ticks.filter(tick => tick < capturedReview.price).at(-1))
        : await settleLaunchBid(config, signer, capturedReview.bidId, update);
      if (hashes.length) setHash(hashes.at(-1));
      setMessage(capturedReview.kind === "bid" ? "Bid confirmed." : "Bid updated. Check its current status below.");
      setReview(null);
      if (capturedReview.kind === "bid") setAmount("");
    } catch (failure) {
      setError(launchError(failure));
      setMessage("");
    } finally {
      // Display refreshes must never keep a completed or failed action locked.
      transactionBusy.current = false;
      setBusy(false);
      // An exit/refund may confirm before a later claim is declined. Invalidate
      // holdings even after partial completion, without waking other pages.
      void Promise.resolve().then(async () => {
        await Promise.all(protocolDisplayQueryKeys.map(queryKey => queryClient.invalidateQueries({ queryKey, refetchType: "none" })));
        await refreshAuction(true);
      }).catch(() => { /* Preserve the transaction outcome; read errors appear on the auction. */ });
    }
  }

  async function switchChain() {
    if (!config || !address) return;
    setError("");
    try { await switchLaunchChain(config, { address, request: wallet.request }); }
    catch (failure) { setError(launchError(failure)); }
  }

  return <div className="app-launch">
    <div className="app-launch-heading">
      <div><span className="app-launch-kicker">{config?.chainName ?? "auction & claims"}{visibleStatus && ` · ${visibleStatus}`}</span><h1>{biddingClosed ? copy.title : copy.biddingTitle}</h1><p>{biddingClosed ? copy.introduction.completed : copy.introduction.bidding}</p></div>
      <div className="app-launch-token" aria-hidden><TokenArt size={128} /></div>
    </div>

    <div className="app-launch-valuations" aria-label="Token valuation, supply and auction status">
      <div className="app-launch-market-cap">
        <span>{biddingClosed ? copy.completed.marketCapLabel : "implied market cap"}</span>
        <strong>{biddingClosed ? copy.marketCapAtClose : state ? marketCapLabel(state.price, state, currencyUsd) : "—"}</strong>
        <small>{biddingClosed ? "USD" : currencyUsd !== null ? "USD estimate · at the clearing price" : "cached ETH/USD price required"}</small>
      </div>
      <div className="app-launch-price"><span>{biddingClosed ? copy.completed.priceLabel : "current clearing price"}</span><strong>{state ? priceLabel(state.price, state) : "—"}</strong><small>{state?.currencySymbol ?? "ETH"} per $RAREFRIENDS</small></div>
      <div className="app-launch-total-supply"><span>total supply</span><strong title={state ? formatUnits(state.tokenSupply, state.tokenDecimals) : undefined}>{state ? amountLabel(state.tokenSupply, state.tokenDecimals, 3) : "—"}</strong><small>deflationary</small></div>
      <LaunchCountdown state={canRead ? auctionSnapshot.data ?? null : null} chainId={config?.chainId ?? economyConfig?.chainId} loading={configLoading || (!!config && (canRead) && !auctionSnapshot.data && !stale)} error={!!auctionSnapshot.error} walletStatus={walletStatus} />
      {!biddingClosed && <p className="app-launch-valuation-basis">clearing price × total supply{stale && state ? <span>last successful read · block {state.block.toLocaleString("en-US")}</span> : currencyUsd !== null && <span>cached ETH/USD {currencyUsd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}{cachedEthPrice?.usdStale ? " · last known price" : ""}</span>}</p>}
    </div>

    <div className="app-launch-grid">
      <section className="app-launch-auction" aria-labelledby="app-launch-auction-title">
        <div className="app-launch-auction-top"><h2 id="app-launch-auction-title"><TokenMark /> $RAREFRIENDS</h2>{visibleStatus && <span className="app-launch-status" data-live={!biddingClosed && active || undefined}>{visibleStatus}</span>}</div>
        {biddingClosed && <PriceChart />}
        <dl className="app-launch-stats">
          <div><dt title="Current currency balance held by the auction contract">eth in contract</dt><dd>{state?.contractBalance !== undefined ? amountLabel(state.contractBalance, state.currencyDecimals) : "—"}<small>settled outbids flow out</small></dd></div>
          <div><dt>auction allocation</dt><dd>{state ? amountLabel(state.supply, state.tokenDecimals, 0) : "—"}<small>$RAREFRIENDS</small></dd></div>
        </dl>
        <div className="app-launch-blocks"><span>{failed ? "auction minimum not reached · full refunds" : state ? `calculated at block ${state.block}` : "auction data unavailable"}</span>{state && !failed && <span>{biddingClosed ? `claim block ${state.claim.toString()}` : `claims open at block ${state.claim.toString()}`}</span>}</div>
        {state && <details className="app-launch-settings">
          <summary>auction settings</summary>
          <dl>
            <div><dt>minimum raise</dt><dd>{state.minimumRaise === null ? "unavailable" : `${amountLabel(state.minimumRaise, state.currencyDecimals)} ${state.currencySymbol}`}</dd></div>
            <div><dt>floor price</dt><dd>{priceLabel(state.floor, state)} {state.currencySymbol} per RF</dd></div>
            <div><dt>contract address</dt><dd>{config?.auctionAddress ?? "unavailable"}</dd></div>
            <div><dt>price tick</dt><dd>{priceLabel(state.tick, state)} {state.currencySymbol} per RF</dd></div>
            <div><dt>bid currency</dt><dd>{state.currency === zeroAddress ? "native ETH" : state.currencySymbol}</dd></div>
            <div><dt>protocol fees</dt><dd>{state.protocolFeesEnabled === null ? "unavailable" : state.protocolFeesEnabled ? "enabled" : "none"}</dd></div>
            <div><dt>auction tokens</dt><dd>{state.funded ? "funded and notified" : "funding not notified"}</dd></div>
            <div><dt>start block</dt><dd>{state.start.toLocaleString("en-US")}</dd></div>
            <div><dt>end block</dt><dd>{state.end.toLocaleString("en-US")}</dd></div>
            <div><dt>claim block</dt><dd>{state.claim.toLocaleString("en-US")}</dd></div>
          </dl>
        </details>}
        {readErrorText && <div className="app-launch-error" role="alert">Auction reads are unavailable. {readErrorText}</div>}
      </section>

      <div className="app-launch-sidebar">
      <aside id="app-launch-bid" className="app-launch-bid" aria-label={biddingClosed ? "Token claims and existing bids" : undefined} aria-labelledby={biddingClosed ? undefined : "app-launch-bid-title"}>
        {!biddingClosed && <div className="app-launch-bid-heading"><h2 id="app-launch-bid-title">{bidHeading}</h2><span>Uniswap continuous clearing auction</span></div>}
        {accountErrorText && <p className="app-launch-bid-note" role="status">{accountErrorText}</p>}
        {review ? <div className="app-launch-review">
          <h3>{review.kind === "bid" ? "Review your bid" : `Your bid #${review.bidId}`}</h3>
          {review.kind === "bid" && state ? <>
            <dl><div><dt>you commit</dt><dd>{amountLabel(review.amount, state.currencyDecimals)} {state.currencySymbol}</dd></div><div><dt>maximum per token</dt><dd>{priceLabel(review.price, state)} {state.currencySymbol}</dd></div><div><dt>tokens received</dt><dd>determined by the auction</dd></div><div><dt>recipient</dt><dd>{address ? shortAddress(address) : "connect wallet"}</dd></div></dl>
            <MarketCapComparison limit={review.price} state={state} currencyUsd={currencyUsd} />
            <p>{copy.bid.review}</p>
            {needsApproval && <p>First approve {amountLabel(review.amount, state.currencyDecimals)} {state.currencySymbol}, then submit your bid. Your wallet will request two confirmations.</p>}
          </> : state && currentBid ? <>
            <dl><div><dt>bid amount</dt><dd>{amountLabel(currentBid.amount, state.currencyDecimals)} {state.currencySymbol}</dd></div><div><dt>purchased tokens</dt><dd>{currentBid.exitedBlock > 0n ? `${amountLabel(currentBid.purchased, state.tokenDecimals)} $RAREFRIENDS` : "calculated on settlement"}</dd></div><div><dt>recipient</dt><dd>{address ? shortAddress(address) : "connect wallet"}</dd></div></dl>
            <p>{failed ? copy.bid.refund : currentBid.exitedBlock > 0n ? copy.bid.claim : copy.bid.settlement}</p>
            {!failed && (state.block >= state.claim ? <p>{copy.bid.finalClaim}</p> : biddingClosed ? <p>{copy.bid.claimUnavailable}</p> : <p>Purchased tokens can be claimed from block {state.claim.toString()}.</p>)}
          </> : null}
          <div className="app-launch-review-actions"><Button disabled={busy} onClick={() => { setReview(null); setError(""); }}>back</Button><Button variant="primary" className={review.kind === "settle" && settlementSyncing && settlementAction ? "app-launch-settlement-syncing" : undefined} loading={busy} disabled={!reviewEnabled} onClick={() => void confirm()}>{confirmLabel}</Button></div>
        </div> : biddingClosed ? <div className="app-launch-claims" role="status">
          <p>{copy.completed.claimsTitle}</p>
          <p className="app-launch-claims-detail">{!address ? copy.completed.connect : copy.completed.connected}</p>
          {!address ? <Button block size="lg" variant="primary" onClick={openWallet}>{siteContent.wallet.connect}</Button>
            : wrongChain ? <Button block size="lg" variant="primary" onClick={() => void switchChain()}>switch to {config?.chainName}</Button>
            : <Button block size="lg" variant="primary" onClick={() => document.getElementById("app-launch-my-bids")?.scrollIntoView({ block: "start" })}>{claimsAction}</Button>}
        </div> : <form onSubmit={event => { event.preventDefault(); prepareBid(); }}>
          <div className="app-launch-cap-input">
            <label htmlFor="app-launch-market-cap">maximum market cap <span>USD</span></label>
            <output htmlFor="app-launch-market-cap">{selectedMarketCap}</output>
            <input id="app-launch-market-cap" aria-label="Market cap" type="range" min={0} max={slider?.steps || 1} step={1}
              value={sliderPosition} aria-valuetext={`${selectedMarketCap} market cap`} aria-describedby="app-launch-market-cap-range"
              disabled={busy || !slider || slider.steps === 0}
              style={{ "--launch-slider-progress": `${slider?.steps ? sliderPosition / slider.steps * 100 : 0}%` } as CSSProperties}
              onChange={event => { if (slider) { setSelectedLimit({ auction, value: launchSliderPrice(Number(event.target.value), slider) }); setError(""); } }} />
            <div id="app-launch-market-cap-range" className="app-launch-cap-range">
              <span>{state ? `${launchPriceInput(state.price, state)} ${state.currencySymbol} per RF clearing price` : "clearing price —"}</span>
              <span>{state && slider ? marketCapLabel(slider.maxPrice, state, currencyUsd) : "—"}</span>
            </div>
            {!slider && <small>{!state ? "loading auction…" : currencyUsd === null ? "USD price unavailable" : "market cap unavailable"}</small>}
          </div>
          <label className="app-launch-input"><span>bid amount</span><div><input aria-label="Bid amount" inputMode="decimal" placeholder="0" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /><strong>{state?.currencySymbol ?? "ETH"}</strong></div><small>balance {state?.balance !== null && state?.balance !== undefined ? amountLabel(state.balance, state.currencyDecimals) : "—"} {state?.currencySymbol ?? "ETH"}</small></label>
          <EstimatedTokenAmount amount={amount} limit={limitPreview} state={state} />
          {!address ? <Button block size="lg" variant="primary" onClick={openWallet}>{siteContent.wallet.connect}</Button> : wrongChain ? <Button block size="lg" variant="primary" onClick={() => void switchChain()}>switch to {config?.chainName}</Button> : <Button type="submit" block size="lg" variant="primary" disabled={!biddingEnabled || !amount || !validLimit || busy}>{bidButtonLabel}</Button>}
          {state?.validationHook !== undefined && state.validationHook !== zeroAddress && <p className="app-launch-bid-note">{copy.bid.eligibilityUnavailable}</p>}
          <span className="app-launch-commitment">{copy.bid.commitment}</span>
        </form>}
        {(message || error) && <div className="app-launch-feedback"><p role={error ? "alert" : "status"}>{error || message}</p>{hash && (config?.explorerUrl ? <a href={`${config.explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">[ view transaction ↗ ]</a> : <span title={hash}>transaction {shortAddress(hash)}</span>)}</div>}
      </aside>
      <GenesisMarketCard />
      </div>
    </div>

    <section className="app-launch-my-bids" id="app-launch-my-bids" aria-labelledby="app-launch-my-bids-title">
      <div className="app-launch-section-title"><h2 id="app-launch-my-bids-title">Your bids</h2><span>{state?.bids.length ?? 0} bids</span></div>
      {!address || !state?.bids.length ? <div className="app-launch-empty"><p>{!address ? copy.bid.connect : bidsLoading ? copy.bid.loading : !state ? copy.bid.unavailable : copy.bid.empty}</p></div> : <div className="app-launch-bid-list">
        {state.bids.map(bid => <article key={bid.id.toString()} className="app-launch-bid-row">
          <div><strong>bid #{bid.id.toString()}</strong><span>{biddingClosed && state.block < state.end ? copy.bid.checkingEligibility : ccaBidStatus(bid, state)}</span></div>
          <div><span>committed</span><strong>{amountLabel(bid.amount, state.currencyDecimals)} {state.currencySymbol}</strong></div>
          <div><span>maximum price</span><strong>{priceLabel(bid.maxPrice, state)} {state.currencySymbol}</strong><small>{marketCapLabel(bid.maxPrice, state, currencyUsd)} implied cap</small></div>
          <div><span>{bid.exitedBlock > 0n ? "purchased" : "allocation"}</span><strong>{bid.exitedBlock > 0n ? `${amountLabel(bid.purchased, state.tokenDecimals)} RF` : "settles on exit"}</strong>{bid.refunded > 0n && <small>{amountLabel(bid.refunded, state.currencyDecimals)} {state.currencySymbol} refunded</small>}</div>
          <Button className={settlementSyncing && ccaBidAction(bid, state) ? "app-launch-settlement-syncing" : undefined} disabled={busy || wrongChain || stale || bidsLoading || !ccaBidAction(bid, state)} onClick={() => { setReview({ kind: "settle", bidId: bid.id, owner: address, session: wallet.getSession(), auction }); setError(""); document.getElementById("app-launch-bid")?.scrollIntoView({ block: "center" }); }}>{bid.exitedBlock > 0n ? bid.claimed ? "claimed" : bid.tokensFilled === 0n ? "settled" : state.block < state.claim ? biddingClosed ? copy.bid.claimUnavailableLabel : "claims open soon" : "claim tokens" : failed ? "get refund" : "settle bid"}</Button>
        </article>)}
      </div>}
    </section>

    <section className="app-launch-how" aria-label="How the auction works">
      <div><h3>{biddingClosed ? copy.howItWorks.existingTitle : copy.howItWorks.chooseTitle}</h3><p>{biddingClosed ? copy.howItWorks.final : copy.howItWorks.bidding}</p></div>
      <div><h3>{copy.howItWorks.allocation.title}</h3><p>{biddingClosed ? copy.howItWorks.allocation.completed : copy.howItWorks.allocation.description}</p></div>
      <div><h3>{copy.howItWorks.settlement.title}</h3><p>{biddingClosed ? copy.howItWorks.settlement.completed : copy.howItWorks.settlement.description}</p></div>
    </section>
    <div className="app-launch-details"><span>{config ? `${config.chainName} · auction ${config.auctionAddress}` : "auction configuration unavailable"}</span><a href={copy.documentation.href} target="_blank" rel="noreferrer">{copy.documentation.label}</a></div>
  </div>;
}
