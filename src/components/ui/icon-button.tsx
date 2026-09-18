"use client";


import type { MouseEventHandler } from "react";
import { Icon } from "./icon";
import type { Size, Variant } from "./types";

type IconButtonProps = {
  icon: string;
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
};

export function IconButton({
  icon,
  label,
  onClick,
  variant = "secondary",
  size = "md",
  disabled = false,
}: IconButtonProps) {
  return (
    <button
      className="rf-iconbtn"
      data-variant={variant}
      data-size={size}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={size === "lg" ? 24 : 12} />
    </button>
  );
}
