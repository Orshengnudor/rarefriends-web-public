import { readEthUsdPrice } from "@/src/server/protocol/prices";

export const dynamic = "force-dynamic";

/** Off-chain price data only: this route never connects to an Ethereum RPC. */
export async function GET() {
  return Response.json(await readEthUsdPrice(), { headers: { "cache-control": "no-store" } });
}
