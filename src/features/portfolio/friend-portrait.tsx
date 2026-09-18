import { GenesisPortrait } from "@/src/components/art/hero-face";
import { GenerationPortrait } from "@/src/components/art/generation-portrait";
import { PortfolioArtwork } from "./artwork";

const SPECIMENS = ["cast-01", "cast-02", "cast-03", "cast-05", "cast-06", "cast-07", "cast-08", "cast-14"] as const;

type FriendPortraitProps = {
  friend: { collection: string; portrait: number; id: number; imageUrl?: string };
  size?: number;
};

/** Portfolio rows, selected Friends, and wallet NFTs use the same artwork fallback. */
export function FriendPortrait({ friend, size = 96 }: FriendPortraitProps) {
  if (friend.imageUrl) return <PortfolioArtwork src={friend.imageUrl} width={size} height={size} alt="" unoptimized style={{ objectFit: "contain", imageRendering: "pixelated" }} />;
  return friend.collection === "Genesis"
    ? <GenesisPortrait portrait={friend.portrait + 1} tokenId={friend.id} size={size} unframed />
    : <GenerationPortrait specimen={SPECIMENS[friend.portrait % SPECIMENS.length]} size={size} />;
}
