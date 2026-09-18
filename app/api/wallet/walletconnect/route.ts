import { walletConnectProjectId } from "@/src/server/walletconnect-config";

export const dynamic = "force-dynamic";

/** A public project identifier, read at runtime; no deployment credentials are exposed. */
export function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (new URL(request.url).search) return Response.json({ error: "Invalid request." }, { status: 400, headers });
  return Response.json({ projectId: walletConnectProjectId() }, { headers });
}
