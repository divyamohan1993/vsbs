"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { CameraGrid } from "../../../components/autonomy/CameraTile";
import {
  CommandGrantCard,
  type CommandGrantSummary,
} from "../../../components/autonomy/CommandGrantCard";
import { OverrideButton } from "../../../components/autonomy/OverrideButton";
import {
  PhmGroup,
  type PhmTileProps,
} from "../../../components/autonomy/PhmTile";
import { SensorTile, type SensorReading } from "../../../components/autonomy/SensorTile";
import {
  useTelemetryStream,
  type TelemetryHistory,
  type TransportStatus,
} from "../../../components/autonomy/useTelemetryStream";
import { ToastProvider, useToast } from "../../../components/ui/Toast";
import { GlassPanel, SpecLabel } from "../../../components/luxe";
import { SignalBars, type SignalLevel } from "../../../components/autonomy/luxe/SignalBars";
import { StatusPill } from "../../../components/autonomy/luxe/StatusPill";

const FALLBACK_PHM: PhmTileProps[] = [
  {
    system: "engine",
    rulP10Days: 220,
    rulP90Days: 360,
    severity: "healthy",
    rationale: "Oil viscosity nominal. No DTCs in the last fourteen days.",
  },
  {
    system: "drive-belt",
    rulP10Days: 540,
    rulP90Days: 720,
    severity: "healthy",
    rationale: "Belt tension and crack count within manufacturer tolerance.",
  },
  {
    system: "brake",
    rulP10Days: 65,
    rulP90Days: 110,
    severity: "monitor",
    rationale: "Front pad thickness near 35%. The service window opens in six weeks.",
  },
  {
    system: "tyres",
    rulP10Days: 90,
    rulP90Days: 180,
    severity: "monitor",
    rationale: "Tread depth 4.2 mm front. A rotation is due in two thousand kilometres.",
  },
  {
    system: "suspension",
    rulP10Days: 700,
    rulP90Days: 1100,
    severity: "healthy",
    rationale: "Damper response curves match the as-new envelope.",
  },
  {
    system: "electrical",
    rulP10Days: 480,
    rulP90Days: 600,
    severity: "healthy",
    rationale: "12 V battery cranking voltage 12.7 V cold.",
  },
  {
    system: "hv-battery",
    rulP10Days: 1000,
    rulP90Days: 1500,
    severity: "healthy",
    rationale: "Severson knee-point distance > 280 cycles. Capacity fade < 4%.",
  },
];

const FALLBACK_GRANT: CommandGrantSummary = {
  id: "00000000-0000-4000-8000-000000000000",
  status: "active",
  scope: ["acceptHandoff", "performScope:park", "performScope:returnToOwner"],
  tier: "ipp-l4-vehicle-only",
  ttlSeconds: 900,
  ttlRemainingSeconds: 612,
  canonicalBytesPreview:
    '{"alg":"ML-DSA","grantId":"00000000-0000-4000-8000-000000000000","oem":"mercedes-ipp","scope":["acceptHandoff","performScope:park","performScope:returnToOwner"],"ttl":900,"vin":"WDD3J4HB1JF000123"}',
  signatureHash: "sha256:6fe2…b91c",
  algorithm: "ML-DSA",
  witnessChain: [
    { witnessId: "ow", merkleRoot: "f1d4…" },
    { witnessId: "mb", merkleRoot: "07a8…" },
    { witnessId: "rg", merkleRoot: "33c9…" },
  ],
  issuedAt: new Date().toISOString(),
  oem: "mercedes-ipp",
  oemLabel: "Mercedes-Benz / Bosch IPP",
  vehicleVin: "WDD3J4HB1JF000123",
  vehicleLabel: "Mercedes-Benz EQS",
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
  const { frame, history, status, reconnect, error, lastTickMs } = useTelemetryStream(bookingId);
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

  const sensorReadings = useMemo<SensorReading[]>(
    () => buildSensorReadings(frame, history, t),
    [frame, history, t],
  );

  const powertrain = phm.filter((p) => p.system === "engine" || p.system === "drive-belt");
  const chassis = phm.filter((p) => p.system === "brake" || p.system === "tyres" || p.system === "suspension");
  const energy = phm.filter((p) => p.system === "electrical" || p.system === "hv-battery");

  const overallVerdict = describeOverall(phm);

  const overrideCta = (
    <OverrideButton
      grantId={grant?.id ?? null}
      {...(grant?.canonicalBytesPreview ? { canonicalBytesPreview: grant.canonicalBytesPreview } : {})}
      onRevoked={(id) => {
        setGrant((g) => (g && g.id === id ? { ...g, status: "revoked", ttlRemainingSeconds: 0 } : g));
        toast.push({
          title: t("autonomy.toast.revoked.title"),
          description: t("autonomy.toast.revoked.body"),
          tone: "success",
        });
      }}
      onError={(msg) =>
        toast.push({ title: t("autonomy.toast.revokeFailed"), description: msg, tone: "danger" })
      }
    />
  );

  return (
    <div className="space-y-10 md:space-y-14">
      <KpiBand
        bookingId={bookingId}
        status={status}
        origin={frame.origin}
        grant={grant}
        lastTickMs={lastTickMs}
        onReconnect={reconnect}
      />

      {error ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border-l-2 border-[var(--color-crimson)] bg-[rgba(178,58,72,0.10)] px-5 py-4 text-pearl"
        >
          <p className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            {t("autonomy.live.error")}
          </p>
          <p className="mt-1 text-[var(--text-control)]">{error}</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="cameras-heading" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="cameras-heading" className="sr-only">
              {t("autonomy.tiles.camera")}
            </h2>
            <SpecLabel>{t("autonomy.tiles.camera")}</SpecLabel>
            <span className="luxe-mono text-[var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              {frame.origin === "real" ? "REAL FEED" : "SIM FEED"}
            </span>
          </div>
          <CameraGrid origin={frame.origin} />
        </section>
        <section aria-labelledby="sensors-heading" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="sensors-heading" className="sr-only">
              {t("autonomy.tiles.sensors")}
            </h2>
            <SpecLabel>{t("autonomy.tiles.sensors")}</SpecLabel>
            <span className="luxe-mono text-[var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              SIX CHANNELS
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sensorReadings.map((r) => (
              <SensorTile key={r.channel} reading={r} />
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="phm-heading" className="space-y-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="phm-heading" className="sr-only">
            {t("autonomy.tiles.phm")}
          </h2>
          <SpecLabel>{t("autonomy.tiles.phm")}</SpecLabel>
          <span className="text-[var(--text-small)] text-pearl-soft">{overallVerdict}</span>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <PhmGroup
            title="Powertrain"
            tiles={powertrain}
            verdict="The engine is healthy and the drive belt has runway."
          />
          <PhmGroup
            title="Chassis"
            tiles={chassis}
            verdict="Brakes and tyres are the only items asking for attention. Both are still safe."
          />
          <PhmGroup
            title="Energy"
            tiles={energy}
            verdict="Both the 12 V and the high-voltage pack are well inside their healthy envelope."
          />
        </div>
      </section>

      <section aria-labelledby="grant-heading" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="grant-heading" className="sr-only">
            {t("autonomy.tiles.grant")}
          </h2>
          <SpecLabel>Command grant</SpecLabel>
          <span className="luxe-mono text-[var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            Signed and witnessed
          </span>
        </div>
        <CommandGrantCard grant={grant} override={overrideCta} />
      </section>
    </div>
  );
}

interface KpiBandProps {
  bookingId: string;
  status: TransportStatus;
  origin: "real" | "sim";
  grant: CommandGrantSummary | null;
  lastTickMs: number;
  onReconnect: () => void;
}

function KpiBand({ bookingId, status, origin, grant, lastTickMs, onReconnect }: KpiBandProps): React.JSX.Element {
  const t = useTranslations();
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, []);

  const signalLevel = transportLevel(status);
  const transportLabel = describeTransport(status, t);
  const autonomyState = grant?.status === "active" ? "AUTONOMOUS" : grant?.status === "revoked" ? "MANUAL" : "STANDBY";
  const autonomyTone = grant?.status === "active" ? "ok" : grant?.status === "revoked" ? "halt" : "watch";
  const relTime = relativeTime(now - lastTickMs);

  const bandStyle = {
    "--autonomy-bg": 'url("/images/dashboard-grille.png")',
    "--autonomy-bg-portrait": 'url("/images/dashboard-grille.png")',
  } as CSSProperties;

  return (
    <GlassPanel
      variant="elevated"
      as="section"
      className="luxe-autonomy-band relative !p-0"
      aria-label={t("autonomy.eyebrow")}
    >
      <div
        className="luxe-autonomy-band absolute inset-0 -z-0"
        style={bandStyle}
        aria-hidden="true"
      />
      <div className="relative grid gap-6 px-6 py-6 md:grid-cols-[1.4fr_1fr_auto] md:items-center md:gap-8 md:px-10 md:py-10">
        <div className="flex flex-col gap-3">
          <SpecLabel>{t("autonomy.eyebrow")}</SpecLabel>
          <h1 className="font-[family-name:var(--font-display)] text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.05] tracking-[var(--tracking-tight)] text-pearl">
            {grant?.vehicleLabel ?? "Your vehicle"} is en route.
          </h1>
          <p className="text-pearl-muted text-[var(--text-control)] leading-[1.6] max-w-[520px]">
            We will signal a takeover the moment the road asks for one.
          </p>
          <p className="luxe-mono text-[var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            BOOKING {bookingId}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <StatusPill tone={autonomyTone}>{autonomyState}</StatusPill>
            <StatusPill tone={origin === "real" ? "ok" : "watch"} size="sm">
              {origin === "real" ? "REAL TELEMETRY" : "SIM TELEMETRY"}
            </StatusPill>
          </div>
          <div className="flex items-center gap-3">
            <SignalBars level={signalLevel} label={transportLabel} active={status !== "disconnected"} />
            <span className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl">
              {transportLabel}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="luxe-mono text-[var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              {t("autonomy.live.lastUpdate")}
            </span>
            <span className="luxe-mono text-[var(--text-caption)] text-pearl tabular-nums">
              {relTime}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onReconnect}
          className="luxe-glass inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-5 luxe-mono uppercase tracking-[var(--tracking-caps)] text-[var(--text-caption)] text-pearl hover:[border-color:var(--color-hairline-hover)]"
          aria-label={t("autonomy.live.reconnect")}
        >
          <span aria-hidden="true">↻</span>
          {t("autonomy.live.reconnect")}
        </button>
      </div>
    </GlassPanel>
  );
}

function buildSensorReadings(
  frame: ReturnType<typeof useTelemetryStream>["frame"],
  history: TelemetryHistory,
  t: ReturnType<typeof useTranslations>,
): SensorReading[] {
  return [
    {
      channel: "speed",
      label: t("autonomy.live.speed"),
      value: frame.speedKph.toFixed(1),
      unit: "km/h",
      status: "ok",
      history: history.speedKph,
    },
    {
      channel: "heading",
      label: t("autonomy.live.heading"),
      value: frame.headingDeg.toFixed(0),
      unit: "deg",
      status: "ok",
      history: history.headingDeg,
    },
    {
      channel: "brake-pad-front",
      label: t("autonomy.live.brakePad"),
      value: frame.brakePadFrontPercent.toFixed(0),
      unit: "%",
      status: frame.brakePadFrontPercent < 25 ? "warn" : "ok",
      history: history.brakePadFrontPercent,
    },
    {
      channel: "hv-battery-soc",
      label: t("autonomy.live.hvSoc"),
      value: frame.hvSocPercent.toFixed(0),
      unit: "%",
      status: frame.hvSocPercent < 15 ? "warn" : "ok",
      history: history.hvSocPercent,
    },
    {
      channel: "coolant-temp",
      label: t("autonomy.live.coolant"),
      value: frame.coolantTempC.toFixed(1),
      unit: "C",
      status: frame.coolantTempC > 105 ? "fault" : frame.coolantTempC > 100 ? "warn" : "ok",
      history: history.coolantTempC,
    },
    {
      channel: "tpms",
      label: t("autonomy.live.tpms"),
      value: ((frame.tpms.fl + frame.tpms.fr + frame.tpms.rl + frame.tpms.rr) / 4).toFixed(0),
      unit: "kPa",
      status: "ok",
      history: history.tpms,
      detail: [
        { label: "FL", value: `${frame.tpms.fl.toFixed(0)}` },
        { label: "FR", value: `${frame.tpms.fr.toFixed(0)}` },
        { label: "RL", value: `${frame.tpms.rl.toFixed(0)}` },
        { label: "RR", value: `${frame.tpms.rr.toFixed(0)}` },
      ],
    },
  ];
}

function transportLevel(s: TransportStatus): SignalLevel {
  switch (s) {
    case "websocket":
      return 3;
    case "sse":
      return 2;
    case "local-sim":
      return 1;
    default:
      return 0;
  }
}

function describeTransport(s: TransportStatus, t: ReturnType<typeof useTranslations>): string {
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

function relativeTime(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

function describeOverall(items: PhmTileProps[]): string {
  const worst = items.reduce<string>((acc, it) => {
    const order = ["healthy", "monitor", "service", "critical"];
    return order.indexOf(it.severity) > order.indexOf(acc) ? it.severity : acc;
  }, "healthy");
  switch (worst) {
    case "healthy":
      return "All seven subsystems are within their healthy envelope.";
    case "monitor":
      return "Two subsystems are on watch. The vehicle is safe to drive.";
    case "service":
      return "One subsystem is asking for service. Keep the booking on calendar.";
    case "critical":
      return "A subsystem has crossed its safety threshold. Pull the override.";
    default:
      return "";
  }
}
