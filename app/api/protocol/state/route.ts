import { getAddress, isAddress } from "viem";
import { apiFailure, chainContext, ProtocolError, sameOrigin } from "@/src/server/protocol/config";
import { readProtocolSnapshot, readWalletPortfolioState } from "@/src/server/protocol/wallet-read";
import { readProtocolState } from "@/src/server/protocol/state";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    sameOrigin(request);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => key !== "address") || query.getAll("address").length > 1) throw new ProtocolError("Invalid state query.");
    const address = query.get("address");
    if (address !== null && !isAddress(address)) throw new ProtocolError("Invalid wallet address.");
    const wallet = address ? getAddress(address) : undefined;
    const context = await chainContext();
    // Anvil reads its local event history; production uses the bounded snapshot and NFT index.
    const state = context.local ? await readProtocolState(wallet, context)
      : wallet ? await readWalletPortfolioState(wallet, context) : await readProtocolSnapshot(context);
    return Response.json(state, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
