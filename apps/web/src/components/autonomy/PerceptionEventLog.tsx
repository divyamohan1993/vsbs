"use client";

// Live perception / safety / scenario event log — 40-line tail, stamped
// with category and severity, fed by /v1/autonomy/:id/events/sse.

import { GlassPanel, SpecLabel } from "../luxe";
import { StatusPill } from "./luxe/StatusPill";
import {
  usePerceptionEvents,
  type PerceptionEvent,
  type PerceptionSeverity,
} from "./usePerceptionEvents";

interface Props {
  bookingId: string;
}

const SEV_TONE: Record<PerceptionSeverity, "ok" | "watch" | "halt" | "neutral"> = {
  info: "neutral",
  watch: "watch",
  alert: "halt",
  critical: "halt",
};

export function PerceptionEventLog({ bookingId }: Props): React.JSX.Element {
  const { events, connected } = usePerceptionEvents(bookingId);
  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <SpecLabel>Live event log</SpecLabel>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h3)] text-pearl">
            Perception · safety · scenario
          </h2>
        </div>
        <StatusPill tone={connected ? "live" : "neutral"} size="sm">
          {connected ? "STREAM LIVE" : "AWAITING STREAM"}
        </StatusPill>
      </header>
      <GlassPanel variant="muted" className="!p-0 max-h-[420px] overflow-auto">
        {events.length === 0 ? (
          <div className="px-5 py-6 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            no events yet — waiting on the perception stream
          </div>
        ) : (
          <ul>
            {events.map((ev) => (
              <EventRow key={(ev.seq ?? 0) + ev.ts} event={ev} />
            ))}
          </ul>
        )}
      </GlassPanel>
    </section>
  );
}

function EventRow({ event }: { event: PerceptionEvent }): React.JSX.Element {
  const tone = SEV_TONE[event.severity];
  const time = formatTime(event.ts);
  return (
    <li className="border-t border-[var(--color-hairline)] px-5 py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="luxe-mono tabular-nums text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            {time}
          </span>
          <StatusPill tone={tone} size="sm">
            {event.category}
          </StatusPill>
          <span className="text-[length:var(--text-control)] text-pearl truncate">{event.title}</span>
        </div>
        <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          {event.severity}
        </span>
      </div>
      {event.detail ? (
        <p className="mt-1 text-[length:var(--text-control)] text-pearl-soft">{event.detail}</p>
      ) : null}
    </li>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return "--:--:--";
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
