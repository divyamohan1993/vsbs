// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// History of completed recording runs. Each row links to /recordings/<id>.
// The row layout matches the rest of the luxe surfaces: small caps eyebrow,
// serif label, mono metadata. Empty state is a quiet card pointing back to
// /recordings/new.

import Link from "next/link";
import { GlassPanel, SpecLabel } from "../luxe";
import { StatusPill, type StatusPillTone } from "../autonomy/luxe/StatusPill";
import {
  prettyBytes,
  prettyDuration,
  prettyTime,
  shortId,
} from "../../lib/recordings";

export type RecordingStatus =
  | "queued"
  | "starting"
  | "running"
  | "encoding"
  | "done"
  | "error";

export interface RecordingSummary {
  id: string;
  startedAt: string;
  durationS: number;
  useCarlaIfAvailable: boolean;
  label?: string;
  status: RecordingStatus;
  encoder?: string;
  sizeBytes?: number;
  completedAt?: string;
  errorMessage?: string;
}

const STATUS_TONE: Record<RecordingStatus, StatusPillTone> = {
  queued: "neutral",
  starting: "watch",
  running: "live",
  encoding: "watch",
  done: "ok",
  error: "halt",
};

interface Props {
  items: RecordingSummary[];
}

export function RecordingsHistoryList({ items }: Props): React.JSX.Element {
  if (items.length === 0) {
    return (
      <GlassPanel variant="muted">
        <div className="flex flex-col gap-3">
          <SpecLabel>History</SpecLabel>
          <p className="text-[length:var(--text-body)] text-pearl">
            No demo runs yet — kick one off.
          </p>
          <Link
            href={{ pathname: "/recordings/new" }}
            className="luxe-btn-primary inline-flex min-h-[44px] w-fit items-center justify-center gap-2 rounded-[var(--radius-sm)] px-5 py-2 text-[length:var(--text-control)] font-medium tracking-[var(--tracking-wide)]"
          >
            Record a demo
          </Link>
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel variant="muted" className="!p-0">
      <ul className="divide-y divide-[var(--color-hairline)]">
        {items.map((it) => (
          <li key={it.id}>
            <Link
              href={{ pathname: `/recordings/${it.id}` }}
              className="flex flex-col gap-2 px-5 py-4 hover:bg-white/[0.02] focus-visible:bg-white/[0.04] focus-visible:outline-none md:flex-row md:items-center md:justify-between md:gap-6"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                  RUN {shortId(it.id)}
                </span>
                <span className="text-[length:var(--text-control)] text-pearl truncate">
                  {it.label ?? "Untitled run"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill tone={STATUS_TONE[it.status]} size="sm">
                  {it.status}
                </StatusPill>
                <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
                  {prettyTime(it.startedAt)}
                </span>
                <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
                  {prettyDuration(it.durationS)}
                </span>
                {typeof it.sizeBytes === "number" ? (
                  <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
                    {prettyBytes(it.sizeBytes)}
                  </span>
                ) : null}
                {it.encoder ? (
                  <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
                    {it.encoder.toUpperCase()}
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
}
