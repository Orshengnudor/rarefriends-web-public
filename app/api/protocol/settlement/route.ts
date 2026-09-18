import { apiFailure, chainContext, jsonBody, sameOrigin } from "@/src/server/protocol/config";
import { prepareSettlement } from "@/src/server/protocol/settlement";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    return Response.json(await prepareSettlement(await jsonBody(request, 4096), await chainContext()), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
