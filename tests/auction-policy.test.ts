import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { ANVIL, ROBINHOOD_MAINNET } from "../src/config/networks.ts";
import productionAuction from "../src/config/production-cca.json" with { type: "json" };
import { auctionContent } from "../src/content/auction.ts";
import { auctionBiddingClosed } from "../src/features/auction/ui-policy.ts";
import type { LaunchCountdown as CountdownComponent } from "../src/features/auction/countdown.tsx";
import * as lifecycle from "../src/lib/cca-lifecycle.ts";
import { ccaBidAction, ccaPhase, type CcaBid, type CcaState } from "../src/lib/cca-lifecycle.ts";

const source = await readFile(new URL("../src/features/auction/countdown.tsx", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020, jsx: JsxEmit.ReactJSX } }).outputText;
const dependencies: Record<string, unknown> = {
  "react/jsx-runtime": jsxRuntime,
  "@/src/content/auction": { auctionContent },
  "@/src/lib/cca-lifecycle": lifecycle,
  "./ui-policy": { auctionBiddingClosed },
};
const componentModule = { exports: {} };
new Function("require", "exports", compiled)((name: string) => {
  assert.ok(name in dependencies, `Unexpected countdown dependency: ${name}`);
  return dependencies[name];
}, componentModule.exports);
const Countdown = (componentModule.exports as { LaunchCountdown: typeof CountdownComponent }).LaunchCountdown;
const renderCountdown = (props: Parameters<typeof CountdownComponent>[0]) => renderToStaticMarkup(createElement(Countdown, props));

test("production bidding stays closed while Anvil auctions can accept bids", () => {
  assert.equal(auctionBiddingClosed(ROBINHOOD_MAINNET.id), true);
  assert.equal(auctionBiddingClosed(undefined), true);
  assert.equal(auctionBiddingClosed(ANVIL.id), false);
  const anvilAuction: CcaState = { block: 20n, start: 10n, end: 30n, claim: 40n,
    price: 1n, funded: true, graduated: true, finalized: false };
  assert.equal(ccaPhase(anvilAuction), "live");
  const html = renderCountdown({ state: anvilAuction, chainId: ANVIL.id });
  assert.match(html, /role="timer"/);
  assert.match(html, /data-live="true"/);
  assert.match(html, /10 blocks/);
});

test("production settlement display is independent of connection, loading and stale block data", () => {
  const disconnected = renderCountdown({ state: null, chainId: ROBINHOOD_MAINNET.id, walletStatus: "disconnected" });
  assert.match(disconnected, /role="status"/);
  assert.doesNotMatch(disconnected, /role="timer"/);
  assert.equal(renderCountdown({ state: null, loading: true }), disconnected);
  assert.equal(renderCountdown({ state: null, chainId: ROBINHOOD_MAINNET.id, walletStatus: "wrong-chain", error: true }), disconnected);
  const staleAuction: CcaState = { block: 1n, start: 10n, end: 30n, claim: 40n,
    price: 1n, funded: false, graduated: false, finalized: false };
  assert.equal(renderCountdown({ state: staleAuction, chainId: ROBINHOOD_MAINNET.id }), disconnected);
  assert.notEqual(renderCountdown({ state: staleAuction, chainId: ANVIL.id }), disconnected);
});

test("closed production bidding preserves settlement and claim eligibility", () => {
  const auction: CcaState = { block: BigInt(productionAuction.settings.endBlock),
    start: BigInt(productionAuction.settings.startBlock), end: BigInt(productionAuction.settings.endBlock),
    claim: BigInt(productionAuction.settings.claimBlock), price: 2n, funded: true, graduated: true, finalized: false };
  const bid: CcaBid = { id: 1n, startBlock: auction.start, exitedBlock: 0n, maxPrice: 3n, tokensFilled: 10n, claimed: false };
  assert.equal(auctionBiddingClosed(ROBINHOOD_MAINNET.id), true);
  assert.equal(ccaPhase(auction), "settlement");
  assert.equal(ccaBidAction(bid, auction), "settle");
  const settled = { ...bid, exitedBlock: auction.end };
  assert.equal(ccaBidAction(settled, { ...auction, finalized: true, block: auction.claim - 1n }), null);
  assert.equal(ccaBidAction(settled, { ...auction, finalized: true, block: auction.claim }), "claim");
  assert.equal(ccaBidAction({ ...settled, claimed: true }, { ...auction, finalized: true, block: auction.claim }), null);
});
