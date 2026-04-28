"use client";

import { cn } from "../ui/cn";

export type SensorStatus = "ok" | "warn" | "fault" | "stale";

export interface SensorReading {
  channel: string;
  label: string;
  value: string;
  unit?: string;
  status: SensorStatus;
  /** Optional sub-readings (e.g. four wheels for TPMS). */
  detail?: { label: string; value: string }[];
}

const STATUS_CLASS: Record<SensorStatus, string> = {
  ok: "text-success",
  warn: "text-accent",
  fault: "text-danger",
  stale: "text-muted",
};

const STATUS_LABEL: Record<SensorStatus, string> = {
  ok: "Healthy",
  warn: "Watch",
  fault: "Fault",
  stale: "Stale",
};

export function SensorTile({ reading, className }: { reading: SensorReading; className?: string }): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${reading.label} ${reading.value}${reading.unit ?? ""} ${STATUS_LABEL[reading.status]}`}
      className={cn(
        "flex flex-col gap-1 rounded-[var(--radius-card)] border border-muted/30 p-3",
        className,
      )}
      style={{ backgroundColor: "oklch(20% 0.02 260)" }}
    >
      <p className="text-xs uppercase tracking-wide text-muted">{reading.label}</p>
      <p className="font-display text-2xl font-semibold text-on-surface">
        {reading.value}
        {reading.unit ? <span className="ml-1 text-base text-muted">{reading.unit}</span> : null}
      </p>
      <p className={cn("text-xs font-semibold", STATUS_CLASS[reading.status])}>{STATUS_LABEL[reading.status]}</p>
      {reading.detail ? (
        <ul className="mt-1 grid grid-cols-2 gap-1 text-xs text-muted">
          {reading.detail.map((d) => (
            <li key={d.label} className="flex justify-between">
              <span>{d.label}</span>
              <span className="font-mono text-on-surface">{d.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
