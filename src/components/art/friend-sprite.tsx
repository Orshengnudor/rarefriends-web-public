import art from "@/src/components/art/homepage-public-art.json";
import { TokenArt } from "@/src/components/art/token-art";

/** Reuses the approved 16 × 16 onchain character pixels without changing the artwork. */
export function FriendSprite({ specimen = 1, size = 96 }: { specimen?: number; size?: number }) {
  const key = `cast-${String(specimen).padStart(2, "0")}` as keyof typeof art.specimens;
  const path = (art.specimens[key] ?? art.specimens["cast-01"]).walk.down.rest.path;
  return <svg className="app-sprite" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges"><path d={path} fill="currentColor" /></svg>;
}

export function TokenMark({ eth = false }: { eth?: boolean }) {
  return <span className={`app-token-mark${eth ? " app-token-mark-eth" : ""}`} data-rf={!eth} aria-hidden="true">
    {eth ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" shapeRendering="crispEdges"><path d="M11 1h2v4h2v4h2v4h2v2h-4v2H9v-2H5v-2h2V9h2V5h2zm-4 17h4v2h2v-2h4v2h-2v2h-2v2h-2v-2H9v-2H7z" /></svg> : <TokenArt />}
  </span>;
}
