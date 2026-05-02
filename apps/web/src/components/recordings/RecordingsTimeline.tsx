// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// One-column, monospaced, append-only timeline of recording-progress events.
// Visual language is intentionally identical to PerceptionEventLog so the two
// streams feel like siblings: HH:MM:SS · category-pill · title · severity tag,
// with an optional muted detail line beneath. The component is purely
// presentational; the parent owns the events array and any auto-scroll DOM.

import { GlassPanel, SpecLabel } from "../luxe";
import { StatusPill, type StatusPillTone } from "../autonomy/luxe/StatusPill";
import { prettyTime } from "../../lib/recordings";

export type RecordingProgressCategory =
  | "recording"
  | "carla"
  | "bridge"
  | "scenario"
  | "encoding"
  | "done";

export type RecordingProgressSeverity = "info" | "watch" | "alert";

export interface RecordingProgressEvent {
  ts: string;
  category: RecordingProgressCategory;
  severity: RecordingProgressSeverity;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
  seq?: number;
}

interface Props {
  events: RecordingProgressEvent[];
  connected?: boolean;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  emptyHint?: string;
  ariaLabel?: string;
}

const SEV_TONE: Record<RecordingProgressSeverity, StatusPillTone> = {
  info: "neutral",
  watch: "watch",
  alert: "halt",
};

export function RecordingsTimeline({
  events,
  connected = true,
  scrollRef,
  emptyHint = "no events yet — waiting on the recording stream",
  ariaLabel = "Recording timeline",
}: Props): React.JSX.Element {
  return (
    <section className="space-y-4" aria-label={ariaLabel}>
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col">
          <SpecLabel>Live timeline</SpecLabel>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h3)] text-pearl">
            Recording · CARLA · bridge · encoding
          </h2>
        </div>
        <StatusPill tone={connected ? "live" : "neutral"} size="sm">
          {connected ? "STREAM LIVE" : "AWAITING STREAM"}
        </StatusPill>
      </header>
      <GlassPanel variant="muted" className="!p-0 max-h-[480px] overflow-auto">
        <div ref={scrollRef ?? null}>
          {events.length === 0 ? (
            <div className="px-5 py-6 luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              {emptyHint}
            </div>
          ) : (
            <ul>
              {events.map((ev, idx) => (
                <EventRow
                  key={`${ev.seq ?? idx}-${ev.ts}-${ev.title}`}
                  event={ev}
                />
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>
    </section>
  );
}

function EventRow({ event }: { event: RecordingProgressEvent }): React.JSX.Element {
  const tone = SEV_TONE[event.severity];
  return (
    <li className="border-t border-[var(--color-hairline)] px-5 py-3 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="luxe-mono tabular-nums text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            {prettyTime(event.ts)}
          </span>
          <StatusPill tone={tone} size="sm">
            {event.category}
          </StatusPill>
          <span className="text-[length:var(--text-control)] text-pearl truncate">
            {event.title}
          </span>
        </div>
        <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          {event.severity}
        </span>
      </div>
      {event.detail ? (
        <p className="mt-1 text-[length:var(--text-control)] text-pearl-soft">
          {event.detail}
        </p>
      ) : null}
    </li>
  );
}
