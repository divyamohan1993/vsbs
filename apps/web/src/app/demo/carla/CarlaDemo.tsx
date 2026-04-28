// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { TelemetryTile } from "../../../components/demo/telemetry-tile";
import { BookingTimeline, type TimelineStep } from "../../../components/demo/booking-timeline";

interface ScenarioFrame {
  scenarioId: string;
  vehicleId: string;
  fault: string;
  state: string;
  bookingId?: string | null;
  scId?: string | null;
  outboundGrantId?: string | null;
  returnGrantId?: string | null;
  history: { state: string; at: string; note?: string }[];
}

interface SensorBucketEntry {
  channel: string;
  origin: string;
  simSource?: string;
  value: unknown;
  health: { selfTestOk: boolean; trust: number };
  timestamp: string;
}

const FAULTS = [
  "brake-pad-wear",
  "coolant-overheat",
  "hv-battery-imbalance",
  "tpms-dropout",
  "oil-low",
  "drive-belt-age",
] as const;

type Fault = (typeof FAULTS)[number];

const STAGE_KEYS = [
  "DRIVING_HOME_AREA",
  "FAULT_INJECTING",
  "BOOKING_PENDING",
  "AWAITING_GRANT",
  "DRIVING_TO_SC",
  "SERVICING",
  "AWAITING_RETURN_GRANT",
  "DRIVING_HOME",
  "DONE",
];

interface StartResponse {
  scenarioId: string;
  state: string;
}

async function startScenario(vehicleId: string, fault: Fault): Promise<StartResponse> {
  const res = await fetch("/api/proxy/scenarios/carla-demo/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vehicleId, fault, scCount: 3 }),
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  const body = (await res.json()) as { data: StartResponse };
  return body.data;
}

async function readScenario(id: string): Promise<ScenarioFrame> {
  const res = await fetch(`/api/proxy/scenarios/${id}`);
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  const body = (await res.json()) as { data: ScenarioFrame };
  return body.data;
}

async function readLatest(vehicleId: string): Promise<Record<string, SensorBucketEntry>> {
  const res = await fetch(`/api/proxy/sensors/${vehicleId}/latest`);
  if (!res.ok) return {};
  const body = (await res.json()) as { data: Record<string, SensorBucketEntry> };
  return body.data ?? {};
}

function describeStage(state: string): TimelineStep["state"] {
  if (state === "DONE") return "done";
  if (state === "FAILED") return "failed";
  if (state === "IDLE") return "pending";
  return "active";
}

function buildSteps(scenario: ScenarioFrame | null): TimelineStep[] {
  const seen = new Set(scenario?.history.map((h) => h.state) ?? []);
  const current = scenario?.state;
  return STAGE_KEYS.map((key) => {
    const reached = seen.has(key) || key === current;
    let state: TimelineStep["state"] = "pending";
    if (current === "FAILED" && reached) state = "failed";
    else if (current === key) state = "active";
    else if (reached) state = "done";
    const at = scenario?.history.find((h) => h.state === key)?.at;
    return {
      key,
      label: key.replace(/_/g, " ").toLowerCase(),
      state,
      ...(at ? { at: new Date(at).toLocaleTimeString() } : {}),
    };
  });
}

export function CarlaDemo({ initialVehicleId }: { initialVehicleId: string }): React.JSX.Element {
  const t = useTranslations();
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const [fault, setFault] = useState<Fault>("brake-pad-wear");
  const [scenario, setScenario] = useState<ScenarioFrame | null>(null);
  const [latest, setLatest] = useState<Record<string, SensorBucketEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!scenario) return;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const [next, latestSensors] = await Promise.all([
          readScenario(scenario.scenarioId),
          readLatest(vehicleId),
        ]);
        if (!cancelled) {
          setScenario(next);
          setLatest(latestSensors);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [scenario?.scenarioId, vehicleId]);

  const onStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await startScenario(vehicleId, fault);
      const fresh = await readScenario(started.scenarioId);
      setScenario(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const steps = useMemo(() => buildSteps(scenario), [scenario]);
  const stage = scenario?.state ?? "IDLE";

  const tiles = useMemo(() => {
    const obd = (latest["obd-pid"]?.value ?? {}) as Record<string, number | string>;
    const wheel = (latest["wheel-speed"]?.value ?? {}) as Record<string, number>;
    const imu = (latest["imu"]?.value ?? {}) as Record<string, number>;
    const bms = (latest["bms"]?.value ?? {}) as Record<string, number>;
    const brakeP = (latest["brake-pressure"]?.value ?? {}) as Record<string, number>;
    const tpms = latest["tpms"];
    return {
      speed: typeof wheel["speed_kph"] === "number" ? wheel["speed_kph"].toFixed(0) : "--",
      heading: typeof imu["heading_deg"] === "number" ? imu["heading_deg"].toFixed(0) : "--",
      brakePad:
        typeof brakeP["brake_pad_pct"] === "number" ? brakeP["brake_pad_pct"].toFixed(1) : "--",
      coolant: typeof obd["coolant_c"] === "number" ? Number(obd["coolant_c"]).toFixed(1) : "--",
      hvSoc: typeof bms["soc_pct"] === "number" ? bms["soc_pct"].toFixed(1) : "--",
      cellDelta:
        typeof bms["cell_delta_mv"] === "number" ? bms["cell_delta_mv"].toFixed(0) : "--",
      tpmsLine: tpms ? JSON.stringify(tpms.value) : "--",
    };
  }, [latest]);

  const brakePadValue = parseFloat(tiles.brakePad);
  const coolantValue = parseFloat(tiles.coolant);
  const cellValue = parseFloat(tiles.cellDelta);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-muted text-xs uppercase tracking-[0.2em]">
          {t("demoCarla.eyebrow")}
        </p>
        <h1 className="font-display text-4xl font-semibold leading-[1.05]">
          {t("demoCarla.title")}
        </h1>
        <p className="text-muted max-w-2xl text-sm">{t("demoCarla.subtitle")}</p>
      </header>

      <fieldset className="rounded-[var(--radius-card)] border border-muted/30 p-6 space-y-4">
        <legend className="font-display text-xl font-semibold">
          {t("demoCarla.controls")}
        </legend>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("demoCarla.vehicleId")}</span>
          <input
            type="text"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="block w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-4 py-2 font-mono"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("demoCarla.fault")}</span>
          <select
            value={fault}
            onChange={(e) => setFault(e.target.value as Fault)}
            className="block w-full rounded-[var(--radius-card)] border border-muted/40 bg-transparent px-4 py-2"
          >
            {FAULTS.map((f) => (
              <option key={f} value={f}>{t(`demoCarla.faults.${f}`)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onStart}
          disabled={busy || !vehicleId.trim()}
          className="inline-flex items-center justify-center rounded-[var(--radius-card)] bg-accent px-6 py-3 font-semibold text-accent-on disabled:opacity-50"
        >
          {busy ? t("demoCarla.starting") : t("demoCarla.start")}
        </button>
      </fieldset>

      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border-2 border-danger px-4 py-3 text-on-surface">
          {error}
        </div>
      ) : null}

      <section aria-labelledby="telemetry-h" className="space-y-3">
        <h2 id="telemetry-h" className="font-display text-2xl font-semibold">
          {t("demoCarla.telemetry")}
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <TelemetryTile label={t("demoCarla.tiles.speed")} value={tiles.speed} unit="kph" />
          <TelemetryTile label={t("demoCarla.tiles.heading")} value={tiles.heading} unit="°" />
          <TelemetryTile
            label={t("demoCarla.tiles.brake")}
            value={tiles.brakePad}
            unit="%"
            tone={!Number.isNaN(brakePadValue) && brakePadValue < 25 ? "alert" : !Number.isNaN(brakePadValue) && brakePadValue < 40 ? "watch" : "neutral"}
          />
          <TelemetryTile
            label={t("demoCarla.tiles.coolant")}
            value={tiles.coolant}
            unit="°C"
            tone={!Number.isNaN(coolantValue) && coolantValue >= 110 ? "alert" : !Number.isNaN(coolantValue) && coolantValue >= 100 ? "watch" : "neutral"}
          />
          <TelemetryTile label={t("demoCarla.tiles.hv")} value={tiles.hvSoc} unit="%" />
          <TelemetryTile
            label={t("demoCarla.tiles.cell")}
            value={tiles.cellDelta}
            unit="mV"
            tone={!Number.isNaN(cellValue) && cellValue >= 130 ? "alert" : "neutral"}
          />
        </div>
        <p className="text-xs text-muted">
          {t("demoCarla.tpms")}: <span className="font-mono">{tiles.tpmsLine}</span>
        </p>
      </section>

      <section aria-labelledby="timeline-h" className="space-y-3">
        <h2 id="timeline-h" className="font-display text-2xl font-semibold">
          {t("demoCarla.timeline")}
        </h2>
        <p className="text-sm text-muted">
          {t("demoCarla.currentStage")}: <strong>{stage}</strong>
          {scenario?.bookingId ? (
            <> · {t("demoCarla.bookingId")}: <span className="font-mono">{scenario.bookingId}</span></>
          ) : null}
        </p>
        <BookingTimeline ariaLabel={t("demoCarla.timelineLabel")} steps={steps} />
      </section>

      <section aria-labelledby="grant-h" className="space-y-2 rounded-[var(--radius-card)] border border-muted/30 p-6">
        <h2 id="grant-h" className="font-display text-2xl font-semibold">
          {t("demoCarla.grant")}
        </h2>
        <dl className="grid gap-2 md:grid-cols-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">{t("demoCarla.outbound")}</dt>
            <dd className="font-mono">{scenario?.outboundGrantId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">{t("demoCarla.return")}</dt>
            <dd className="font-mono">{scenario?.returnGrantId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">{t("demoCarla.serviceCentre")}</dt>
            <dd>{scenario?.scId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">{t("demoCarla.fault")}</dt>
            <dd>{scenario?.fault ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {scenario ? (
        <section aria-labelledby="rationale-h" className="space-y-2 rounded-[var(--radius-card)] border border-muted/30 p-6">
          <h2 id="rationale-h" className="font-display text-2xl font-semibold">
            {t("demoCarla.history")}
          </h2>
          <ol className="space-y-1 text-sm">
            {scenario.history.map((h, idx) => (
              <li key={idx}>
                <span className="font-mono text-xs text-muted">
                  {new Date(h.at).toLocaleTimeString()}
                </span>{" "}
                <span className="font-medium">{h.state}</span>
                {h.note ? <span className="text-on-surface">: {h.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
