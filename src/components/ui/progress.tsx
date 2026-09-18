"use client";


import type { ReactNode } from "react";

type ProgressProps = {
  "aria-label"?: string;
  "aria-valuetext"?: string;
  value?: number;
  blocks?: number;
  label?: ReactNode;
  meta?: ReactNode;
  size?: "md" | "lg";
  signal?: boolean;
  indeterminate?: boolean;
};

export function Progress({
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  value = 0,
  blocks = 16,
  label,
  meta,
  size = "md",
  signal = false,
  indeterminate = false,
}: ProgressProps) {
  const normalized = Math.min(1, Math.max(0, value));
  /* indeterminate has no amount to show — the stylesheet alternates the cells instead of filling them */
  const on = indeterminate ? 0 : Math.round(normalized * blocks);

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
      aria-valuetext={ariaValueText}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(normalized * 100)}
      className="rf-progress"
      data-size={size}
      data-signal={signal}
      data-indeterminate={indeterminate}
    >
      {label || meta ? (
        <div className="rf-progress-meta">
          <span>{label}</span>
          <span>{meta}</span>
        </div>
      ) : null}
      <div className="rf-progress-bar">
        {Array.from({ length: blocks }, (_, index) => (
          <span key={index} className="rf-progress-cell" data-on={index < on} />
        ))}
      </div>
    </div>
  );
}
