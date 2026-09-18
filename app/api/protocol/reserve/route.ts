import { apiFailure, chainContext, ProtocolError } from "@/src/server/protocol/config";
import { readReserveStatus } from "@/src/lib/protocol/reserve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) throw new ProtocolError("The reserve status does not accept query parameters.");
    const context = await chainContext();
    const head = await context.client.getBlock();
    const state = await readReserveStatus(context, head.number);
    if ((await context.client.getBlock({ blockNumber: head.number })).hash !== head.hash) {
      throw new ProtocolError("The chain changed while reading the Reserve. Refresh to continue.", 409);
    }
    return Response.json(state, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
