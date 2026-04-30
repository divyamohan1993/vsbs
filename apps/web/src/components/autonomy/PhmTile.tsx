"use client";

// PhmTile — prognostic health summary for a single subsystem. The visual
// centerpiece is a KPIRing showing the P90 health (i.e. the optimistic
// remaining-life fraction); the inner P10 secondary arc shows the lower
// confidence bound. Below the ring, a serif RUL window in days, a one-line
// rationale, and a status caption.

import { cn } from "../ui/cn";
import { GlassPanel, SpecLabel } from "../luxe";
import { KPIRing, type KPIRingStatus } from "./luxe/KPIRing";

export type PhmSeverity = "healthy" | "monitor" | "service" | "critical";

export type PhmSystem =
  | "engine"
  | "brake"
  | "electrical"
  | "hv-battery"
  | "tyres"
  | "sensors-health"
  | "drive-belt"
  | "suspension";

export interface PhmTileProps {
  system: PhmSystem;
  rulP10Days: number;
  rulP90Days: number;
  severity: PhmSeverity;
  rationale: string;
  className?: string;
}

const TITLES: Record<PhmSystem, string> = {
  engine: "Engine",
  brake: "Brakes",
  electrical: "12V electrical",
  "hv-battery": "HV battery",
  tyres: "Tyres",
  "sensors-health": "Sensor health",
  "drive-belt": "Drive belt",
  suspension: "Suspension",
};

const SEVERITY_TO_RING: Record<PhmSeverity, KPIRingStatus> = {
  healthy: "ok",
  monitor: "watch",
  service: "alert",
  critical: "unsafe",
};

const SEVERITY_LABEL: Record<PhmSeverity, string> = {
  healthy: "Healthy",
  monitor: "Watch",
  service: "Service due",
  critical: "Critical",
};

const SEVERITY_COLOR: Record<PhmSeverity, string> = {
  healthy: "var(--color-emerald)",
  monitor: "var(--color-amber)",
  service: "var(--color-copper)",
  critical: "var(--color-crimson)",
};

// The dashboard normalises the P90 RUL to the canonical lifecycle window of a
// well-maintained luxury vehicle (≈4 years between major services). 1500 days
// = 100% health; anything beyond 1500 also resolves to 100%.
const RUL_NORMALISER_DAYS = 1500;

export function PhmTile({
  system,
  rulP10Days,
  rulP90Days,
  severity,
  rationale,
  className,
}: PhmTileProps): React.JSX.Element {
  const value = Math.min(1, Math.max(0, rulP90Days / RUL_NORMALISER_DAYS));
  const lower = Math.min(1, Math.max(0, rulP10Days / RUL_NORMALISER_DAYS));

  return (
    <GlassPanel
      as="article"
      className={cn(
        "flex h-full flex-col items-center gap-4 rounded-[var(--radius-md)] !p-5 text-center",
        className,
      )}
    >
      <KPIRing
        label={TITLES[system]}
        value={value}
        lowerBound={lower}
        unit="P90 health"
        status={SEVERITY_TO_RING[severity]}
        statusLabel={null}
        size={148}
      />
      <span
        className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-caps)]"
        style={{ color: SEVERITY_COLOR[severity] }}
      >
        {SEVERITY_LABEL[severity]}
      </span>
      <p className="text-[var(--text-small)] leading-[1.55] text-pearl">
        Remaining useful life: <span className="luxe-mono text-pearl">{rulP10Days}–{rulP90Days} days</span>{" "}
        <span className="text-pearl-soft text-[var(--text-caption)]">(P10/P90)</span>
      </p>
      <p className="text-[var(--text-small)] leading-[1.5] text-pearl-soft">
        {rationale}
      </p>
    </GlassPanel>
  );
}

interface PhmGroupProps {
  title: string;
  tiles: PhmTileProps[];
  verdict: string;
  className?: string;
}

export function PhmGroup({ title, tiles, verdict, className }: PhmGroupProps): React.JSX.Element {
  const worst = worstSeverity(tiles.map((t) => t.severity));
  return (
    <section
      className={cn("flex flex-col gap-4", className)}
      aria-label={title}
    >
      <header className="flex items-baseline justify-between gap-3">
        <SpecLabel>{title}</SpecLabel>
        <span
          className="luxe-mono text-[var(--text-micro)] uppercase tracking-[var(--tracking-caps)]"
          style={{ color: severityColor(worst) }}
        >
          {SEVERITY_LABEL[worst]}
        </span>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <PhmTile key={t.system} {...t} />
        ))}
      </div>
      <p className="text-[var(--text-small)] leading-[1.6] text-pearl-soft">{verdict}</p>
    </section>
  );
}

function worstSeverity(items: PhmSeverity[]): PhmSeverity {
  const order: PhmSeverity[] = ["healthy", "monitor", "service", "critical"];
  let worst: PhmSeverity = "healthy";
  for (const it of items) {
    if (order.indexOf(it) > order.indexOf(worst)) worst = it;
  }
  return worst;
}

function severityColor(s: PhmSeverity): string {
  switch (s) {
    case "healthy":
      return "var(--color-emerald)";
    case "monitor":
      return "var(--color-amber)";
    case "service":
      return "var(--color-copper)";
    case "critical":
      return "var(--color-crimson)";
  }
}
