import { zeroAddress } from "viem";
import { apiFailure, chainContext, ProtocolError, sameOrigin } from "@/src/server/protocol/config";
import { prepareInput, prepareProtocol } from "@/src/lib/protocol/transactions";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    sameOrigin(request);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["address", "buy", "amount", "slippageBps", "payWith"].includes(key))) throw new ProtocolError("Invalid quote query.");
    if (!["true", "false"].includes(query.get("buy") ?? "")) throw new ProtocolError("Specify whether to buy or sell.");
    const input = prepareInput({ address: query.get("address") ?? zeroAddress, swap: { buy: query.get("buy") === "true", amount: query.get("amount"), slippageBps: Number(query.get("slippageBps") ?? "50"), ...(query.has("payWith") ? { payWith: query.get("payWith") } : {}) } });
    return Response.json(await prepareProtocol(input, await chainContext()), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
