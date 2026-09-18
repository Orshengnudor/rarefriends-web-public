import { contractRead, ProtocolError, type ChainContext } from "./chain-context";

const MAX_METADATA_BYTES = 6_000_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_CACHE_BYTES = 24_000_000;
const MAX_CACHE_IMAGES = 64;
const images = new Map<string, { pending: Promise<string>; bytes: number }>();
let cachedBytes = 0;

function removeImage(key: string) {
  cachedBytes -= images.get(key)?.bytes ?? 0;
  images.delete(key);
}

function decodeDataUri(uri: string, expectedType: RegExp, maximumBytes: number) {
  if (uri.length > maximumBytes * 4 + 100) throw new ProtocolError("On-chain artwork is too large.", 502);
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri);
  if (!match || !expectedType.test(match[1])) throw new ProtocolError("Unsupported on-chain artwork format.", 502);
  let bytes: Uint8Array;
  try {
    bytes = match[2]
      ? Uint8Array.from(atob(match[3].replace(/[\r\n]/g, "")), character => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(match[3]));
  } catch { throw new ProtocolError("Invalid on-chain artwork data.", 502); }
  if (!bytes.length || bytes.length > maximumBytes) throw new ProtocolError("Invalid on-chain artwork size.", 502);
  return bytes;
}

/** Preserve the contract's embedded image; never fetch remote metadata or insert SVG into the DOM. */
export function decodeOnchainArtwork(uri: string): string {
  const bytes = decodeDataUri(uri, /^application\/json$/i, MAX_METADATA_BYTES);
  let metadata: unknown;
  try { metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ProtocolError("On-chain metadata is invalid.", 502); }
  const image = metadata && typeof metadata === "object" && !Array.isArray(metadata) && "image" in metadata ? metadata.image : undefined;
  if (typeof image !== "string") throw new ProtocolError("The NFT metadata has no image.", 502);
  decodeDataUri(image, /^image\/(?:svg\+xml|png)$/i, MAX_IMAGE_BYTES);
  return image;
}

/** A validated event revision allows reuse across blocks, never across wallet sessions or visual changes. */
export function readOnchainArtwork(context: ChainContext, collection: "Genesis" | "Generations", id: bigint, blockNumber: bigint, revision?: string): Promise<string> {
  const key = `${context.rpcUrl}:${context.chainId}:${context.manifest.contracts[collection].address.toLowerCase()}:${id}:${revision === undefined ? `block:${blockNumber}` : `revision:${revision}`}`;
  let cached = images.get(key);
  if (!cached) {
    const entry = { pending: contractRead<string>(context, collection, "tokenURI", [id], blockNumber).then(decodeOnchainArtwork), bytes: 0 };
    cached = entry;
    images.set(key, entry);
    void entry.pending.then(image => {
      if (images.get(key) !== entry) return;
      entry.bytes = image.length * 2;
      cachedBytes += entry.bytes;
      while (cachedBytes > MAX_CACHE_BYTES && images.size) removeImage(images.keys().next().value!);
    }, () => { if (images.get(key) === entry) removeImage(key); });
    while (images.size > MAX_CACHE_IMAGES) removeImage(images.keys().next().value!);
  } else {
    images.delete(key); images.set(key, cached);
  }
  return cached.pending;
}
