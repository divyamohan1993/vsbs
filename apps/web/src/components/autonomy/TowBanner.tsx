"use client";

import { useMemo } from "react";
import { usePerceptionEvents, type PerceptionEvent } from "./usePerceptionEvents";

interface Props {
  bookingId: string;
}

interface EgoLocation {
  lat: number;
  lng: number;
}

function pickEgoLocation(data: PerceptionEvent["data"]): EgoLocation | null {
  if (!data || typeof data !== "object") return null;
  const ego = (data as { ego?: unknown }).ego;
  if (!ego || typeof ego !== "object") return null;
  const e = ego as Record<string, unknown>;
  if (typeof e.lat === "number" && typeof e.lng === "number") {
    return { lat: e.lat, lng: e.lng };
  }
  return null;
}

export function TowBanner({ bookingId }: Props): React.JSX.Element | null {
  const { events } = usePerceptionEvents(bookingId);

  const towEvent = useMemo(
    () =>
      [...events]
        .reverse()
        .find(
          (e) =>
            e.category === "safety" &&
            e.severity === "critical" &&
            e.title.toLowerCase().includes("tow"),
        ) ?? null,
    [events],
  );

  if (!towEvent) return null;

  const ego = pickEgoLocation(towEvent.data);
  const fault =
    towEvent.data && typeof towEvent.data === "object"
      ? (towEvent.data as { fault?: unknown }).fault
      : undefined;
  const health =
    towEvent.data && typeof towEvent.data === "object"
      ? (towEvent.data as { healthPct?: unknown }).healthPct
      : undefined;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="relative overflow-hidden rounded-[var(--radius-md)] border-2 border-[var(--color-crimson)] bg-[rgba(178,58,72,0.18)] p-6 shadow-[0_0_30px_rgba(178,58,72,0.35)]"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-crimson)] text-2xl font-bold text-white">
          !
        </div>
        <div className="flex-1 space-y-2">
          <p className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-[color:rgba(255,180,180,0.95)]">
            Critical · Safety
          </p>
          <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-medium text-pearl">
            {towEvent.title}
          </h3>
          {towEvent.detail ? (
            <p className="text-[length:var(--text-body)] leading-[1.5] text-pearl-muted">
              {towEvent.detail}
            </p>
          ) : null}
          <div className="grid gap-3 pt-2 text-[length:var(--text-small)] text-pearl-muted sm:grid-cols-2">
            {typeof fault === "string" ? (
              <div>
                <span className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                  Fault
                </span>
                <div className="text-pearl">{fault}</div>
              </div>
            ) : null}
            {typeof health === "number" ? (
              <div>
                <span className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                  Health at halt
                </span>
                <div className="text-pearl">{health.toFixed(1)}%</div>
              </div>
            ) : null}
            {ego ? (
              <div className="sm:col-span-2">
                <span className="luxe-mono uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                  Vehicle GPS
                </span>
                <div className="text-pearl">
                  {ego.lat.toFixed(5)}°, {ego.lng.toFixed(5)}°
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 pt-3">
            <button
              type="button"
              className="luxe-btn-primary inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-sm)] px-5 py-2 text-[length:var(--text-control)] font-medium tracking-[var(--tracking-wide)]"
              onClick={() => window.alert("In production: dispatches the nearest tow partner via TSP API.")}
            >
              Dispatch tow
            </button>
            <button
              type="button"
              className="luxe-glass inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-sm)] border px-5 py-2 text-[length:var(--text-control)] tracking-[var(--tracking-wide)] text-pearl"
              onClick={() => window.alert("In production: live operator support call.")}
            >
              Call support
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
