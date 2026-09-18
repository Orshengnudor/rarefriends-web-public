import { ANVIL } from "../../config/networks.ts";

/** Production bidding is closed. Only explicitly configured Anvil auctions accept new bids. */
export function auctionBiddingClosed(chainId?: number) {
  return chainId !== ANVIL.id;
}
