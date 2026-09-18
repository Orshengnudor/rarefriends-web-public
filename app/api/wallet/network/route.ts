import { apiFailure } from "@/src/server/protocol/config";
import { publicWalletNetwork } from "@/src/server/protocol/network";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return Response.json(await publicWalletNetwork(request),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) { return apiFailure(error); }
}
