"use client";

import { useId, useRef, useState } from "react";
import { portfolioContent as copy } from "@/src/content/portfolio";
import { FriendPortrait } from "./friend-portrait";
import { TokenArt } from "@/src/components/art/token-art";
import { formatUnits } from "viem";
import { Button } from "@/src/components/ui/button";
import { Icon } from "@/src/components/ui/icon";
import { groupDigits } from "@/src/lib/format";
import {
  actionQuote, friendWallet, friendWeight, hardwireGeneration, scheduledFriendWeight, RF_SYMBOL,
  type PortfolioAction, type PortfolioFriend, type ProtocolAccount, type WalletAsset,
} from "../protocol/model";
import { useProtocol } from "../protocol/protocol-provider";
import { useUsdFormat } from "../protocol/use-usd-format";
import { ActionReview } from "../protocol/action-review";

type FriendPanelProps = {
  friend: PortfolioFriend | null;
  account: ProtocolAccount | null;
  onClose: () => void;
};


function number(value: number, precision = 2) {
  const [whole, fraction] = value.toFixed(precision).split(".");
  const decimal = fraction?.replace(/0+$/, "");
  return `${groupDigits(Number(whole))}${decimal ? `.${decimal}` : ""}`;
}

function walletAsset(symbol: string): WalletAsset | null {
  if (symbol === RF_SYMBOL || symbol === "RF") return "RF";
  return symbol === "WETH" || symbol === "ETH" ? symbol : null;
}

/** Weight changes are projections of the selected contract action. */
function weightAfter(account: ProtocolAccount, friend: PortfolioFriend, action: PortfolioAction) {
  const quote = actionQuote(account, action);
  if (!quote.enabled && quote.cost === 0) return null;
  const next = { ...friend, activated: true, hardwired: true };
  switch (action.kind) {
    case "hardwire": {
      const generation = hardwireGeneration(account.tokenBalance);
      if (generation === null) return null;
      next.generation = generation;
      next.tier = 0;
      break;
    }
    case "activate": next.tier = 0; break;
    case "upgrade": next.tier++; break;
    case "promote": next.generation--; next.tier = 0; break;
    default: return null;
  }
  return scheduledFriendWeight(next, account.rewardAccounting ?? "holder");
}

export function FriendPanel({ friend, account, onClose }: FriendPanelProps) {
<<<<<<< HEAD
  const { busy, executeAction, snapshot, publicSnapshot, publicError, error: snapshotError } = useProtocol();
=======
  const { executeAction, busy, snapshot, publicSnapshot, publicError, error: snapshotError } = useProtocol();
>>>>>>> upstream/main
  const usd = useUsdFormat();
  const [chosenKind, setChosenKind] = useState<"activate" | "upgrade" | "promote" | null>(null);
  const [review, setReview] = useState<PortfolioAction | null>(null);
  const [walletTab, setWalletTab] = useState<"tokens" | "NFTs">("tokens");
  const [selectedNft, setSelectedNft] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [notice, setNotice] = useState("");
  const addressRef = useRef<HTMLInputElement>(null);
  const panelId = useId();

  if (!friend || !account) return null;

  const temporary = friend.collection === "Generations" && !friend.hardwired;
  const earning = friend.hardwired && friend.activated;
  const friendRewards = account.rewardAccounting === "friend";
  const fixedGenesis = friendRewards && friend.collection === "Genesis";
  const wallet = friendWallet(friend);
  const canPromote = friend.collection === "Generations" && friend.hardwired && friend.generation > 1;
  const fullyGrown = earning && (fixedGenesis || friend.tier >= 4 && !canPromote);
  const nextKind: PortfolioAction["kind"] = temporary ? "hardwire"
    : chosenKind === "promote" && canPromote ? "promote"
    : !earning ? "activate"
    : friend.tier >= 4 && canPromote ? "promote" : "upgrade";
  const action: PortfolioAction = { kind: nextKind, friendId: friend.id, collection: friend.collection };
  const quote = actionQuote(account, action);
  const before = friendWeight(friend);
  const after = weightAfter(account, friend, action);
  const conversionQuote = actionQuote(account, { kind: "convert", friendId: friend.id, collection: friend.collection });
  const reserve = publicSnapshot?.protocol.reserve ?? snapshot?.protocol.reserve;
  const reserveError = publicSnapshot ? publicError : snapshotError;
  const conversionCost = reserve ? Number(formatUnits(BigInt(reserve.conversionFee), reserve.rfDecimals)) : conversionQuote.cost;
  // Display balances are floating-point; the live review checks the exact RF fee in bigint.
  const conversionReady = Boolean(reserve?.conversionAvailable && !reserveError);
  const converted = { ...conversionQuote, cost: conversionCost,
    receive: reserve ? Number(formatUnits(BigInt(reserve.conversionPayout), reserve.rfDecimals)) : conversionQuote.receive,
    enabled: conversionReady,
    reason: reserveError || !reserve ? copy.friend.reserveUnavailable : reserve.conversionReasons.join(" ") || undefined,
  };
  const heldNft = wallet?.nfts.find((nft) => `${nft.collection}-${nft.id}` === selectedNft);
  const extraNeeded = Math.max(0, quote.cost - account.tokenBalance);

  async function copyAddress() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopyStatus(copy.friend.copied);
    } catch {
      addressRef.current?.focus();
      addressRef.current?.select();
      setCopyStatus(copy.friend.selectedAddress);
    }
  }

  function choose(kind: "activate" | "upgrade" | "promote") {
    setChosenKind(kind);
    setReview(null);
    setNotice("");
  }

  function startReview(action: PortfolioAction) {
    setReview(action);
    setNotice("");
  }

  const reviewBlock = review && <ActionReview key={`${review.kind}:${review.asset ?? "RF"}`} action={review} account={account}
    onBack={() => setReview(null)} onDone={() => { setReview(null); setNotice(copy.friend.confirmed); }} />;

  const rewardSection = friendRewards && !temporary && <section className="app-fp-rewards" aria-labelledby={`${panelId}-rewards`}>
    <h3 id={`${panelId}-rewards`}>{copy.friend.rewards}</h3>
    <div className="app-fp-reward-list">{(["RF", "WETH"] as const).map(asset => {
      const amount = asset === "RF" ? friend.earnings : friend.earningsWeth ?? 0;
<<<<<<< HEAD
      return <div className="app-fp-reward-row" key={asset}><strong>{number(amount, asset === "RF" ? 3 : 6)} <span>{asset}</span></strong><Button size="sm" preserveCase disabled={busy || !wallet || amount <= 0} onClick={async () => { if (await executeAction({ kind: "claim", friendId: friend.id, collection: friend.collection, asset })) setNotice(copy.friend.confirmed); }}>claim {asset}</Button></div>;
=======
      return <div className="app-fp-reward-row" key={asset}><strong>{number(amount, asset === "RF" ? 3 : 6)} <span>{asset}</span></strong><Button size="sm" preserveCase disabled={busy || !wallet || amount <= 0} onClick={() => void executeAction({ kind: "claim", friendId: friend.id, collection: friend.collection, asset })}>claim {asset}</Button></div>;
>>>>>>> upstream/main
    })}</div>
  </section>;

  const spendSection = <section className="app-fp-spend" aria-labelledby={`${panelId}-spend`}>
      <h3 id={`${panelId}-spend`}>{fullyGrown ? copy.friend.maximumWeight : copy.rewardWeight}</h3>

      {!fullyGrown && <>
      {canPromote && <div className="app-fp-action-options" aria-label="Choose how to increase reward weight"><button type="button" aria-pressed={nextKind === (earning ? "upgrade" : "activate")} disabled={busy || earning && friend.tier >= 4} onClick={() => choose(earning ? "upgrade" : "activate")}>{earning ? friend.tier >= 4 ? copy.fullyUpgraded : copy.friend.upgrade : "activate"}</button><button type="button" aria-pressed={nextKind === "promote"} disabled={busy} onClick={() => choose("promote")}>{copy.friend.promote}</button></div>}

      {review && review.kind !== "convert" ? reviewBlock : <>
        <div className="app-fp-action-title"><strong>{quote.title}</strong><Icon name={nextKind === "hardwire" ? "lock" : "trending-up"} size={24} /></div>
        {after !== null && <div className="app-fp-weight-change"><div><span>{copy.friend.currentWeight}</span><strong>{number(before, 6)}</strong></div><Icon name="arrow-right" size={24} /><div><span>after {nextKind}</span><strong>{number(after, 6)}</strong></div></div>}
        {nextKind === "promote" && <p className="app-fp-important">{copy.friend.promotionNote}</p>}
        <div className="app-fp-cost"><span>{copy.friend.tokenCost}</span><strong>{number(quote.cost, 4)}<small>{RF_SYMBOL}</small></strong></div>
        <Button block variant="primary" disabled={busy || !quote.enabled} onClick={() => {
          if (action.kind === "hardwire" || action.kind === "promote" || action.kind === "activate") {
            setReview(null);
            setNotice("");
            void executeAction(action);
          } else startReview(action);
        }}>{quote.title}</Button>
        {extraNeeded > 0 ? <div className="app-fp-shortfall"><p>shortfall: {number(extraNeeded, 4)} {RF_SYMBOL}</p><Button href={snapshot && !snapshot.protocol.marketReady ? "/launch" : "/"} size="sm" block>{copy.buyTokens}</Button></div>
          : !quote.enabled && quote.reason ? <p className="app-fp-note">{quote.reason}</p> : null}
        <details className="app-fp-action-explanation"><summary>{copy.friend.details}</summary><p>{quote.description}</p></details>
      </>}
      </>}
    </section>;

  const walletSection = <section className="app-fp-wallet" aria-label={copy.friend.address}>
      {wallet ? <>
        <div className="app-fp-address-label"><h3 className="app-fp-label">{copy.friend.address}</h3><button type="button" onClick={copyAddress} aria-label="Copy friend wallet address"><Icon name="copy" size={12} />{copy.friend.copy}</button></div>
        <input ref={addressRef} className="app-fp-address" type="text" readOnly value={wallet.address} aria-label="Friend wallet address" onClick={(event) => event.currentTarget.select()} spellCheck={false} />
        {copyStatus && <p className="app-fp-copy-status" role="status">{copyStatus}</p>}
        <div className="app-fp-wallet-value"><span className="app-fp-label">{copy.friend.balance}</span><strong>{usd(wallet.totalUsd)}</strong></div>

        <div className="app-fp-wallet-tabs" role="tablist" aria-label="Friend wallet holdings"><button type="button" role="tab" id={`${panelId}-tokens-tab`} aria-controls={`${panelId}-holdings`} aria-selected={walletTab === "tokens"} disabled={busy} onClick={() => setWalletTab("tokens")}>tokens <span>{wallet.tokens.length}</span></button><button type="button" role="tab" id={`${panelId}-nfts-tab`} aria-controls={`${panelId}-holdings`} aria-selected={walletTab === "NFTs"} disabled={busy} onClick={() => setWalletTab("NFTs")}>NFTs <span>{wallet.nfts.length}</span></button></div>
        <div id={`${panelId}-holdings`} role="tabpanel" aria-labelledby={`${panelId}-${walletTab === "tokens" ? "tokens" : "nfts"}-tab`}>
          {walletTab === "tokens" ? wallet.tokens.length ? <div className="app-fp-token-list">{wallet.tokens.map(token => {
            const asset = walletAsset(token.symbol);
            return <div className="app-fp-token-item" key={token.symbol}>
              <div className="app-fp-token"><span className="app-fp-token-icon" data-rf={walletAsset(token.symbol) === "RF"}>{walletAsset(token.symbol) === "RF" ? <TokenArt /> : <Icon name={token.symbol === "WETH" || token.symbol === "ETH" ? "coin" : "chart-bar"} size={24} />}</span><div><strong>{token.name}</strong><span>{token.symbol}</span></div><div className="app-fp-token-balance"><strong>{number(token.balance, token.symbol === "WETH" || token.symbol === "ETH" ? 5 : 3)}</strong><span>{usd(token.usd, token.symbol === "ETH" || token.symbol === "WETH" ? "ETH" : "RF")}</span></div>
                {asset && <Button size="sm" preserveCase className="app-fp-withdraw" disabled={busy || token.balance <= 0} onClick={() => void executeAction({ kind: "withdraw", friendId: friend.id, collection: friend.collection, asset })}>withdraw {asset}</Button>}
              </div>
            </div>;
          })}</div> : <p className="app-fp-holdings-empty">{copy.friend.noTokens}</p>
            : wallet.nfts.length ? <div className="app-fp-wallet-nfts">{wallet.nfts.map((nft) => <button type="button" className="app-fp-wallet-nft" key={`${nft.collection}-${nft.id}`} aria-expanded={selectedNft === `${nft.collection}-${nft.id}`} onClick={() => setSelectedNft(selectedNft === `${nft.collection}-${nft.id}` ? null : `${nft.collection}-${nft.id}`)}><span className="app-fp-held-art" data-collection={nft.collection}><FriendPortrait friend={nft} size={48} /></span><span><strong>{nft.name}</strong><span>{nft.collection} #{nft.id}</span></span><Icon name={selectedNft === `${nft.collection}-${nft.id}` ? "chevron-up" : "chevron-down"} size={12} /></button>)}
              {heldNft && <div className="app-fp-held-detail"><FriendPortrait friend={heldNft} size={80} /><div><strong>{heldNft.name}</strong><p>{heldNft.collection} #{heldNft.id}</p></div></div>}
            </div> : <p className="app-fp-holdings-empty">{copy.friend.noNfts}</p>}
        </div>
      </> : <div className="app-fp-no-wallet"><Icon name="lock" size={24} /><p>{copy.friend.notHardwired}</p><span>{copy.friend.walletRequirement}</span></div>}
    </section>;

  return <section className="app-fp" aria-labelledby={`${panelId}-title`}>
    <div className="app-fp-bar"><button type="button" className="app-fp-back" onClick={onClose}><Icon name="arrow-left" size={12} />{copy.friend.back}</button></div>

    <div className="app-fp-identity" data-collection={friend.collection}>
      <div className="app-fp-portrait" data-collection={friend.collection}><FriendPortrait friend={friend} size={80} /></div>
      <div className="app-fp-identity-copy">
        {temporary && <span className="app-fp-label">temporary</span>}
        <h2 id={`${panelId}-title`}>{friend.collection === "Generations" ? `${temporary ? "" : `Gen-${friend.generation} `}Generations #${friend.id}` : <>Genesis <span>#{friend.id}</span></>}</h2>
        <span className="app-fp-status" data-earning={earning}><span aria-hidden="true" />{earning ? copy.earning : copy.friend.notEarning}</span>
      </div>
    </div>

    <div className="app-fp-current-weight"><div><span className="app-fp-label">{copy.rewardWeight}</span><strong>{number(before, 6)}</strong></div>{!(earning && fixedGenesis) && <span className="app-fp-label">{earning ? `tier ${friend.tier} / 4` : temporary ? copy.friend.hardwireRequired : copy.friend.activationRequired}</span>}</div>
    {rewardSection}

    {notice && <p className="app-fp-success" role="status"><Icon name="check" size={12} />{notice}</p>}

    {!(earning && fixedGenesis) && spendSection}

    {walletSection}

    {friend.collection === "Genesis" && <section className="app-fp-convert" aria-labelledby={`${panelId}-convert`}><h3 id={`${panelId}-convert`}>{copy.friend.convert}</h3><div><dl className="app-fp-convert-values"><div><dt>receive</dt><dd>{number(converted.receive)} {RF_SYMBOL}</dd></div><div><dt>upfront fee</dt><dd>{number(converted.cost)} {RF_SYMBOL}</dd></div></dl>
      {review?.kind === "convert" ? reviewBlock : <><Button block size="sm" disabled={busy || !converted.enabled} onClick={() => startReview({ kind: "convert", friendId: friend.id, collection: friend.collection })}>{copy.friend.reviewConversion}</Button>{!converted.enabled && <p className="app-fp-note">{converted.reason}</p>}</>}
    </div></section>}
  </section>;
}
