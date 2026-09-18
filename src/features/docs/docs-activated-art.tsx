"use client";

import { useEffect, useRef, useState } from "react";
import { docsContent } from "@/src/content/docs";
import { Button } from "@/src/components/ui/button";
import artwork from "./assets/activated-generations.json";

/** Native SVG animations from the on-chain renderer; no wallet or RPC required. */
export function ActivatedDocsArt() {
  const gallery = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const scenes = Array.from(gallery.current?.querySelectorAll<SVGSVGElement>('.investor-docs-active-scene[data-state="activated"] > svg') ?? []);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const visible = new Set<SVGSVGElement>(window.IntersectionObserver ? [] : scenes);

    function syncPlayback() {
      for (const scene of scenes) {
        const playing = !paused && !motion.matches && !document.hidden && visible.has(scene);
        if (playing) scene.unpauseAnimations();
        else scene.pauseAnimations();
        if (motion.matches) scene.setCurrentTime(0);
      }
    }

    const observer = window.IntersectionObserver ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        const scene = entry.target as SVGSVGElement;
        if (entry.isIntersecting) visible.add(scene);
        else visible.delete(scene);
      }
      syncPlayback();
    }) : null;
    scenes.forEach(scene => observer?.observe(scene));
    motion.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();

    return () => {
      observer?.disconnect();
      motion.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);
      scenes.forEach(scene => scene.pauseAnimations());
    };
  }, [paused]);

  return (
    <div className="investor-docs-active-art" ref={gallery} role="group" aria-label="The same Gen-1 Rare Friend, activated and inactive">
      <div className="investor-docs-active-grid">
        {artwork.examples.map(example => (
          <figure key={example.state}>
            {/* Trusted local renderer exports, with isolated IDs and no external content. */}
            <div className="investor-docs-active-scene" data-state={example.state} dangerouslySetInnerHTML={{ __html: example.svg }} />
            <figcaption>Gen-{example.generation}<span>{example.state} · fully on-chain</span></figcaption>
          </figure>
        ))}
      </div>
      <div className="investor-docs-art-controls">
        <Button size="sm" onClick={() => setPaused(value => !value)}>
          {paused ? docsContent.play : docsContent.pause}
        </Button>
      </div>
    </div>
  );
}
