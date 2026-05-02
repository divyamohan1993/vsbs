// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { GlassPanel, SpecLabel } from "../../../components/luxe";
import { StatusPill, type StatusPillTone } from "../../../components/autonomy/luxe/StatusPill";
import {
  prettyBytes,
  prettyDuration,
  prettyTime,
  shortId,
} from "../../../lib/recordings";
import { RecordingArchive } from "./RecordingArchive";
import type { RecordingSummary } from "../../../components/recordings/RecordingsHistoryList";

export const dynamic = "force-dynamic";

const API_BASE = process.env.VSBS_API_BASE ?? "http://localhost:8787";

const STATUS_TONE: Record<RecordingSummary["status"], StatusPillTone> = {
  queued: "neutral",
  starting: "watch",
  running: "live",
  encoding: "watch",
  done: "ok",
  error: "halt",
};

interface SummaryResponse {
  data: RecordingSummary;
}

async function loadSummary(id: string): Promise<RecordingSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/recordings/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const body = (await res.json()) as SummaryResponse;
    return body.data;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Recording ${shortId(id)} · VSBS`,
    description: "Archived demo recording of the VSBS autonomy stack.",
  };
}

export default async function RecordingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const summary = await loadSummary(id);
  if (!summary) notFound();

  const fileUrl = `/api/proxy/recordings/${encodeURIComponent(id)}/file`;
  const posterUrl = `/api/proxy/recordings/${encodeURIComponent(id)}/poster.jpg`;

  return (
    <section
      aria-labelledby="recording-detail-h"
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 py-6"
    >
      <GlassPanel variant="muted" as="section" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SpecLabel>Recording · archive</SpecLabel>
          <Link
            href={{ pathname: "/recordings" }}
            className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft hover:text-pearl"
          >
            ← All runs
          </Link>
        </div>
        <h1
          id="recording-detail-h"
          className="font-[family-name:var(--font-display)] text-[length:var(--text-h1)] text-pearl"
        >
          {summary.label ?? `Run ${shortId(summary.id)}`}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={STATUS_TONE[summary.status]}>{summary.status}</StatusPill>
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
            STARTED {prettyTime(summary.startedAt)}
          </span>
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
            {prettyDuration(summary.durationS)}
          </span>
          {typeof summary.sizeBytes === "number" ? (
            <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
              {prettyBytes(summary.sizeBytes)}
            </span>
          ) : null}
          {summary.encoder ? (
            <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
              {summary.encoder.toUpperCase()}
            </span>
          ) : null}
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            {summary.useCarlaIfAvailable ? "CARLA IF AVAILABLE" : "CHAOS DRIVER"}
          </span>
        </div>
        {summary.errorMessage ? (
          <p className="text-[length:var(--text-control)] text-pearl">
            {summary.errorMessage}
          </p>
        ) : null}
      </GlassPanel>

      <RecordingArchive summary={summary} fileUrl={fileUrl} posterUrl={posterUrl} />
    </section>
  );
}
