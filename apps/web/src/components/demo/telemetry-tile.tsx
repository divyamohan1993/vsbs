// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
"use client";

export type TelemetryTileTone = "neutral" | "watch" | "alert";

export interface TelemetryTileProps {
  label: string;
  value: string | number;
  unit?: string | undefined;
  tone?: TelemetryTileTone;
  caption?: string | undefined;
}

const TONE_BORDER: Record<TelemetryTileTone, string> = {
  neutral: "border-muted/40",
  watch: "border-[oklch(82%_0.16_85)]",
  alert: "border-danger",
};

export function TelemetryTile({
  label,
  value,
  unit,
  tone = "neutral",
  caption,
}: TelemetryTileProps): React.JSX.Element {
  const live = tone === "alert" ? "assertive" : "polite";
  return (
    <article
      role="status"
      aria-live={live}
      className={`flex flex-col rounded-[var(--radius-card)] border-2 bg-surface px-4 py-3 ${TONE_BORDER[tone]}`}
    >
      <div className="text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold text-on-surface tabular-nums">
          {value}
        </span>
        {unit ? <span className="text-sm text-muted">{unit}</span> : null}
      </div>
      {caption ? <div className="mt-1 text-sm text-on-surface">{caption}</div> : null}
    </article>
  );
}
