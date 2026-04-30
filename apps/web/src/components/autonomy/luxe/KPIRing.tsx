"use client";

// KPIRing — circular gauge for prognostic-health components on the autonomy
// dashboard. The arc sweeps from 220deg to 320deg (clockwise) which gives the
// reading a 280-degree visual budget. A faint secondary arc behind shows the
// lower confidence bound (P10 normalised). The numeric value is rendered in
// the serif display family with a mono caption beneath.
//
// The component is presentational; the parent decides health and bound. It
// honours prefers-reduced-motion by skipping the entrance animation.

import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "../../../lib/motion";
import { cn } from "../../ui/cn";
import { SpecLabel } from "../../luxe";

export type KPIRingStatus = "ok" | "watch" | "alert" | "unsafe";

export interface KPIRingProps {
  label: string;
  value: number;
  lowerBound?: number;
  unit?: string;
  status: KPIRingStatus;
  /** Override the status caption beneath the ring. Pass null to hide it. */
  statusLabel?: string | null;
  caption?: string;
  size?: number;
  className?: string;
}

const STATUS_STROKE: Record<KPIRingStatus, string> = {
  ok: "var(--color-emerald)",
  watch: "var(--color-amber)",
  alert: "var(--color-copper)",
  unsafe: "var(--color-crimson)",
};

const STATUS_LABEL: Record<KPIRingStatus, string> = {
  ok: "Healthy",
  watch: "Watch",
  alert: "Service due",
  unsafe: "Unsafe",
};

// Open-bottom meter sweep. We start at 220deg (bottom-left), wrap clockwise
// through 0deg (top) and finish at 320deg (bottom-right), giving the value
// arc a 280deg visual budget.
const ARC_START_DEG = 220;
const ARC_SWEEP = 280;

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  // Draw the arc clockwise from startDeg to endDeg (sweep-flag 1).
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

export function KPIRing({
  label,
  value,
  lowerBound,
  unit,
  status,
  statusLabel,
  caption,
  size = 168,
  className,
}: KPIRingProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const [animatedValue, setAnimatedValue] = useState<number>(reduced ? clamp01(value) : 0);
  const ringId = useId();

  useEffect(() => {
    const target = clamp01(value);
    if (reduced) {
      setAnimatedValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const from = animatedValue;
    const duration = 720;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedValue(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // animatedValue intentionally excluded; we capture the previous as a base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);

  const cx = size / 2;
  const cy = size / 2;
  const ringR = size / 2 - 12;
  const trackPath = arcPath(cx, cy, ringR, ARC_START_DEG, ARC_START_DEG + ARC_SWEEP);
  const valueEnd = ARC_START_DEG + ARC_SWEEP * animatedValue;
  const valuePath: string | undefined = animatedValue > 0.001
    ? arcPath(cx, cy, ringR, ARC_START_DEG, valueEnd)
    : undefined;
  const lowerEnd = lowerBound !== undefined ? ARC_START_DEG + ARC_SWEEP * clamp01(lowerBound) : undefined;
  const lowerPath: string | undefined =
    lowerEnd !== undefined && clamp01(lowerBound ?? 0) > 0.001
      ? arcPath(cx, cy, ringR, ARC_START_DEG, lowerEnd)
      : undefined;
  const stroke = STATUS_STROKE[status];
  const valueText = `${Math.round(clamp01(value) * 100)}%`;
  const resolvedStatusLabel = statusLabel === undefined ? STATUS_LABEL[status] : statusLabel;
  const ariaText = `${label} ${valueText}, ${resolvedStatusLabel ?? STATUS_LABEL[status]}`;

  return (
    <figure className={cn("flex flex-col items-center gap-3", className)}>
      <SpecLabel className="text-center">{label}</SpecLabel>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamp01(value) * 100)}
        aria-valuetext={ariaText}
        aria-label={label}
        className="relative grid place-items-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
          className="absolute inset-0"
          style={{ "--ring-stroke": stroke } as React.CSSProperties}
        >
          <defs>
            <linearGradient id={`${ringId}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.95} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.65} />
            </linearGradient>
          </defs>
          <circle
            cx={cx}
            cy={cy}
            r={ringR + 6}
            fill="none"
            style={{ stroke: "var(--color-hairline)" }}
            strokeWidth={1}
          />
          <path
            d={trackPath}
            fill="none"
            style={{ stroke: "var(--color-hairline-strong)" }}
            strokeWidth={8}
            strokeLinecap="round"
          />
          {lowerPath ? (
            <path
              d={lowerPath}
              fill="none"
              style={{ stroke }}
              strokeOpacity={0.3}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ) : null}
          {valuePath ? (
            <path
              d={valuePath}
              fill="none"
              stroke={`url(#${ringId}-grad)`}
              strokeWidth={8}
              strokeLinecap="round"
              style={{
                filter: `drop-shadow(0 0 8px ${stroke})`,
              }}
            />
          ) : null}
        </svg>
        <div className="relative flex flex-col items-center justify-center gap-1">
          <span
            className="luxe-spec-value text-[clamp(1.6rem,4vw,2rem)] tabular-nums"
            style={{ lineHeight: 1 }}
          >
            {valueText}
          </span>
          {unit ? (
            <span className="luxe-mono text-[var(--text-caption)] uppercase text-pearl-soft">
              {unit}
            </span>
          ) : null}
        </div>
      </div>
      <figcaption className="flex flex-col items-center gap-1 text-center">
        {resolvedStatusLabel ? (
          <span
            className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-caps)]"
            style={{ color: stroke }}
          >
            {resolvedStatusLabel}
          </span>
        ) : null}
        {caption ? (
          <span className="text-pearl-soft text-[var(--text-small)] leading-[1.4] max-w-[200px]">
            {caption}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
