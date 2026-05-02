// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// Client component that drives one demo-recording run end to end.
//
// State machine:
//   idle → starting → running → encoding → done | error
// One AbortController owns the SSE connection. On a transient drop we wait one
// second and reconnect. The server replays cached events on reconnect, so the
// timeline rebuilds itself across a refresh too — we keep the active id in
// sessionStorage for that exact reason.
//
// CSP-clean. No inline event handlers. No dynamic <style> blocks.

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { readSse } from "../../../lib/sse";
import {
  RecordingsTimeline,
  type RecordingProgressEvent,
} from "../../../components/recordings/RecordingsTimeline";
import { DownloadCard } from "../../../components/recordings/DownloadCard";
import { GlassPanel, SpecLabel } from "../../../components/luxe";
import { StatusPill } from "../../../components/autonomy/luxe/StatusPill";
import { Button } from "../../../components/ui/Button";
import { ToastProvider, useToast } from "../../../components/ui/Toast";
import { shortId } from "../../../lib/recordings";

const STORAGE_KEY = "vsbs.recording.active";
const TIMELINE_CAP = 500;

const DURATION_OPTIONS = [
  { value: 60, label: "60 s · smoke check" },
  { value: 180, label: "180 s · standard demo" },
  { value: 330, label: "330 s · full chaos scenario" },
] as const;

type RunState = "idle" | "starting" | "running" | "encoding" | "done" | "error";

interface ActiveRecording {
  id: string;
  startedAt: string;
  fileUrl: string;
  posterUrl: string;
  statusSseUrl: string;
  durationS: number;
  useCarlaIfAvailable: boolean;
}

interface DownloadPayload {
  url: string;
  posterUrl: string;
  sizeBytes: number;
  durationS: number;
  encoder: string;
}

interface StartResponse {
  data: {
    id: string;
    startedAt: string;
    statusSseUrl: string;
    fileUrl: string;
    posterUrl: string;
  };
}

interface SummaryResponse {
  data: {
    id: string;
    startedAt: string;
    durationS: number;
    useCarlaIfAvailable: boolean;
    label?: string;
    status: RunState | "queued";
    encoder?: string;
    sizeBytes?: number;
    completedAt?: string;
    errorMessage?: string;
  };
}

export function RecordingsRunner(): React.JSX.Element {
  return (
    <ToastProvider>
      <RecordingsRunnerInner />
    </ToastProvider>
  );
}

function RecordingsRunnerInner(): React.JSX.Element {
  const toast = useToast();
  const [state, setState] = useState<RunState>("idle");
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [events, setEvents] = useState<RecordingProgressEvent[]>([]);
  const [download, setDownload] = useState<DownloadPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);

  const [durationS, setDurationS] = useState<number>(180);
  const [useCarla, setUseCarla] = useState<boolean>(true);
  const [label, setLabel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const seqRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  const appendEvent = useCallback((ev: RecordingProgressEvent): void => {
    seqRef.current += 1;
    const stamped: RecordingProgressEvent = { ...ev, seq: seqRef.current };
    setEvents((prev) => {
      const next = [...prev, stamped];
      return next.length > TIMELINE_CAP ? next.slice(next.length - TIMELINE_CAP) : next;
    });
  }, []);

  const stopStream = useCallback((): void => {
    if (ctrlRef.current) {
      ctrlRef.current.abort();
      ctrlRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
  }, []);

  const beginStream = useCallback(
    (recording: ActiveRecording): void => {
      stopStream();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      const subscribe = async (): Promise<void> => {
        try {
          const res = await fetch(
            `/api/proxy/recordings/${encodeURIComponent(recording.id)}/progress/sse`,
            {
              method: "GET",
              headers: { accept: "text/event-stream" },
              signal: ctrl.signal,
            },
          );
          if (!res.ok || !res.body) {
            throw new Error(`Stream returned ${res.status}`);
          }
          setConnected(true);
          for await (const frame of readSse(res.body)) {
            if (ctrl.signal.aborted) break;
            if (frame.event === "ping") continue;
            try {
              const parsed = JSON.parse(frame.data) as Record<string, unknown>;
              if (frame.event === "progress") {
                const progress = toProgressEvent(parsed);
                if (progress) {
                  appendEvent(progress);
                  if (progress.category === "encoding") setState("encoding");
                  else if (
                    progress.category === "recording" ||
                    progress.category === "carla" ||
                    progress.category === "bridge" ||
                    progress.category === "scenario"
                  ) {
                    setState((s) => (s === "starting" || s === "idle" ? "running" : s));
                  }
                }
              } else if (frame.event === "download") {
                const dl = toDownloadPayload(parsed);
                if (dl) {
                  setDownload(dl);
                  setState("done");
                  appendEvent({
                    ts: new Date().toISOString(),
                    category: "done",
                    severity: "info",
                    title: "Recording ready for download",
                    detail: `${dl.encoder.toUpperCase()} · ${dl.sizeBytes} bytes`,
                  });
                }
              } else if (frame.event === "error") {
                const message =
                  typeof parsed.message === "string" ? parsed.message : "Recording failed";
                setErrorMessage(message);
                setState("error");
                appendEvent({
                  ts: new Date().toISOString(),
                  category: "recording",
                  severity: "alert",
                  title: "Recording error",
                  detail: message,
                });
              } else if (frame.event === "end") {
                break;
              }
            } catch {
              /* ignore malformed frame */
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          setConnected(false);
          if (!ctrl.signal.aborted) {
            reconnectRef.current = setTimeout(() => {
              if (!ctrl.signal.aborted) void subscribe();
            }, 1000);
            return;
          }
        } finally {
          if (!ctrl.signal.aborted) setConnected(false);
        }
      };

      void subscribe();
    },
    [appendEvent, stopStream],
  );

  // On mount, look for an active recording in sessionStorage and either
  // resume the timeline or surface the download card if it already finished.
  useEffect(() => {
    let cancelled = false;
    const restored = readSession();
    if (!restored) return;
    setActive(restored);
    setState("starting");

    async function rehydrate(): Promise<void> {
      try {
        const res = await fetch(
          `/api/proxy/recordings/${encodeURIComponent(restored!.id)}`,
          { method: "GET" },
        );
        if (cancelled) return;
        if (res.status === 404) {
          clearSession();
          setActive(null);
          setState("idle");
          return;
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as SummaryResponse;
        if (cancelled) return;
        const status = body.data.status;
        if (status === "done") {
          setDownload({
            url: restored!.fileUrl,
            posterUrl: restored!.posterUrl,
            sizeBytes: body.data.sizeBytes ?? 0,
            durationS: body.data.durationS,
            encoder: body.data.encoder ?? "h264",
          });
          setState("done");
          return;
        }
        if (status === "error") {
          setErrorMessage(body.data.errorMessage ?? "Recording failed");
          setState("error");
          return;
        }
        beginStream(restored!);
      } catch {
        if (cancelled) return;
        beginStream(restored!);
      }
    }

    void rehydrate();
    return () => {
      cancelled = true;
    };
  }, [beginStream]);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  // Auto-scroll the timeline to the latest event, unless the user is hovering
  // it (so they can read), and unless they prefer reduced motion.
  useEffect(() => {
    if (paused) return;
    if (reducedMotion) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [events, paused, reducedMotion]);

  // Clear the sessionStorage key on terminal states.
  useEffect(() => {
    if (state === "done" || state === "error") {
      clearSession();
    }
  }, [state]);

  const onStart = useCallback(async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const trimmed = label.trim();
      const res = await fetch("/api/proxy/recordings/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          durationS,
          useCarlaIfAvailable: useCarla,
          ...(trimmed ? { label: trimmed.slice(0, 80) } : {}),
        }),
      });
      if (res.status === 409) {
        toast.push({
          title: "Already running",
          description: "Another recording is already in progress.",
          tone: "warning",
        });
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Start failed (${res.status}): ${txt}`);
      }
      const body = (await res.json()) as StartResponse;
      const recording: ActiveRecording = {
        id: body.data.id,
        startedAt: body.data.startedAt,
        statusSseUrl: toProxyPath(body.data.statusSseUrl),
        fileUrl: toProxyPath(body.data.fileUrl),
        posterUrl: toProxyPath(body.data.posterUrl),
        durationS,
        useCarlaIfAvailable: useCarla,
      };
      writeSession(recording);
      setActive(recording);
      setEvents([]);
      setDownload(null);
      seqRef.current = 0;
      setState("starting");
      beginStream(recording);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setState("error");
    } finally {
      setSubmitting(false);
    }
  }, [beginStream, durationS, label, submitting, toast, useCarla]);

  const onReset = useCallback((): void => {
    stopStream();
    clearSession();
    setActive(null);
    setEvents([]);
    setDownload(null);
    setErrorMessage(null);
    setConnected(false);
    setState("idle");
  }, [stopStream]);

  if (state === "idle") {
    return (
      <StartPanel
        durationS={durationS}
        useCarla={useCarla}
        label={label}
        submitting={submitting}
        onDurationChange={setDurationS}
        onUseCarlaChange={setUseCarla}
        onLabelChange={setLabel}
        onStart={onStart}
        reducedMotion={reducedMotion}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <LiveBanner
        active={active}
        state={state}
        connected={connected}
        durationS={durationS}
        useCarla={useCarla}
      />

      {state === "error" && errorMessage ? (
        <GlassPanel
          variant="elevated"
          as="section"
          aria-live="assertive"
          className="border-l-2 border-[var(--color-crimson)]"
        >
          <div className="flex flex-col gap-4">
            <SpecLabel>Run failed</SpecLabel>
            <p className="text-[length:var(--text-body)] text-pearl">{errorMessage}</p>
            <Button variant="primary" size="md" onClick={onReset}>
              Try again
            </Button>
          </div>
        </GlassPanel>
      ) : null}

      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <RecordingsTimeline
          events={events}
          connected={connected}
          scrollRef={scrollRef}
          ariaLabel="Live recording timeline"
        />
      </div>

      {download ? (
        <DownloadCard
          fileUrl={download.url}
          posterUrl={download.posterUrl}
          sizeBytes={download.sizeBytes}
          durationS={download.durationS}
          encoder={download.encoder}
          onCopyLink={() =>
            toast.push({ title: "Copied", description: "Share link is on your clipboard." })
          }
          onCopyError={(msg) =>
            toast.push({ title: "Copy failed", description: msg, tone: "warning" })
          }
        />
      ) : null}

      {state === "done" || state === "error" ? (
        <div>
          <Button variant="secondary" size="md" onClick={onReset}>
            Record another
          </Button>
        </div>
      ) : null}
    </div>
  );
}

interface StartPanelProps {
  durationS: number;
  useCarla: boolean;
  label: string;
  submitting: boolean;
  onDurationChange: (s: number) => void;
  onUseCarlaChange: (v: boolean) => void;
  onLabelChange: (v: string) => void;
  onStart: () => void;
  reducedMotion: boolean;
}

function StartPanel({
  durationS,
  useCarla,
  label,
  submitting,
  onDurationChange,
  onUseCarlaChange,
  onLabelChange,
  onStart,
  reducedMotion,
}: StartPanelProps): React.JSX.Element {
  const pulseStyle: CSSProperties = reducedMotion
    ? {}
    : {
        animation: "pulse 2.6s ease-in-out infinite",
      };
  return (
    <GlassPanel variant="elevated" as="section" aria-label="Start a demo recording">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <SpecLabel>Recordings · new run</SpecLabel>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h1)] text-pearl">
            Record a demo of the autonomy stack.
          </h2>
          <p className="text-[length:var(--text-body)] text-pearl-muted leading-[1.6]">
            One click captures the dashboard, the perception event stream, and
            the chaos scenario into a 4K, 60 fps file. CARLA is used when a GPU
            is available; the chaos driver fills in otherwise. Either way the
            wire shape is identical.
          </p>
        </div>

        <fieldset className="flex flex-col gap-5">
          <legend className="sr-only">Recording options</legend>

          <label className="flex flex-col gap-2">
            <span className="luxe-spec-label !text-[0.625rem]">Duration</span>
            <select
              value={durationS}
              onChange={(e) => onDurationChange(Number(e.target.value))}
              className="luxe-glass min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-transparent px-4 text-[length:var(--text-control)] text-pearl"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={useCarla}
              onChange={(e) => onUseCarlaChange(e.target.checked)}
              className="h-5 w-5 rounded border border-[var(--color-hairline-strong)] bg-transparent accent-[var(--color-copper)]"
            />
            <span className="text-[length:var(--text-control)] text-pearl">
              Use live CARLA if available
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <span className="luxe-spec-label !text-[0.625rem]">Label (optional)</span>
            <input
              type="text"
              value={label}
              maxLength={80}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="e.g. Phase 2 demo for Mercedes IPP review"
              className="luxe-glass min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-transparent px-4 text-[length:var(--text-control)] text-pearl placeholder:text-pearl-soft"
            />
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center gap-4" style={pulseStyle}>
          <Button
            variant="primary"
            size="lg"
            onClick={onStart}
            loading={submitting}
            loadingText="Starting"
            data-testid="start-recording"
          >
            Start demo run
          </Button>
          <span className="luxe-mono text-[length:var(--text-micro)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
            One run at a time · safe to refresh mid-run
          </span>
        </div>
      </div>
    </GlassPanel>
  );
}

interface LiveBannerProps {
  active: ActiveRecording | null;
  state: RunState;
  connected: boolean;
  durationS: number;
  useCarla: boolean;
}

function LiveBanner({
  active,
  state,
  connected,
  durationS,
  useCarla,
}: LiveBannerProps): React.JSX.Element {
  const tone = state === "done" ? "ok" : state === "error" ? "halt" : connected ? "live" : "watch";
  const label = useMemo(() => state.toUpperCase(), [state]);
  const idShort = active ? shortId(active.id) : "";
  return (
    <GlassPanel variant="elevated" as="section" className="!py-4">
      <div className="flex flex-wrap items-center gap-4">
        <StatusPill tone={tone}>{label}</StatusPill>
        {idShort ? (
          <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl tabular-nums">
            ID {idShort}
          </span>
        ) : null}
        <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft tabular-nums">
          {durationS} S
        </span>
        <span className="luxe-mono text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caps)] text-pearl-soft">
          {useCarla ? "CARLA IF AVAILABLE" : "CHAOS DRIVER"}
        </span>
      </div>
    </GlassPanel>
  );
}

function readSession(): ActiveRecording | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveRecording>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.fileUrl !== "string" ||
      typeof parsed.posterUrl !== "string" ||
      typeof parsed.statusSseUrl !== "string" ||
      typeof parsed.durationS !== "number" ||
      typeof parsed.useCarlaIfAvailable !== "boolean"
    ) {
      return null;
    }
    return parsed as ActiveRecording;
  } catch {
    return null;
  }
}

function writeSession(recording: ActiveRecording): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(recording));
  } catch {
    /* private mode etc. — non-fatal */
  }
}

function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

function toProgressEvent(raw: Record<string, unknown>): RecordingProgressEvent | null {
  const ts = typeof raw.ts === "string" ? raw.ts : null;
  const category = raw.category;
  const severity = raw.severity;
  const title = typeof raw.title === "string" ? raw.title : null;
  if (!ts || !title) return null;
  if (
    category !== "recording" &&
    category !== "carla" &&
    category !== "bridge" &&
    category !== "scenario" &&
    category !== "encoding" &&
    category !== "done"
  ) {
    return null;
  }
  if (severity !== "info" && severity !== "watch" && severity !== "alert") return null;
  const out: RecordingProgressEvent = { ts, category, severity, title };
  if (typeof raw.detail === "string") out.detail = raw.detail;
  if (raw.data && typeof raw.data === "object") {
    out.data = raw.data as Record<string, unknown>;
  }
  return out;
}

function toDownloadPayload(raw: Record<string, unknown>): DownloadPayload | null {
  if (
    typeof raw.url !== "string" ||
    typeof raw.posterUrl !== "string" ||
    typeof raw.sizeBytes !== "number" ||
    typeof raw.durationS !== "number" ||
    typeof raw.encoder !== "string"
  ) {
    return null;
  }
  return {
    url: toProxyPath(raw.url),
    posterUrl: toProxyPath(raw.posterUrl),
    sizeBytes: raw.sizeBytes,
    durationS: raw.durationS,
    encoder: raw.encoder,
  };
}

// Strict CSP locks connect-src + img-src to 'self' for relative paths, so the
// browser must never fetch the API directly. The server-side proxy at
// /api/proxy/[...path] strips the '/v1' prefix, so we rewrite every backend
// path the API hands us into the proxy form before any DOM consumes it.
function toProxyPath(url: string): string {
  if (url.startsWith("/v1/")) return `/api/proxy/${url.slice("/v1/".length)}`;
  return url;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
