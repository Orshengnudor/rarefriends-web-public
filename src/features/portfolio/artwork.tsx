"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";

const RETRY_DELAYS = [500, 1_500, 4_000] as const;
type Props = Omit<ImageProps, "onError" | "onLoad">;

function isStreamArtwork(src: ImageProps["src"]): src is string {
  if (typeof src !== "string") return false;
  try {
    const url = new URL(src);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      && /^\/art\/[a-f0-9]{64}\.(?:svg|png)$/.test(url.pathname);
  } catch { return false; }
}

/** Retries only cached stream artifacts; wallet data URIs retain their existing image behavior. */
export function PortfolioArtwork(props: Props) {
  return isStreamArtwork(props.src) ? <RetryArtwork key={props.src} {...props} /> : <Image {...props} alt={props.alt} />;
}

function RetryArtwork(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timeout.current); }, []);

  function failed() {
    if (timeout.current !== undefined) return;
    setWaiting(true);
    const delay = RETRY_DELAYS[attempt];
    if (delay === undefined) return;
    timeout.current = setTimeout(() => {
      timeout.current = undefined;
      setAttempt(attempt + 1);
      setWaiting(false);
    }, delay);
  }

  if (waiting) {
    const label = attempt < RETRY_DELAYS.length ? "loading artwork…" : "artwork unavailable";
    return <span className="app-portfolio-artwork-status" role="img" aria-label={props.alt ? `${props.alt}: ${label}` : label}
      style={{ display: "grid", placeItems: "center", width: props.width, height: props.height, maxWidth: "100%",
        padding: 4, boxSizing: "border-box", background: "var(--paper)", color: "var(--ink)",
        border: "1px dashed var(--ink)", textAlign: "center", overflowWrap: "anywhere", font: "10px/1.4 var(--font-mono)" }}>{label}</span>;
  }
  // Remount the exact immutable URL after a failed no-store response; no cache-busting RPC/query parameter.
  return <Image {...props} alt={props.alt} key={attempt} onError={failed} />;
}
