import { apiFailure, publicConfig } from "@/src/server/protocol/config";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return Response.json(await publicConfig(request), { headers: {
    // This is public deployment metadata, with no wallet or live chain reads.
    "cache-control": process.env.NODE_ENV === "production"
      ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
      : "no-store",
  } }); }
  catch (error) { return apiFailure(error); }
}
