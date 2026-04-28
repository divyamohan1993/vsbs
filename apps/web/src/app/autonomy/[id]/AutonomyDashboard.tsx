"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CameraGrid } from "../../../components/autonomy/CameraTile";
import {
  CommandGrantCard,
  type CommandGrantSummary,
} from "../../../components/autonomy/CommandGrantCard";
import { OverrideButton } from "../../../components/autonomy/OverrideButton";
import { PhmTile, type PhmTileProps } from "../../../components/autonomy/PhmTile";
import { SensorTile, type SensorReading } from "../../../components/autonomy/SensorTile";
import { useTelemetryStream } from "../../../components/autonomy/useTelemetryStream";
import { ToastProvider, useToast } from "../../../components/ui/Toast";
import { Badge } from "../../../components/ui/Form";

const FALLBACK_PHM: PhmTileProps[] = [
  { system: "engine", rulP10Days: 220, rulP90Days: 360, severity: "healthy", rationale: "Oil viscosity nominal; no DTCs in last 14 days." },
  { system: "brake", rulP10Days: 65, rulP90Days: 110, severity: "monitor", rationale: "Front pad thickness near 35%; service window opens in 6 weeks." },
  { system: "electrical", rulP10Days: 480, rulP90Days: 600, severity: "healthy", rationale: "12V battery cranking voltage 12.7V cold." },
  { system: "hv-battery", rulP10Days: 1000, rulP90Days: 1500, severity: "healthy", rationale: "Severson knee-point distance > 280 cycles; capacity fade < 4%." },
  { system: "tyres", rulP10Days: 90, rulP90Days: 180, severity: "monitor", rationale: "Tread depth 4.2mm front; rotation due in 2k km." },
  { system: "sensors-health", rulP10Days: 3650, rulP90Days: 3650, severity: "healthy", rationale: "All channels reporting; sim/real split visible in origin summary." },
];

const FALLBACK_GRANT: CommandGrantSummary = {
  id: "00000000-0000-4000-8000-000000000000",
  status: "active",
  scope: ["acceptHandoff", "performScope:park", "performScope:returnToOwner"],
  tier: "ipp-l4-vehicle-only",
  ttlSeconds: 900,
  ttlRemainingSeconds: 612,
  canonicalBytesPreview:
    '{"alg":"ML-DSA","grantId":"00000000…","oem":"mercedes","scope":["acceptHandoff",…],"ttl":900,"vin":"WDD3J4HB…"}',
  signatureHash: "sha256:6fe2…b91c",
  algorithm: "ML-DSA",
  witnessChain: [
    { witnessId: "vsbs-concierge", merkleRoot: "f1d4…" },
    { witnessId: "mercedes-ipp", merkleRoot: "07a8…" },
    { witnessId: "apcoa-stuttgart-p6", merkleRoot: "33c9…" },
  ],
  issuedAt: new Date().toISOString(),
  oem: "mercedes-ipp",
  vehicleVin: "WDD3J4HB1JF000123",
};

interface DashboardProps {
  bookingId: string;
}

export function AutonomyDashboard({ bookingId }: DashboardProps): React.JSX.Element {
  return (
    <ToastProvider>
      <DashboardInner bookingId={bookingId} />
    </ToastProvider>
  );
}

function DashboardInner({ bookingId }: DashboardProps): React.JSX.Element {
  const t = useTranslations();
  const toast = useToast();
  const { frame, status, reconnect, error } = useTelemetryStream(bookingId);
  const [grant, setGrant] = useState<CommandGrantSummary | null>(FALLBACK_GRANT);
  const [phm] = useState<PhmTileProps[]>(FALLBACK_PHM);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/proxy/autonomy/booking/${encodeURIComponent(bookingId)}/grant`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: CommandGrantSummary };
        if (!cancelled && body.data) setGrant(body.data);
      } catch {
        /* keep fallback */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const sensorReadings: SensorReading[] = [
    {
      channel: "speed",
      label: t("autonomy.live.speed"),
      value: frame.speedKph.toFixed(1),
      unit: "km/h",
      status: "ok",
    },
    {
      channel: "heading",
      label: t("autonomy.live.heading"),
      value: frame.headingDeg.toFixed(0),
      unit: "°",
      status: "ok",
    },
    {
      channel: "brake-pad-front",
      label: t("autonomy.live.brakePad"),
      value: frame.brakePadFrontPercent.toFixed(0),
      unit: "%",
      status: frame.brakePadFrontPercent < 25 ? "warn" : "ok",
    },
    {
      channel: "hv-battery-soc",
      label: t("autonomy.live.hvSoc"),
      value: frame.hvSocPercent.toFixed(0),
      unit: "%",
      status: frame.hvSocPercent < 15 ? "warn" : "ok",
    },
    {
      channel: "coolant-temp",
      label: t("autonomy.live.coolant"),
      value: frame.coolantTempC.toFixed(1),
      unit: "°C",
      status: frame.coolantTempC > 105 ? "fault" : frame.coolantTempC > 100 ? "warn" : "ok",
    },
    {
      channel: "tpms",
      label: t("autonomy.live.tpms"),
      value: ((frame.tpms.fl + frame.tpms.fr + frame.tpms.rl + frame.tpms.rr) / 4).toFixed(0),
      unit: "kPa",
      status: "ok",
      detail: [
        { label: "FL", value: `${frame.tpms.fl.toFixed(0)} kPa` },
        { label: "FR", value: `${frame.tpms.fr.toFixed(0)} kPa` },
        { label: "RL", value: `${frame.tpms.rl.toFixed(0)} kPa` },
        { label: "RR", value: `${frame.tpms.rr.toFixed(0)} kPa` },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-muted/30 px-4 py-3" style={{ backgroundColor: "oklch(20% 0.02 260)" }}>
        <div className="flex items-center gap-2">
          <Badge tone={status === "websocket" ? "success" : status === "sse" ? "info" : status === "local-sim" ? "warning" : "neutral"}>
            {transportLabel(status, t)}
          </Badge>
          <span className="text-xs text-muted">{t("autonomy.live.lastUpdate")}: {new Date(frame.ts).toLocaleTimeString()}</span>
          <Badge tone={frame.origin === "real" ? "success" : "warning"}>{t("autonomy.live.origin")}: {frame.origin}</Badge>
        </div>
        <button
          type="button"
          onClick={() => reconnect()}
          className="inline-flex items-center justify-center rounded-[var(--radius-card)] border border-muted/40 px-3 py-1 text-sm font-semibold"
        >
          {t("autonomy.live.reconnect")}
        </button>
      </div>

      {error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border-2 border-danger bg-danger/10 p-3 text-sm">
          {t("autonomy.live.error")}: {error}
        </div>
      ) : null}

      <section aria-labelledby="cameras-heading" className="space-y-2">
        <h2 id="cameras-heading" className="font-display text-xl font-semibold">{t("autonomy.tiles.camera")}</h2>
        <CameraGrid />
      </section>

      <section aria-labelledby="sensors-heading" className="space-y-2">
        <h2 id="sensors-heading" className="font-display text-xl font-semibold">{t("autonomy.tiles.sensors")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sensorReadings.map((r) => (
            <SensorTile key={r.channel} reading={r} />
          ))}
        </div>
      </section>

      <section aria-labelledby="phm-heading" className="space-y-2">
        <h2 id="phm-heading" className="font-display text-xl font-semibold">{t("autonomy.tiles.phm")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {phm.map((p) => (
            <PhmTile key={p.system} {...p} />
          ))}
        </div>
      </section>

      <section aria-labelledby="grant-heading" className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-2">
          <h2 id="grant-heading" className="sr-only">{t("autonomy.tiles.grant")}</h2>
          <CommandGrantCard grant={grant} />
        </div>
        <div className="space-y-2 self-end">
          <OverrideButton
            grantId={grant?.id ?? null}
            onRevoked={(id) => {
              setGrant((g) => (g && g.id === id ? { ...g, status: "revoked", ttlRemainingSeconds: 0 } : g));
              toast.push({ title: t("autonomy.toast.revoked.title"), description: t("autonomy.toast.revoked.body"), tone: "success" });
            }}
            onError={(msg) => toast.push({ title: t("autonomy.toast.revokeFailed"), description: msg, tone: "danger" })}
          />
        </div>
      </section>
    </div>
  );
}

function transportLabel(s: ReturnType<typeof useTelemetryStream>["status"], t: ReturnType<typeof useTranslations>): string {
  switch (s) {
    case "websocket":
      return t("autonomy.live.transport.ws");
    case "sse":
      return t("autonomy.live.transport.sse");
    case "local-sim":
      return t("autonomy.live.transport.local");
    case "connecting":
      return t("autonomy.live.transport.connecting");
    default:
      return t("autonomy.live.transport.disconnected");
  }
}
