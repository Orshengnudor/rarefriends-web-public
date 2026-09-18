import { apiFailure, chainContext, jsonBody, sameOrigin } from "@/src/server/protocol/config";
import { prepareInput, prepareProtocol } from "@/src/lib/protocol/transactions";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return Response.json(await prepareProtocol(prepareInput(await jsonBody(request, 8192)), await chainContext()), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
