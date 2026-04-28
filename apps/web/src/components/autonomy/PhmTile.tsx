"use client";

import { cn } from "../ui/cn";

export type PhmSeverity = "healthy" | "monitor" | "service" | "critical";

export interface PhmTileProps {
  system: "engine" | "brake" | "electrical" | "hv-battery" | "tyres" | "sensors-health";
  rulP10Days: number;
  rulP90Days: number;
  severity: PhmSeverity;
  rationale: string;
}

const TITLES: Record<PhmTileProps["system"], string> = {
  engine: "Engine",
  brake: "Brakes",
  electrical: "12V electrical",
  "hv-battery": "HV battery",
  tyres: "Tyres",
  "sensors-health": "Sensor health",
};

const ICONS: Record<PhmTileProps["system"], string> = {
  engine: "🛢", // we'd swap for an inline svg, but tabular emojis are zero-cost
  brake: "▲",
  electrical: "⚡",
  "hv-battery": "🔋",
  tyres: "◯",
  "sensors-health": "📡",
};

const SEVERITY_BG: Record<PhmSeverity, string> = {
  healthy: "border-success",
  monitor: "border-accent",
  service: "border-accent",
  critical: "border-danger",
};

const SEVERITY_TEXT: Record<PhmSeverity, string> = {
  healthy: "text-success",
  monitor: "text-accent",
  service: "text-accent",
  critical: "text-danger",
};

const SEVERITY_LABEL: Record<PhmSeverity, string> = {
  healthy: "Healthy",
  monitor: "Monitor",
  service: "Service due",
  critical: "Critical",
};

export function PhmTile({ system, rulP10Days, rulP90Days, severity, rationale }: PhmTileProps): React.JSX.Element {
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-[var(--radius-card)] border-2 p-4",
        SEVERITY_BG[severity],
      )}
      style={{ backgroundColor: "oklch(20% 0.02 260)" }}
    >
      <header className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold">
          <span aria-hidden="true" className="mr-2">
            {ICONS[system]}
          </span>
          {TITLES[system]}
        </h3>
        <span className={cn("text-sm font-semibold", SEVERITY_TEXT[severity])}>
          {SEVERITY_LABEL[severity]}
        </span>
      </header>
      <p className="text-sm">
        Remaining useful life: <span className="font-mono">{rulP10Days}–{rulP90Days} days</span>{" "}
        <span className="text-xs text-muted">(P10/P90)</span>
      </p>
      <p className="text-xs text-muted">{rationale}</p>
    </article>
  );
}
