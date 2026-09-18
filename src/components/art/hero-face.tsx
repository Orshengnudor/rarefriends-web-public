import type { CSSProperties, ReactNode } from "react";
import art from "./genesis-public-art.json";

type FaceProps = { size?: number; portrait?: number };

function GenesisFaceArt({ size, portrait, framed = false }: { size: number; portrait: number; framed?: boolean }) {
  const face = art.portraits[portrait - 1] ?? art.portraits[0];
  return (
    <span
      className="rf-art hero-face"
      data-theme="invert"
      data-portrait={face.id}
      style={{ width: framed ? "100%" : size, height: framed ? "100%" : size }}
      title="Rare Friends Genesis"
    >
      <svg
        viewBox={`0 0 ${face.grid} ${face.grid}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        aria-hidden
        focusable="false"
      >
        <path d={face.path} fill="currentColor" />
      </svg>
    </span>
  );
}

type GenesisPortraitProps = FaceProps & {
  /** An explicit NFT label; never derive this number from the artwork selector. */
  tokenId?: string | number | bigint;
  className?: string;
  /** Small, square gallery mount without a collection caption. */
  compact?: boolean;
  /** The landing hero places the bare portrait above its animated scene. */
  unframed?: boolean;
  artOverlay?: ReactNode;
};

/** The portrait selector identifies artwork, never an NFT's onchain token number. */
export function GenesisPortrait({
  size = 256,
  portrait = 1,
  tokenId,
  className,
  compact = false,
  unframed = false,
  artOverlay,
}: GenesisPortraitProps) {
  const face = art.portraits[portrait - 1] ?? art.portraits[0];
  const number = tokenId === undefined ? undefined : String(tokenId).trim() || undefined;
  const variant = compact || size < 96 ? (size <= 48 ? "tiny" : "small") : size >= 224 ? "hero" : "medium";
  const isSmall = variant === "small" || variant === "tiny";

  return (
    <span
      className={["genesis-portrait", className].filter(Boolean).join(" ")}
      data-size={variant}
      data-frame={unframed ? "none" : undefined}
      data-compact={compact || undefined}
      data-portrait={face.id}
      data-token-id={number}
      role="group"
      aria-label={number === undefined ? "Rare Friends Genesis portrait" : `Rare Friends Genesis #${number}`}
      style={{ "--genesis-base-art-size": `${size}px` } as CSSProperties}
    >
      <span className="genesis-portrait-art">
        <GenesisFaceArt size={size} portrait={face.id} framed />
        {artOverlay != null && <span className="genesis-portrait-overlay">{artOverlay}</span>}
      </span>
      {!compact && !unframed && (
        <span className="genesis-portrait-caption">
          {!isSmall && <span className="genesis-portrait-kicker">rare friends</span>}
          <span className="genesis-portrait-title">Genesis{number !== undefined && <> <span className="genesis-portrait-number">#{number}</span></>}</span>
        </span>
      )}
    </span>
  );
}
