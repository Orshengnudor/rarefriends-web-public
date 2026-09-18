import { apiFailure } from "@/src/server/protocol/config";
import { readNftImage } from "@/src/server/protocol/nft-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const image = await readNftImage(request);
    return new Response(image.bytes, { headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return apiFailure(error); }
}
