"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface PhmAction {
  component: string;
  action: string;
}

const FALLBACK_ACTIONS: PhmAction[] = [
  { component: "brake-pad-front", action: "monitor" },
  { component: "tpms-front-left", action: "monitor" },
  { component: "hv-battery", action: "monitor" },
];

export function AutonomyDashboard(): React.JSX.Element {
  const t = useTranslations();
  const [actions, setActions] = useState<PhmAction[]>(FALLBACK_ACTIONS);
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const res = await fetch("/api/proxy/phm/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            inMotion: false,
            readings: [
              {
                component: "brake-pad-front",
                timestamp: new Date().toISOString(),
                state: "healthy",
                rulSamples: [100],
                rulMean: 100,
                rulP10: 90,
                rulP90: 110,
                confidence: 0.9,
                source: "phm",
              },
            ],
          }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { actions?: PhmAction[] };
        };
        if (!cancelled && body.data?.actions) setActions(body.data.actions);
      } catch {
        /* keep fallback */
      }
    }
    void poll();
    const id = setInterval(() => void poll(), 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      className="grid gap-4 md:grid-cols-2"
      style={{ gridAutoRows: "minmax(10rem, auto)" }}
    >
      <Tile title={t("autonomy.tiles.camera")}>
        <div
          className="flex h-full items-center justify-center rounded-[var(--radius-card)] border border-muted/40"
          style={{ backgroundColor: "oklch(18% 0.02 260)" }}
          aria-label={t("autonomy.cameraAlt")}
        >
          <span className="text-muted">{t("autonomy.cameraPlaceholder")}</span>
        </div>
      </Tile>

      <Tile title={t("autonomy.tiles.sensors")}>
        <ul className="space-y-2">
          <li className="flex justify-between">
            <span>{t("autonomy.sensor.brake")}</span>
            <span className="text-success">OK</span>
          </li>
          <li className="flex justify-between">
            <span>{t("autonomy.sensor.tpms")}</span>
            <span className="text-success">OK</span>
          </li>
          <li className="flex justify-between">
            <span>{t("autonomy.sensor.hv")}</span>
            <span className="text-success">OK</span>
          </li>
        </ul>
      </Tile>

      <Tile title={t("autonomy.tiles.phm")}>
        <ul className="space-y-2 text-sm">
          {actions.map((a) => (
            <li key={a.component} className="flex justify-between">
              <span>{a.component}</span>
              <span className="font-mono text-muted">{a.action}</span>
            </li>
          ))}
        </ul>
      </Tile>

      <Tile title={t("autonomy.tiles.grant")}>
        <div className="space-y-3">
          <p className="text-sm">
            {granted ? t("autonomy.grant.active") : t("autonomy.grant.inactive")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setGranted((g) => !g)}
              className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-4 py-2 text-sm font-semibold text-accent-on"
            >
              {granted ? t("autonomy.grant.revoke") : t("autonomy.grant.grant")}
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-[var(--radius-card)] border-2 border-danger px-4 py-2 text-sm font-semibold text-on-surface"
            >
              {t("autonomy.override")}
            </button>
          </div>
        </div>
      </Tile>
    </div>
  );
}

function Tile({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-muted/30 p-5"
    >
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="flex-1">{children}</div>
    </section>
  );
}
