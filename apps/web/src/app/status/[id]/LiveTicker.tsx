"use client";

// Status timeline — the flight-tracker for a service booking.
//
// Layout principles:
//   * The header is a wide GlassPanel with a serif ETA on the right
//     and a thin progress hairline beneath, edge to edge.
//   * The map placeholder is a route-topo backdrop with a copper
//     pulse marking the live position. CSS-only fallback.
//   * The timeline is a vertical list of GlassPanel rows, each with a
//     circular indicator: filled emerald = done, copper-pulse = current,
//     hairline-only = future. The current row glows softly.
//   * The concierge log is an expander that surfaces frame events from
//     /v1/bookings/:id/stream as an elegant text feed.
//
// SSE contract preserved: we still subscribe to
// /api/proxy/bookings/:id/stream and read `frame` / `end` events.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  ToastProvider,
  useToast,
  Button,
} from "../../../components/ui";
import {
  AmbientGlow,
  GlassPanel,
  GoldSeal,
  KPIBlock,
  SpecLabel,
  SpecValue,
} from "../../../components/luxe";
import { cn } from "../../../components/ui/cn";

interface TickerFrame {
  at: string;
  status: string;
  etaMinutes: number;
  wellbeing: number;
  message: string;
}

type StepKey =
  | "accepted"
  | "assigned"
  | "pickup"
  | "drivingToCentre"
  | "atBay"
  | "ready";

interface StepDef {
  key: StepKey;
  /** Status strings the API may emit that map to this step. Lowercase. */
  match: string[];
}

// Order matters — completion is "everything before the matched step".
const STEPS: StepDef[] = [
  { key: "accepted", match: ["accepted", "booking accepted"] },
  { key: "assigned", match: ["assigned"] },
  { key: "pickup", match: ["vehicle pickup", "pickup"] },
  { key: "drivingToCentre", match: ["en route", "en route to service centre", "driving"] },
  { key: "atBay", match: ["at bay", "in bay", "service bay"] },
  { key: "ready", match: ["ready for handover", "ready", "complete", "done"] },
];

const SEED_FRAMES: TickerFrame[] = [
  {
    at: new Date().toISOString(),
    status: "Assigned",
    etaMinutes: 22,
    wellbeing: 0.82,
    message: "Driver Ravi is finishing a brake reseal. 22 minutes to you.",
  },
  {
    at: new Date(Date.now() + 4_000).toISOString(),
    status: "Vehicle pickup",
    etaMinutes: 18,
    wellbeing: 0.84,
    message: "Driver Priya is 1.2 km away. Three minutes.",
  },
  {
    at: new Date(Date.now() + 8_000).toISOString(),
    status: "En route to service centre",
    etaMinutes: 12,
    wellbeing: 0.86,
    message: "On the Outer Ring Road. Light traffic. Wellbeing remains high.",
  },
  {
    at: new Date(Date.now() + 12_000).toISOString(),
    status: "At bay",
    etaMinutes: 6,
    wellbeing: 0.88,
    message: "Front brake pads inspected. Replacement confirmed.",
  },
  {
    at: new Date(Date.now() + 16_000).toISOString(),
    status: "Ready for handover",
    etaMinutes: 0,
    wellbeing: 0.9,
    message: "Service complete. Returning the vehicle now.",
  },
];

function statusKey(s: string): StepKey {
  const lower = s.toLowerCase();
  for (const step of STEPS) {
    if (step.match.some((m) => lower.includes(m))) return step.key;
  }
  return "accepted";
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

export function LiveTicker({ id }: { id: string }): React.JSX.Element {
  return (
    <ToastProvider>
      <LiveTickerInner id={id} />
    </ToastProvider>
  );
}

function LiveTickerInner({ id }: { id: string }): React.JSX.Element {
  const t = useTranslations();
  const toast = useToast();
  const [frames, setFrames] = useState<TickerFrame[]>([SEED_FRAMES[0]!]);
  const [current, setCurrent] = useState<TickerFrame>(SEED_FRAMES[0]!);
  const [connected, setConnected] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const conciergeId = useId();

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    function pushFrame(f: TickerFrame): void {
      if (cancelled) return;
      setCurrent(f);
      setFrames((prev) => {
        const next = [...prev, f];
        return next.length > 32 ? next.slice(-32) : next;
      });
    }

    function startSimFallback(): void {
      if (interval !== null) return;
      let i = 0;
      interval = setInterval(() => {
        i = (i + 1) % SEED_FRAMES.length;
        pushFrame(SEED_FRAMES[i]!);
      }, 4_000);
    }

    try {
      es = new EventSource(`/api/proxy/bookings/${encodeURIComponent(id)}/stream`);
      es.onopen = () => {
        if (!cancelled) setConnected(true);
      };
      const handle = (msg: MessageEvent<string>): void => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(msg.data) as {
            at?: string;
            status: string;
            etaMinutes: number;
            wellbeing: number;
            explanation?: string;
            message?: string;
          };
          pushFrame({
            at: parsed.at ?? new Date().toISOString(),
            status: parsed.status,
            etaMinutes: parsed.etaMinutes,
            wellbeing: parsed.wellbeing,
            message: parsed.explanation ?? parsed.message ?? "",
          });
        } catch {
          /* ignore malformed frames */
        }
      };
      es.addEventListener("frame", handle as EventListener);
      es.addEventListener("end", () => {
        es?.close();
        es = null;
      });
      es.onmessage = handle;
      es.onerror = () => {
        if (es) {
          es.close();
          es = null;
        }
        startSimFallback();
      };
    } catch {
      startSimFallback();
    }

    return () => {
      cancelled = true;
      if (es) es.close();
      if (interval) clearInterval(interval);
    };
  }, [id]);

  const activeKey = statusKey(current.status);
  const activeIndex = STEPS.findIndex((s) => s.key === activeKey);
  const totalSteps = STEPS.length;
  const progressPct = activeIndex < 0 ? 0 : ((activeIndex + 1) / totalSteps) * 100;

  const onAbort = useCallback((): void => {
    setAborting(true);
  }, []);

  const onConfirmAbort = useCallback((): void => {
    setAborting(false);
    toast.push({
      title: t("status.abort.toastTitle"),
      description: t("status.abort.toastBody"),
      tone: "warning",
    });
  }, [t, toast]);

  const wellbeingPct = Math.round(current.wellbeing * 100);
  const etaLabel = current.etaMinutes === 0
    ? t("status.etaArrived")
    : t("status.minutes", { n: current.etaMinutes });

  const stepRows = useMemo(() => {
    return STEPS.map((step, i) => {
      const state: "done" | "current" | "future" =
        activeIndex < 0
          ? "future"
          : i < activeIndex
            ? "done"
            : i === activeIndex
              ? "current"
              : "future";
      return { ...step, state };
    });
  }, [activeIndex]);

  return (
    <div className="space-y-8">
      <StatusHeader
        bookingId={id}
        centreName={t("status.centreName")}
        etaLabel={etaLabel}
        etaUnit={t("status.etaUnit")}
        progressPct={progressPct}
        ariaLabel={t("status.headerLabel")}
        liveLabel={connected ? t("status.live") : t("status.simulated")}
        currentStatus={current.status}
        currentStatusLabel={t("status.current")}
      />

      <RoutePreview
        ariaLabel={t("status.mapLabel")}
        alt={t("status.mapAlt")}
        progressPct={progressPct}
      />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Timeline
          rows={stepRows}
          currentTimestamp={formatTime(current.at)}
          getStepLabel={(k) => t(`status.steps.${k}.label`)}
          getStepBody={(k) => t(`status.steps.${k}.body`)}
          ariaLabel={t("status.timelineLabel")}
          stateLabels={{
            done: t("status.stepStateDone"),
            current: t("status.stepStateCurrent"),
            future: t("status.stepStateFuture"),
          }}
          currentLabel={t("status.currentLabel")}
        />
        <SidePanel
          wellbeingValue={wellbeingPct}
          wellbeingLabel={t("status.wellbeing")}
          etaLabel={t("status.eta")}
          etaValue={current.etaMinutes}
          etaUnit={t("status.etaUnit")}
          message={current.message}
        />
      </div>

      <ConciergeLog
        id={conciergeId}
        open={logOpen}
        onToggle={() => setLogOpen((v) => !v)}
        frames={frames}
        title={t("status.concierge")}
        hint={t("status.conciergeHint")}
        empty={t("status.conciergeEmpty")}
      />

      <FooterRow
        bookingId={id}
        bookingIdLabel={t("status.bookingId")}
        abortLabel={t("status.abort.trigger")}
        onAbort={onAbort}
      />

      <Dialog open={aborting} onOpenChange={setAborting}>
        <DialogContent>
          <DialogTitle>{t("status.abort.title")}</DialogTitle>
          <DialogDescription>{t("status.abort.body")}</DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAborting(false)}>
              {t("status.abort.cancel")}
            </Button>
            <Button variant="danger" onClick={onConfirmAbort}>
              {t("status.abort.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Header -------------------------------------------------------------

function StatusHeader({
  bookingId,
  centreName,
  etaLabel,
  etaUnit,
  progressPct,
  ariaLabel,
  liveLabel,
  currentStatus,
  currentStatusLabel,
}: {
  bookingId: string;
  centreName: string;
  etaLabel: string;
  etaUnit: string;
  progressPct: number;
  ariaLabel: string;
  liveLabel: string;
  currentStatus: string;
  currentStatusLabel: string;
}): React.JSX.Element {
  return (
    <GlassPanel
      variant="elevated"
      aria-label={ariaLabel}
      as="section"
      className="relative isolate overflow-hidden !p-0"
    >
      <AmbientGlow tone="copper" className="!inset-[-30%_-20%_auto_auto] !w-[60%] !h-[80%] opacity-50" />
      <AmbientGlow tone="sky" className="!inset-[auto_auto_-40%_-20%] !w-[60%] !h-[60%] opacity-40" />
      <div className="relative z-10 flex flex-col gap-8 px-8 py-9 md:flex-row md:items-end md:justify-between md:gap-12 md:px-12">
        <div className="flex flex-col gap-3">
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase text-pearl-soft">
            {bookingId}
          </span>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-medium tracking-[var(--tracking-tight)] text-pearl">
            {centreName}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-control)] text-pearl-muted">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="luxe-pulse-dot" />
              <span>{liveLabel}</span>
            </span>
            <span aria-hidden="true" className="text-pearl-faint">·</span>
            <span>
              <span className="text-pearl-soft">{currentStatusLabel}: </span>
              <span className="text-pearl">{currentStatus}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <SpecLabel>{etaUnit}</SpecLabel>
          <SpecValue value={etaLabel} size="xl" />
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPct)}
        aria-label={ariaLabel}
        className="relative z-10 h-[3px] w-full bg-[var(--color-hairline)]"
      >
        <div
          aria-hidden="true"
          className="h-full transition-[width]"
          style={{
            width: `${progressPct}%`,
            background:
              "linear-gradient(90deg, var(--color-accent-sky) 0%, var(--color-copper) 100%)",
          }}
        />
      </div>
      <style>{`
        .luxe-pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--color-copper);
          box-shadow: 0 0 12px rgba(201,163,106,0.6);
          animation: luxe-pulse 1.6s ease-in-out infinite;
          display: inline-block;
        }
        @keyframes luxe-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.85); }
        }
        @media (prefers-reduced-motion: reduce) {
          .luxe-pulse-dot { animation: none; }
        }
      `}</style>
    </GlassPanel>
  );
}

// ---- Route preview ------------------------------------------------------

function RoutePreview({
  ariaLabel,
  alt,
  progressPct,
}: {
  ariaLabel: string;
  alt: string;
  progressPct: number;
}): React.JSX.Element {
  const dotStyle: CSSProperties = {
    left: `${Math.max(2, Math.min(98, progressPct))}%`,
  };
  return (
    <GlassPanel
      variant="muted"
      role="img"
      aria-label={alt}
      className="relative isolate overflow-hidden !p-0"
    >
      <span className="sr-only">{ariaLabel}</span>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(180deg, rgba(8,9,12,0.55) 0%, rgba(8,9,12,0.7) 100%), url("/images/route-topo.webp"), linear-gradient(135deg, #11151d 0%, #161b25 60%, #1b2230 100%)',
          backgroundSize: "cover, cover, cover",
          backgroundPosition: "center",
          opacity: 1,
          filter: "saturate(110%)",
        }}
      />
      {/* SVG topographic fallback — paints when route-topo.jpg is absent. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1200 280"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full opacity-[0.32]"
      >
        <defs>
          <linearGradient id="topo-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(242,238,230,0.0)" />
            <stop offset="50%" stopColor="rgba(242,238,230,0.55)" />
            <stop offset="100%" stopColor="rgba(242,238,230,0.0)" />
          </linearGradient>
        </defs>
        {[40, 78, 116, 162, 202, 240].map((y, i) => (
          <path
            key={y}
            d={`M0 ${y} C 200 ${y - (i % 2 === 0 ? 18 : -14)}, 480 ${y + 22}, 720 ${y - 14} S 1100 ${y + 18}, 1200 ${y - (i % 2 === 0 ? 8 : 12)}`}
            fill="none"
            stroke="url(#topo-line)"
            strokeWidth={i === 3 ? 1.2 : 0.7}
          />
        ))}
        <path
          d="M0 140 C 240 110, 460 168, 720 130 S 1080 152, 1200 138"
          fill="none"
          stroke="rgba(201,163,106,0.55)"
          strokeWidth="1.4"
          strokeDasharray="4 6"
        />
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 8% 70%, rgba(79,183,255,0.20), transparent 38%), radial-gradient(circle at 92% 25%, rgba(201,163,106,0.22), transparent 40%)",
        }}
      />
      <div className="relative z-10 h-[180px] w-full md:h-[220px]">
        <div
          aria-hidden="true"
          className="absolute top-1/2 h-px w-full -translate-y-1/2"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 12%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0.18) 88%, transparent 100%)",
          }}
        />
        <span
          aria-hidden="true"
          className="luxe-route-dot absolute top-1/2 -translate-y-1/2"
          style={dotStyle}
        />
        <span
          aria-hidden="true"
          className="absolute left-[8%] top-1/2 -translate-y-1/2"
          style={{ width: 8, height: 8, borderRadius: 999, background: "var(--color-pearl-muted)" }}
        />
        <span
          aria-hidden="true"
          className="absolute right-[8%] top-1/2 -translate-y-1/2"
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "var(--color-copper)",
            boxShadow: "0 0 14px rgba(201,163,106,0.65)",
          }}
        />
      </div>
      <style>{`
        .luxe-route-dot {
          width: 12px;
          height: 12px;
          border-radius: 999px;
          background: radial-gradient(circle, #F1D9A3 0%, var(--color-copper) 60%, var(--color-copper-deep) 100%);
          box-shadow: 0 0 18px rgba(201,163,106,0.85), 0 0 4px rgba(255,255,255,0.4);
          animation: luxe-route-pulse 2.2s ease-in-out infinite;
          transition: left 720ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes luxe-route-pulse {
          0%, 100% { transform: translateY(-50%) scale(1); }
          50% { transform: translateY(-50%) scale(1.18); }
        }
        @media (prefers-reduced-motion: reduce) {
          .luxe-route-dot { animation: none; transition: none; }
        }
      `}</style>
    </GlassPanel>
  );
}

// ---- Timeline -----------------------------------------------------------

interface StepRow {
  key: StepKey;
  state: "done" | "current" | "future";
}

function Timeline({
  rows,
  currentTimestamp,
  getStepLabel,
  getStepBody,
  ariaLabel,
  stateLabels,
  currentLabel,
}: {
  rows: StepRow[];
  currentTimestamp: string;
  getStepLabel: (k: StepKey) => string;
  getStepBody: (k: StepKey) => string;
  ariaLabel: string;
  stateLabels: Record<"done" | "current" | "future", string>;
  currentLabel: string;
}): React.JSX.Element {
  return (
    <ol aria-label={ariaLabel} role="list" className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} role="listitem">
          <TimelineRow
            row={row}
            label={getStepLabel(row.key)}
            body={getStepBody(row.key)}
            timestamp={row.state === "current" ? currentTimestamp : ""}
            stateLabel={stateLabels[row.state]}
            currentLabel={currentLabel}
          />
        </li>
      ))}
    </ol>
  );
}

function TimelineRow({
  row,
  label,
  body,
  timestamp,
  stateLabel,
  currentLabel,
}: {
  row: StepRow;
  label: string;
  body: string;
  timestamp: string;
  stateLabel: string;
  currentLabel: string;
}): React.JSX.Element {
  const isCurrent = row.state === "current";
  return (
    <GlassPanel
      variant={isCurrent ? "elevated" : "default"}
      className={cn(
        "relative isolate overflow-hidden !py-5",
        isCurrent && "luxe-timeline-current",
      )}
    >
      {isCurrent ? (
        <AmbientGlow tone="copper" className="!inset-[auto_-40%_-60%_auto] !w-[80%] !h-[160%] opacity-30" />
      ) : null}
      <div className="relative z-10 flex items-start gap-4">
        <Indicator state={row.state} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <SpecLabel>{label}</SpecLabel>
            <span aria-hidden="true" className="text-pearl-faint">·</span>
            <span className="text-[length:var(--text-caption)] tracking-[var(--tracking-wide)] uppercase text-pearl-soft">
              {isCurrent ? currentLabel : stateLabel}
            </span>
          </div>
          <p className="mt-2 text-[length:var(--text-control)] leading-[1.6] text-pearl">{body}</p>
        </div>
        {timestamp ? (
          <span className="luxe-mono shrink-0 text-[length:var(--text-caption)] uppercase text-pearl-soft">
            {timestamp}
          </span>
        ) : null}
      </div>
      <style>{`
        .luxe-timeline-current {
          border-color: rgba(201, 163, 106, 0.32);
        }
      `}</style>
    </GlassPanel>
  );
}

function Indicator({ state }: { state: "done" | "current" | "future" }): React.JSX.Element {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(31,143,102,0.95) 0%, rgba(21,105,74,1) 70%)",
          boxShadow: "0 0 0 1px rgba(31,143,102,0.45)",
        }}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path
            d="M3 8.5 L7 12 L13 4.5"
            stroke="#04101E"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span aria-hidden="true" className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="luxe-indicator-current" />
        <style>{`
          .luxe-indicator-current {
            width: 14px;
            height: 14px;
            border-radius: 999px;
            background: radial-gradient(circle, #F1D9A3 0%, var(--color-copper) 60%, var(--color-copper-deep) 100%);
            box-shadow: 0 0 0 4px rgba(201,163,106,0.18), 0 0 14px rgba(201,163,106,0.6);
            animation: luxe-current-pulse 1.8s ease-in-out infinite;
          }
          @keyframes luxe-current-pulse {
            0%, 100% { box-shadow: 0 0 0 4px rgba(201,163,106,0.18), 0 0 14px rgba(201,163,106,0.6); }
            50% { box-shadow: 0 0 0 6px rgba(201,163,106,0.10), 0 0 20px rgba(201,163,106,0.85); }
          }
          @media (prefers-reduced-motion: reduce) {
            .luxe-indicator-current { animation: none; }
          }
        `}</style>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center"
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          border: "1px solid var(--color-hairline-strong)",
          background: "transparent",
        }}
      />
    </span>
  );
}

// ---- Side panel: wellbeing + ETA + the latest message -------------------

function SidePanel({
  wellbeingValue,
  wellbeingLabel,
  etaLabel,
  etaValue,
  etaUnit,
  message,
}: {
  wellbeingValue: number;
  wellbeingLabel: string;
  etaLabel: string;
  etaValue: number;
  etaUnit: string;
  message: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <GlassPanel className="flex flex-col gap-6">
        <KPIBlock
          label={wellbeingLabel}
          value={wellbeingValue}
          unit="of 100"
          status={wellbeingValue >= 80 ? "ok" : wellbeingValue >= 60 ? "watch" : "alert"}
        />
        <div aria-hidden="true" className="luxe-status-line ok" />
        <KPIBlock
          label={etaLabel}
          value={etaValue}
          unit={etaUnit}
          status="ok"
          size="md"
        />
      </GlassPanel>
      {message ? (
        <GlassPanel variant="muted" className="flex items-start gap-4">
          <GoldSeal size={20} label="explanation" />
          <p className="text-[length:var(--text-control)] leading-[1.6] text-pearl">{message}</p>
        </GlassPanel>
      ) : null}
    </div>
  );
}

// ---- Concierge log expander --------------------------------------------

function ConciergeLog({
  id,
  open,
  onToggle,
  frames,
  title,
  hint,
  empty,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  frames: TickerFrame[];
  title: string;
  hint: string;
  empty: string;
}): React.JSX.Element {
  return (
    <GlassPanel variant="muted" className="!p-0 overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-pearl hover:[background:rgba(255,255,255,0.02)]"
      >
        <span className="flex items-center gap-3">
          <SpecLabel>{title}</SpecLabel>
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase text-pearl-soft">
            {frames.length}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-pearl-soft transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M3 6 L8 11 L13 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open ? (
        <div id={id} className="border-t border-[var(--color-hairline)] px-6 py-5">
          {frames.length === 0 ? (
            <p className="text-[length:var(--text-control)] text-pearl-muted">{empty}</p>
          ) : (
            <>
              <p className="mb-4 text-[length:var(--text-caption)] tracking-[var(--tracking-wide)] text-pearl-soft">
                {hint}
              </p>
              <ol className="flex flex-col gap-3">
                {frames.map((f, i) => (
                  <li
                    key={`${f.at}-${i}`}
                    className="flex items-start gap-4 border-l border-[var(--color-hairline)] pl-4"
                  >
                    <span className="luxe-mono w-16 shrink-0 text-[length:var(--text-caption)] text-pearl-soft">
                      {formatTime(f.at)}
                    </span>
                    <div className="flex-1">
                      <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-wide)] text-pearl-muted">
                        {f.status}
                      </span>
                      <p className="mt-1 text-[length:var(--text-control)] leading-[1.55] text-pearl">
                        {f.message}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ) : null}
    </GlassPanel>
  );
}

// ---- Footer row: booking id + abort -------------------------------------

function FooterRow({
  bookingId,
  bookingIdLabel,
  abortLabel,
  onAbort,
}: {
  bookingId: string;
  bookingIdLabel: string;
  abortLabel: string;
  onAbort: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1">
        <SpecLabel>{bookingIdLabel}</SpecLabel>
        <span className="luxe-mono text-[length:var(--text-control)] uppercase text-pearl">
          {bookingId}
        </span>
      </div>
      <Button variant="ghost" onClick={onAbort}>
        {abortLabel}
      </Button>
    </div>
  );
}

