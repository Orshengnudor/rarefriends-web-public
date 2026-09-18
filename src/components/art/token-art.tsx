import Image from "next/image";

/** The supplied $RAREFRIENDS coin artwork; adjacent text supplies its label. */
export function TokenArt({ size = 32 }: { size?: number }) {
  return <Image src="/art/token.svg" alt="" aria-hidden="true" width={size} height={size} unoptimized loading="eager"
    style={{ display: "block", maxWidth: "100%", height: "auto", imageRendering: "pixelated" }} />;
}
