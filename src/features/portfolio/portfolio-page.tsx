"use client";

import { useRef, useState } from "react";
import { portfolioContent as copy } from "@/src/content/portfolio";
import { Button } from "@/src/components/ui/button";
import { Icon } from "@/src/components/ui/icon";
import { groupDigits } from "@/src/lib/format";
import { usePublicWallet } from "@/src/wallet/wallet-provider";
import {
  actionQuote, friendWeight,
  friendWallet, RF_SYMBOL, type PortfolioAction, type PortfolioFriend,
  type ProtocolAccount,
} from "../protocol/model";
import { useProtocol } from "../protocol/protocol-provider";
import { useUsdFormat } from "../protocol/use-usd-format";
import { FriendPortrait } from "./friend-portrait";
import { FriendPanel } from "./friend-panel";
import { FriendCapacity } from "./friend-capacity";
import { PortfolioSummary } from "./reward-overview";


function tokens(value: number) {
  const [whole, fraction] = value.toFixed(2).split(".");
  return `${groupDigits(Number(whole))}${fraction === "00" ? "" : `.${fraction}`}`;
}

export function Portfolio() {
  const { account, snapshot, loading, error } = useProtocol();
  const { address } = usePublicWallet();
  const [earningFilter, setEarningFilter] = useState<"all" | "not-earning" | "earning">("all");
  const [selectedKey, setSelectedKey] = useState<string | null>();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const walletColumnRef = useRef<HTMLElement>(null);
  const friendButtonRef = useRef<HTMLElement>(null);
  const friends = account?.friends ?? [];
  const dormant = friends.filter(friend => friendWeight(friend) === 0).sort((a, b) => Number(a.hardwired) - Number(b.hardwired));
  const earning = friends.filter(friend => friendWeight(friend) > 0);
  const defaultFriend = (earningFilter === "earning" ? earning[0] : dormant[0] ?? earning[0]) ?? null;
  const selectedFriend = selectedKey === undefined ? defaultFriend : friends.find(friend => friendKey(friend) === selectedKey) ?? null;
  const hasDetails = Boolean(account && selectedFriend);
  const emptyFriends = loading ? copy.loadingFriends : account ? copy.noFriends : address ? copy.unavailable : copy.disconnected;

  function selectFriend(friend: PortfolioFriend) {
    friendButtonRef.current = document.activeElement as HTMLElement;
    setSelectedKey(friendKey(friend));
    if (walletColumnRef.current) walletColumnRef.current.scrollTop = 0;
    if (window.matchMedia("(max-width: 1000px)").matches) {
      requestAnimationFrame(() => {
        workspaceRef.current?.scrollIntoView({ block: "start" });
        walletColumnRef.current?.querySelector<HTMLButtonElement>(".app-fp-back")?.focus({ preventScroll: true });
      });
    } else {
      requestAnimationFrame(() => {
        const top = walletColumnRef.current?.getBoundingClientRect().top ?? 0;
        if (top < 0) window.scrollBy(0, top - 16);
      });
    }
  }

  function closeFriend() {
    setSelectedKey(null);
    requestAnimationFrame(() => friendButtonRef.current?.focus({ preventScroll: true }));
  }

  function filterEarning(value: "all" | "not-earning" | "earning") {
    setEarningFilter(value);
    setSelectedKey(undefined);
  }

  function keepSelectedFriend() {
    if (selectedFriend && selectedKey === undefined) setSelectedKey(friendKey(selectedFriend));
  }


  return <div className="app-portfolio app-portfolio-workspace">
    <div className="app-pf-heading">
      <div className="app-pf-heading-title"><h1>{copy.title}</h1></div>
      <div className="app-pf-heading-actions"><Button href={snapshot && !snapshot.protocol.marketReady ? "/launch" : "/"} variant="primary" icon="plus">{copy.buyTokens}</Button></div>
    </div>

    {error && <p className="app-chain-status" role="status">{error}</p>}
    <div className="app-pf-workspace" ref={workspaceRef} data-has-detail={hasDetails || undefined} data-mobile-detail={Boolean(account && selectedFriend && selectedKey) || undefined}>
      <div className="app-pf-main-column">
        <PortfolioSummary account={account} earningFilter={earningFilter} onFilter={filterEarning} />
        <section className="app-pf-collection app-pf-friends-workspace" aria-label="Your Rare Friends">
          {account && friends.length > 0 ? <>
            {earningFilter !== "earning" && <FriendGroup earning={false} friends={dormant} account={account} selectedFriend={selectedFriend} onSelect={selectFriend} />}
            {earningFilter !== "not-earning" && <FriendGroup earning friends={earning} account={account} selectedFriend={selectedFriend} onSelect={selectFriend} />}
            {earningFilter !== "all" && <button type="button" className="app-pf-reset-filters" onClick={() => filterEarning("all")}>{copy.showAll}</button>}
          </> : <div className="app-pf-group-empty">{emptyFriends}</div>}
        </section>
      </div>
      {hasDetails && <aside ref={walletColumnRef} className="app-pf-wallet-column" aria-label="Selected friend wallet" onPointerDown={keepSelectedFriend} onFocusCapture={keepSelectedFriend}>
        <FriendPanel key={friendKey(selectedFriend!)} friend={selectedFriend} account={account} onClose={closeFriend} />
      </aside>}
    </div>
  </div>;
}

function friendKey(friend: PortfolioFriend) { return `${friend.collection}-${friend.id}`; }

function FriendGroup({ earning, friends, account, selectedFriend, onSelect }: {
  earning: boolean; friends: PortfolioFriend[]; account: ProtocolAccount; selectedFriend: PortfolioFriend | null;
  onSelect: (friend: PortfolioFriend) => void;
}) {
  return <section className="app-pf-friend-group" data-earning={earning || undefined} aria-label={earning ? "Earning friends" : "Inactive friends"}>
    <div className="app-pf-group-heading"><h2><span className="app-pf-status-square" data-earning={earning || undefined} />{earning ? copy.earning : copy.inactive}<span className="app-pf-group-count">{friends.length}</span></h2></div>
    {friends.length ? <div className="app-pf-friend-list">{friends.map(friend => <FriendRow key={friendKey(friend)} friend={friend} account={account} selected={Boolean(selectedFriend && friendKey(friend) === friendKey(selectedFriend))} onClick={() => onSelect(friend)} />)}</div>
      : <div className="app-pf-group-empty">{earning ? copy.noEarning : copy.noInactive}</div>}
  </section>;
}

function FriendRow({ friend, account, selected, onClick }: { friend: PortfolioFriend; account: ProtocolAccount; selected: boolean; onClick: () => void }) {
  const usd = useUsdFormat();
  const earning = friendWeight(friend) > 0;
  const temporary = !friend.hardwired;
  const fixedGenesis = account.rewardAccounting === "friend" && friend.collection === "Genesis";
  const kind: PortfolioAction["kind"] = temporary ? "hardwire" : !earning ? "activate" : fixedGenesis ? "claim" : friend.tier < 4 ? "upgrade" : friend.collection === "Generations" && friend.generation > 1 ? "promote" : "claim";
  const quote = actionQuote(account, { kind, friendId: friend.id, collection: friend.collection });
  const wallet = friendWallet(friend);
  const generationLabel = friend.collection === "Genesis" ? "Genesis" : temporary ? "Temp" : `Gen-${friend.generation}`;
  return <div className="app-pf-friend-row" data-collection={friend.collection} data-earning={earning || undefined} data-selected={selected || undefined}>
    <button type="button" className="app-pf-row-open" aria-pressed={selected} aria-label={`View ${friend.collection} #${friend.id} wallet, ${temporary ? "temporary" : generationLabel}, ${earning ? "earning" : "not earning"}`} onClick={onClick}>
      <span className="app-pf-row-generation"><span>{generationLabel}</span></span>
      <span className="app-pf-row-art" data-collection={friend.collection}><FriendPortrait friend={friend} size={64} /></span>
      <span className="app-pf-row-identity">
        <strong>{friend.collection} <span>#{friend.id}</span></strong>
        {!earning && <span>{temporary ? copy.temporary : copy.notActivated}</span>}
        {wallet
          ? <span className="app-pf-row-wallet"><Icon name="wallet" size={12} />{usd(wallet.totalUsd)}</span>
          : <small>{copy.noWallet}</small>}
      </span>
    </button>
    <FriendCapacity friend={friend} />
    <button type="button" className="app-pf-row-action" onClick={onClick} aria-label={`${kind === "claim" ? "View" : kind} ${friend.collection} #${friend.id}`}>
      <strong>{kind === "claim" ? copy.viewWallet : kind}<Icon name="arrow-right" size={12} /></strong>
      {kind !== "upgrade" && !(kind === "claim" && friend.collection === "Genesis") && <span>{kind === "claim" ? copy.fullyUpgraded : `${tokens(quote.cost)} ${RF_SYMBOL}`}</span>}
      {earning && <small>{tokens(friendWeight(friend))} {copy.rewardWeight}</small>}
    </button>
  </div>;
}
