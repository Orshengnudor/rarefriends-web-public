import art from "./homepage-public-art.json";

type Specimen = keyof typeof art.specimens;

/** Static portrait from the canonical Generation artwork. */
export function GenerationPortrait({ specimen, size = 64 }: { specimen: Specimen; size?: number }) {
  return (
    <svg
      className="generation-portrait"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={art.specimens[specimen].walk.down.rest.path} fill="currentColor" />
    </svg>
  );
}

