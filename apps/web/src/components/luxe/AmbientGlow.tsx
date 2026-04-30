// AmbientGlow — a faint radial bloom you can position absolutely behind any
// hero element. Default placement is top-left; override with className.

import type { CSSProperties } from "react";
import { cn } from "../ui/cn";

export interface AmbientGlowProps {
  tone?: "sky" | "copper" | "emerald";
  className?: string;
  style?: CSSProperties;
}

export function AmbientGlow({ tone = "sky", className, style }: AmbientGlowProps): React.JSX.Element {
  const tones: Record<NonNullable<AmbientGlowProps["tone"]>, string> = {
    sky: "radial-gradient(circle at center, rgba(79, 183, 255, 0.20), transparent 60%)",
    copper: "radial-gradient(circle at center, rgba(201, 163, 106, 0.22), transparent 60%)",
    emerald: "radial-gradient(circle at center, rgba(31, 143, 102, 0.18), transparent 60%)",
  };
  return (
    <div
      aria-hidden="true"
      className={cn("luxe-glow", className)}
      style={{ backgroundImage: tones[tone], ...style }}
    />
  );
}
