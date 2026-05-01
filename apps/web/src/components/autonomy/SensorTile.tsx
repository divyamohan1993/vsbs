"use client";

// SensorTile — labelled scalar with a status under-line and an optional
// 60-tick sparkline beneath. Glass plate, serif numeric, mono unit, mono
// detail rows. The status line uses the canonical status colours so the
// page reads at a glance.

import { useMemo } from "react";
import { cn } from "../ui/cn";
import { GlassPanel, SpecLabel } from "../luxe";

export type SensorStatus = "ok" | "warn" | "fault" | "stale";

export interface SensorReading {
  channel: string;
  label: string;
  value: string;
  unit?: string;
  status: SensorStatus;
  detail?: { label: string; value: string }[];
  history?: number[];
}

const STATUS_LABEL: Record<SensorStatus, string> = {
  ok: "Healthy",
  warn: "Watch",
  fault: "Fault",
  stale: "Stale",
};

const STATUS_LINE: Record<SensorStatus, string> = {
  ok: "var(--color-emerald)",
  warn: "var(--color-amber)",
  fault: "var(--color-crimson)",
  stale: "var(--color-pearl-soft)",
};

interface SensorTileProps {
  reading: SensorReading;
  className?: string;
}

export function SensorTile({ reading, className }: SensorTileProps): React.JSX.Element {
  const sparkline = useMemo(() => buildSparkline(reading.history), [reading.history]);

  return (
    <GlassPanel
      as="article"
      role="status"
      aria-live="polite"
      aria-label={`${reading.label} ${reading.value}${reading.unit ?? ""} ${STATUS_LABEL[reading.status]}`}
      className={cn(
        "relative flex h-full flex-col gap-3 !p-5 rounded-[var(--radius-md)]",
        className,
      )}
    >
      <SpecLabel>{reading.label}</SpecLabel>
      <div className="flex items-baseline gap-2">
        <span className="luxe-spec-value text-[clamp(1.6rem,3.5vw,2rem)] tabular-nums">
          {reading.value}
        </span>
        {reading.unit ? (
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase text-pearl-soft">
            {reading.unit}
          </span>
        ) : null}
      </div>
      {sparkline ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
          className="h-8 w-full"
          style={{ opacity: 0.6 }}
        >
          <path
            d={sparkline}
            fill="none"
            stroke={STATUS_LINE[reading.status]}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {reading.detail ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[length:var(--text-caption)] text-pearl-soft">
          {reading.detail.map((d) => (
            <li key={d.label} className="flex items-baseline justify-between gap-2">
              <span className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                {d.label}
              </span>
              <span className="luxe-mono text-pearl tabular-nums">{d.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)]"
          style={{ color: STATUS_LINE[reading.status] }}
        >
          {STATUS_LABEL[reading.status]}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="absolute inset-x-5 bottom-2 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${STATUS_LINE[reading.status]}, transparent)`,
        }}
      />
    </GlassPanel>
  );
}

function buildSparkline(history?: number[]): string | null {
  if (!history || history.length < 2) return null;
  const cap = Math.min(60, history.length);
  const slice = history.slice(history.length - cap);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of slice) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const range = hi - lo || 1;
  const w = 120;
  const h = 32;
  const step = w / (slice.length - 1);
  let d = "";
  slice.forEach((v, i) => {
    const x = (i * step).toFixed(2);
    const norm = (v - lo) / range;
    const y = (h - norm * (h - 4) - 2).toFixed(2);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  });
  return d;
}
