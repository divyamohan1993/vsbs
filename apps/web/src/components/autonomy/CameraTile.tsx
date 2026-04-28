"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../../lib/motion";
import { cn } from "../ui/cn";

export type CameraQuadrant = "front" | "rear" | "left" | "right";

const TITLES: Record<CameraQuadrant, string> = {
  front: "Front camera",
  rear: "Rear camera",
  left: "Left camera",
  right: "Right camera",
};

interface CameraTileProps {
  quadrant: CameraQuadrant;
  label?: string;
  className?: string;
}

// Multi-camera tile. The sim driver renders a deterministic checker
// pattern that pulses between two phases (so the UI can be Lighthouse-
// audited without a live MJPEG feed). Reduced-motion swaps the canvas
// for a static placeholder.

export function CameraTile({ quadrant, label, className }: CameraTileProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      if (now - last >= 250) {
        last = now;
        setTick((t) => (t + 1) % 16);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "oklch(20% 0.02 260)";
    ctx.fillRect(0, 0, w, h);
    const cells = 16;
    const cw = w / cells;
    const ch = h / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const phase = ((x + y + tick) % 4) / 4;
        ctx.fillStyle = `oklch(${30 + phase * 10}% 0.04 ${quadrantHue(quadrant)})`;
        ctx.fillRect(x * cw, y * ch, cw - 1, ch - 1);
      }
    }
    ctx.strokeStyle = "oklch(74% 0.16 200)";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = "oklch(98% 0 0)";
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(TITLES[quadrant], 8, 8);
    ctx.textBaseline = "bottom";
    ctx.fillText("● LIVE (sim)", 8, h - 8);
  }, [quadrant, tick]);

  return (
    <figure
      className={cn(
        "relative aspect-video overflow-hidden rounded-[var(--radius-card)] border border-muted/30",
        className,
      )}
      style={{ backgroundColor: "oklch(18% 0.02 260)" }}
    >
      <canvas
        ref={ref}
        width={320}
        height={180}
        role="img"
        aria-label={label ?? TITLES[quadrant]}
        className="h-full w-full"
      />
      <figcaption className="absolute inset-x-0 bottom-0 px-2 py-1 text-xs text-muted">
        {label ?? TITLES[quadrant]}
      </figcaption>
    </figure>
  );
}

function quadrantHue(q: CameraQuadrant): number {
  switch (q) {
    case "front":
      return 200;
    case "rear":
      return 25;
    case "left":
      return 155;
    case "right":
      return 280;
  }
}

export function CameraGrid({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      <CameraTile quadrant="front" />
      <CameraTile quadrant="rear" />
      <CameraTile quadrant="left" />
      <CameraTile quadrant="right" />
    </div>
  );
}
