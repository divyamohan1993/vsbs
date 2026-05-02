// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// Archived run view. We re-subscribe to the same progress SSE stream that the
// runner uses; the backend replays the full cached event list on connect, so
// this page renders the same timeline a refresh-mid-run would have shown.

"use client";

import { useEffect, useRef, useState } from "react";
import { readSse } from "../../../lib/sse";
import {
  RecordingsTimeline,
  type RecordingProgressEvent,
} from "../../../components/recordings/RecordingsTimeline";
import { DownloadCard } from "../../../components/recordings/DownloadCard";
import { ToastProvider, useToast } from "../../../components/ui/Toast";
import type { RecordingSummary } from "../../../components/recordings/RecordingsHistoryList";

interface Props {
  summary: RecordingSummary;
  fileUrl: string;
  posterUrl: string;
}

export function RecordingArchive(props: Props): React.JSX.Element {
  return (
    <ToastProvider>
      <RecordingArchiveInner {...props} />
    </ToastProvider>
  );
}

function RecordingArchiveInner({
  summary,
  fileUrl,
  posterUrl,
}: Props): React.JSX.Element {
  const toast = useToast();
  const [events, setEvents] = useState<RecordingProgressEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function subscribe(): Promise<void> {
      try {
        const res = await fetch(
          `/api/proxy/recordings/${encodeURIComponent(summary.id)}/progress/sse`,
          {
            method: "GET",
            headers: { accept: "text/event-stream" },
            signal: ctrl.signal,
          },
        );
        if (!res.ok || !res.body) return;
        if (cancelled) return;
        setConnected(true);
        for await (const frame of readSse(res.body)) {
          if (cancelled) break;
          if (frame.event !== "progress") {
            if (frame.event === "end") break;
            continue;
          }
          try {
            const raw = JSON.parse(frame.data) as Record<string, unknown>;
            const ts = typeof raw.ts === "string" ? raw.ts : null;
            const category = raw.category;
            const severity = raw.severity;
            const title = typeof raw.title === "string" ? raw.title : null;
            if (!ts || !title) continue;
            if (
              category !== "recording" &&
              category !== "carla" &&
              category !== "bridge" &&
              category !== "scenario" &&
              category !== "encoding" &&
              category !== "done"
            ) {
              continue;
            }
            if (severity !== "info" && severity !== "watch" && severity !== "alert") continue;
            seqRef.current += 1;
            const ev: RecordingProgressEvent = {
              ts,
              category,
              severity,
              title,
              seq: seqRef.current,
            };
            if (typeof raw.detail === "string") ev.detail = raw.detail;
            if (raw.data && typeof raw.data === "object") {
              ev.data = raw.data as Record<string, unknown>;
            }
            setEvents((prev) => [...prev, ev]);
          } catch {
            /* skip malformed */
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      } finally {
        if (!cancelled) setConnected(false);
      }
    }

    void subscribe();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [summary.id]);

  return (
    <div className="flex flex-col gap-8">
      <RecordingsTimeline
        events={events}
        connected={connected}
        ariaLabel="Archived recording timeline"
        emptyHint="replaying timeline — waiting on the cached events"
      />
      {summary.status === "done" ? (
        <DownloadCard
          fileUrl={fileUrl}
          posterUrl={posterUrl}
          sizeBytes={summary.sizeBytes ?? 0}
          durationS={summary.durationS}
          encoder={summary.encoder ?? "h264"}
          onCopyLink={() =>
            toast.push({ title: "Copied", description: "Share link is on your clipboard." })
          }
          onCopyError={(msg) =>
            toast.push({ title: "Copy failed", description: msg, tone: "warning" })
          }
        />
      ) : null}
    </div>
  );
}
