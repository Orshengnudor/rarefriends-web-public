"use client";


import { type CSSProperties, useSyncExternalStore } from "react";

const ICON_SIZES = { xs: 12, sm: 16, md: 24, lg: 36, xl: 48 } as const;

/* Mono stand-ins for a blocked icon host. Icon-only controls (the menu toggle, dialog close)
   are the whole navigation on a phone, so they must never render as an empty box — and a row of
   them must never render as the same box twice, which is what a table of eight names left behind.
   Every name the kits use has its own mark; a name outside the set still falls through to ▪. */
const ICON_TEXT: Record<string, string> = {
  /* navigation */
  menu: "≡",
  close: "✕",
  check: "✓",
  search: "⌕",
  sliders: "⇳",
  "more-horizontal": "⋯",
  "chevron-up": "▴",
  "chevron-down": "▾",
  "chevron-left": "◂",
  "chevron-right": "▸",
  "arrow-up": "↑",
  "arrow-down": "↓",
  "arrow-left": "←",
  "arrow-right": "→",
  "external-link": "↗",
  /* actions */
  copy: "⧉",
  share: "⋔",
  download: "⇩",
  upload: "⇧",
  reload: "↻",
  repeat: "⇄",
  power: "⏻",
  link: "∞",
  unlink: "⊗",
  /* objects */
  wallet: "▭",
  "device-phone": "▯",
  cpu: "▩",
  "qr-code": "▨",
  list: "▤",
  grid: "▦",
  "chart-bar": "▥",
  gift: "▣",
  coin: "¤",
  store: "⌂",
  inbox: "▽",
  mail: "✉",
  terminal: ">",
  /* state */
  zap: "↯",
  "radio-signal": "≈",
  key: "⊸",
  lock: "■",
  "lock-open": "□",
  shield: "◇",
  alert: "△",
  "info-box": "ⓘ",
  notification: "◉",
  clock: "◷",
  hourglass: "⧗",
  "trending-up": "▲",
  "trending-down": "▼",
  /* people and view */
  human: "○",
  users: "◎",
  sun: "☼",
  moon: "☾",
  "volume-3": "♪",
  "volume-x": "⊘",
  github: "⑂",
};

type IconSetState = "probing" | "ok" | "down";

let iconSet: IconSetState = "probing";
let iconProbed = false;
const iconWatchers = new Set<() => void>();

function probeIconSet() {
  if (iconProbed || typeof window === "undefined") return;
  iconProbed = true;
  const settle = (state: IconSetState) => {
    iconSet = state;
    iconWatchers.forEach((notify) => notify());
  };
  const probe = new window.Image();
  probe.onload = () => settle("ok");
  probe.onerror = () => settle("down");
  probe.src = `${Icon.CDN}check.svg`;
}

const watchIconSet = (notify: () => void) => {
  iconWatchers.add(notify);
  probeIconSet();
  return () => {
    iconWatchers.delete(notify);
  };
};

const readIconSet = () => iconSet;

const assumeIconSet = (): IconSetState => "probing";

type IconProps = {
  name: string;
  size?: keyof typeof ICON_SIZES | number;
  color?: string;
  label?: string;
  className?: string;
};

export function Icon({ name, size = "md", color, label, className = "" }: IconProps) {
  const px = typeof size === "number" ? size : ICON_SIZES[size];
  const set = useSyncExternalStore(watchIconSet, readIconSet, assumeIconSet);
  const a11y = {
    role: label ? "img" : undefined,
    "aria-label": label,
    "aria-hidden": label ? undefined : true,
  } as const;

  if (set === "down") {
    return (
      <span
        className={`rf-icon ${className}`.trim()}
        data-fallback="true"
        style={{ width: px, height: px, fontSize: Math.round(px * 0.75), color }}
        {...a11y}
      >
        {ICON_TEXT[name] ?? "▪"}
      </span>
    );
  }

  return (
    <span
      className={`rf-icon ${className}`.trim()}
      style={{ "--icon": `url("${Icon.CDN}${name}.svg")`, width: px, height: px, color } as CSSProperties}
      {...a11y}
    />
  );
}

/* Single seam for the icon set: self-host by dropping the svgs somewhere and repointing this. */
Icon.CDN = "https://api.iconify.design/pixelarticons/";
