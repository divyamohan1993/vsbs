// Hero — full-bleed layout primitive. Combines the aurora underlay (already
// fixed under <body>), an optional image backdrop with a CSS gradient
// fallback, an ambient glow, and a content slot.
//
// Image is referenced by filename only; the component does not import next/image
// because we cannot guarantee the file is present until the user generates it
// via Nano Banana 2 Pro. The background uses --hero-bg / --hero-bg-portrait
// custom properties so the entire declaration sits in globals.css and never
// touches inline <style>. CSP-clean.

import type { CSSProperties, ReactNode } from "react";
import { cn } from "../ui/cn";
import { AmbientGlow } from "./AmbientGlow";

export interface HeroProps {
  image?: string;
  imagePortrait?: string;
  alignment?: "left" | "centre";
  height?: "auto" | "tall" | "viewport";
  className?: string;
  children: ReactNode;
}

const HEIGHTS: Record<NonNullable<HeroProps["height"]>, string> = {
  auto: "py-[80px] md:py-[120px]",
  tall: "min-h-[640px] py-[80px] md:py-[160px]",
  viewport: "min-h-[100dvh] py-[80px] md:py-[160px]",
};

export function Hero({
  image,
  imagePortrait,
  alignment = "left",
  height = "tall",
  className,
  children,
}: HeroProps): React.JSX.Element {
  const desktopUrl = image ? `url("/images/${image}")` : "none";
  const portraitUrl = imagePortrait ? `url("/images/${imagePortrait}")` : desktopUrl;
  const style = {
    "--hero-bg": desktopUrl,
    "--hero-bg-portrait": portraitUrl,
  } as CSSProperties;
  return (
    <section
      className={cn(
        "luxe-hero relative isolate overflow-hidden rounded-[var(--radius-xl)]",
        HEIGHTS[height],
        "px-6 md:px-12",
        className,
      )}
      style={style}
    >
      <AmbientGlow tone="sky" className="!inset-[-30%_auto_auto_-10%]" />
      <AmbientGlow
        tone="copper"
        className="!inset-[auto_-10%_-30%_auto] !w-[50%] !h-[50%]"
      />
      <div
        className={cn(
          "relative z-10 mx-auto flex h-full max-w-[1180px] flex-col justify-end gap-8",
          alignment === "centre" && "items-center text-center",
        )}
      >
        {children}
      </div>
    </section>
  );
}
