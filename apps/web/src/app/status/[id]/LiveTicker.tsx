"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface TickerEvent {
  status: string;
  etaMinutes: number;
  wellbeing: number;
  message: string;
}

const DEMO_TIMELINE: TickerEvent[] = [
  {
    status: "dispatched",
    etaMinutes: 28,
    wellbeing: 0.78,
    message: "Technician Ravi is finishing a brake reseal. 28 minutes to you.",
  },
  {
    status: "en-route",
    etaMinutes: 18,
    wellbeing: 0.82,
    message: "Ravi has left the workshop and is on the highway. 18 minutes.",
  },
  {
    status: "en-route",
    etaMinutes: 9,
    wellbeing: 0.85,
    message: "Light traffic near the flyover. 9 minutes away.",
  },
  {
    status: "arriving",
    etaMinutes: 2,
    wellbeing: 0.9,
    message: "Ravi is at your gate in 2 minutes. He will call before knocking.",
  },
];

export function LiveTicker({ id }: { id: string }): React.JSX.Element {
  const t = useTranslations();
  const [event, setEvent] = useState<TickerEvent>(DEMO_TIMELINE[0]!);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    try {
      es = new EventSource(`/api/proxy/bookings/${encodeURIComponent(id)}/stream`);
      es.onopen = () => {
        if (!cancelled) setConnected(true);
      };
      const handleFrame = (msg: MessageEvent<string>) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(msg.data) as {
            status: string;
            etaMinutes: number;
            wellbeing: number;
            explanation?: string;
            message?: string;
          };
          setEvent({
            status: parsed.status,
            etaMinutes: parsed.etaMinutes,
            wellbeing: parsed.wellbeing,
            message: parsed.explanation ?? parsed.message ?? "",
          });
        } catch {
          /* ignore malformed frames */
        }
      };
      es.addEventListener("frame", handleFrame as EventListener);
      es.addEventListener("end", () => {
        if (es) {
          es.close();
          es = null;
        }
      });
      es.onmessage = handleFrame;
      es.onerror = () => {
        // Upstream stream not implemented yet — fall back to demo timeline.
        if (es) {
          es.close();
          es = null;
        }
        if (!cancelled && interval === null) {
          let i = 0;
          interval = setInterval(() => {
            i = (i + 1) % DEMO_TIMELINE.length;
            setEvent(DEMO_TIMELINE[i]!);
          }, 4000);
        }
      };
    } catch {
      let i = 0;
      interval = setInterval(() => {
        i = (i + 1) % DEMO_TIMELINE.length;
        setEvent(DEMO_TIMELINE[i]!);
      }, 4000);
    }

    return () => {
      cancelled = true;
      if (es) es.close();
      if (interval) clearInterval(interval);
    };
  }, [id]);

  return (
    <div className="space-y-4">
      <output
        aria-live="polite"
        className="block space-y-3 rounded-[var(--radius-card)] border border-muted/30 p-6"
      >
        <span className="block text-xs uppercase tracking-wider text-muted">
          {t("status.current")}
        </span>
        <span className="block font-display text-2xl font-semibold text-on-surface">
          {event.status}
        </span>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-muted">{t("status.eta")}</dt>
            <dd className="text-xl font-semibold text-on-surface">
              {t("status.minutes", { n: event.etaMinutes })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">{t("status.wellbeing")}</dt>
            <dd className="text-xl font-semibold text-on-surface">
              {Math.round(event.wellbeing * 100)}
            </dd>
          </div>
        </dl>
        <p className="text-on-surface">{event.message}</p>
        <span className="block text-xs text-muted">
          {connected ? t("status.live") : t("status.simulated")}
        </span>
      </output>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-[var(--radius-card)] border-2 border-muted/40 px-4 py-2 text-sm font-medium text-on-surface"
      >
        {t("status.override")}
      </button>
    </div>
  );
}
