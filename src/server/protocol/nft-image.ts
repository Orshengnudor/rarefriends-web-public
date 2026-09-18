import { chainContext, contractRead, ProtocolError } from "./config.ts";

export type NftImage = { bytes: Uint8Array<ArrayBuffer>; contentType: string };
const images = new Map<string, { expires: number; pending: Promise<NftImage> }>();

/** Read the NFT's actual tokenURI; no off-chain replacement artwork or remote fetch. */
export async function readNftImage(request: Request, dependencies: {
  getChainContext?: typeof chainContext;
} = {}): Promise<NftImage> {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !["collection", "id", "v"].includes(key))
    || [...new Set(query.keys())].some(key => query.getAll(key).length !== 1)) throw new ProtocolError("Invalid artwork query.");
  const collection = query.get("collection");
  const id = query.get("id") ?? "";
  const version = query.get("v") ?? "";
  if ((collection !== "Genesis" && collection !== "Generations") || !/^\d{1,15}$/.test(id)
    || !Number.isSafeInteger(Number(id)) || !/^[a-zA-Z0-9-]{0,80}$/.test(version)) throw new ProtocolError("Select a valid NFT.");
  const context = await (dependencies.getChainContext ?? chainContext)();
  const key = `${context.rpcUrl}:${context.chainId}:${context.manifest.contracts[collection].address}:${BigInt(id)}:${version}`;
  const existing = images.get(key);
  if (existing && existing.expires > Date.now()) return existing.pending;
  const pending = (async () => {
    const uri = await contractRead<string>(context, collection, "tokenURI", [BigInt(id)]);
    const prefix = "data:application/json;base64,";
    if (!uri.startsWith(prefix) || uri.length > 6_000_000) throw new ProtocolError("On-chain metadata is unavailable.", 502);
    const metadata: unknown = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
    const image = metadata && typeof metadata === "object" && "image" in metadata ? metadata.image : undefined;
    if (typeof image !== "string") throw new ProtocolError("The NFT metadata has no image.", 502);
    const match = /^data:(image\/(?:svg\+xml|png));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image);
    if (!match) throw new ProtocolError("Unsupported on-chain image format.", 502);
    const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
    if (!bytes.length || bytes.length > 4_000_000) throw new ProtocolError("Invalid on-chain image.", 502);
    return { bytes, contentType: match[1] };
  })();
  images.delete(key);
  images.set(key, { expires: Date.now() + 30_000, pending });
  while (images.size > 64) images.delete(images.keys().next().value!);
  pending.catch(() => { if (images.get(key)?.pending === pending) images.delete(key); });
  return pending;
}
