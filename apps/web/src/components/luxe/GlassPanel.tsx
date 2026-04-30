// GlassPanel — the canonical raised surface. Variants control depth.
//
// default  : the standard card. Used everywhere a chunk of content needs a
//            quiet container.
// elevated : dialogs, drawers, top-of-stack surfaces.
// muted    : ambient panels (footers, sidebars) that should recede.

import type { HTMLAttributes } from "react";
import { cn } from "../ui/cn";

export interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "muted";
  interactive?: boolean;
  as?: "div" | "section" | "article" | "aside";
}

export function GlassPanel({
  variant = "default",
  interactive = false,
  as = "div",
  className,
  children,
  ...rest
}: GlassPanelProps): React.JSX.Element {
  const Tag = as;
  const surface =
    variant === "elevated"
      ? "luxe-glass-elevated"
      : variant === "muted"
        ? "luxe-glass-muted"
        : "luxe-glass";
  return (
    <Tag
      className={cn(
        surface,
        "rounded-[var(--radius-lg)] p-6",
        interactive && "luxe-card-edge",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
