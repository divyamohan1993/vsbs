"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface LogEntry {
  ts: string;
  level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  severity: string;
  msg: string;
  service: string;
  region: string;
  request_id?: string;
  trace_id?: string;
  span_id?: string;
  user_hash?: string;
  fields?: Record<string, unknown>;
}

const LEVELS: LogEntry["level"][] = ["trace", "debug", "info", "warn", "error", "fatal"];

function classFor(level: LogEntry["level"]): string {
  switch (level) {
    case "fatal":
      return "border-red-700 text-red-200 bg-red-950/60";
    case "error":
      return "border-red-600 text-red-100 bg-red-950/40";
    case "warn":
      return "border-yellow-600 text-yellow-100 bg-yellow-950/30";
    case "info":
      return "border-blue-700 text-blue-100 bg-blue-950/30";
    case "debug":
      return "border-gray-600 text-gray-200";
    case "trace":
      return "border-gray-700 text-gray-300";
  }
}

export function LogsClient(): React.ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<LogEntry["level"] | "">("");
  const [query, setQuery] = useState<string>("");
  const [streaming, setStreaming] = useState<boolean>(true);
  const [status, setStatus] = useState<"connecting" | "live" | "closed" | "error">("closed");
  const esRef = useRef<EventSource | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (query) params.set("q", query);
    return `/api/proxy/v1/admin/logs/stream?${params.toString()}`;
  }, [level, query]);

  useEffect(() => {
    if (!streaming) {
      esRef.current?.close();
      esRef.current = null;
      setStatus("closed");
      return undefined;
    }
    setStatus("connecting");
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;
    es.addEventListener("log", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as LogEntry;
        setEntries((prev) => {
          const next = [data, ...prev];
          if (next.length > 500) next.length = 500;
          return next;
        });
      } catch {
        // Ignore malformed frames.
      }
    });
    es.addEventListener("open", () => setStatus("live"));
    es.addEventListener("error", () => setStatus("error"));
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [streaming, url]);

  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">Filters</legend>
        <label className="flex flex-col text-sm">
          <span className="text-muted mb-1">Level</span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as LogEntry["level"] | "")}
            className="rounded-[var(--radius-input)] border border-[var(--color-border)] bg-surface-2 px-3 py-2"
          >
            <option value="">All</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm flex-1 min-w-[12rem]">
          <span className="text-muted mb-1">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="substring match against msg + fields"
            className="rounded-[var(--radius-input)] border border-[var(--color-border)] bg-surface-2 px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={() => setStreaming((v) => !v)}
          className="rounded-[var(--radius-button)] border-2 border-accent bg-accent px-4 py-2 font-semibold text-accent-on min-h-[44px] min-w-[44px]"
        >
          {streaming ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          onClick={() => setEntries([])}
          className="rounded-[var(--radius-button)] border border-[var(--color-border)] px-4 py-2 min-h-[44px] min-w-[44px]"
        >
          Clear
        </button>
        <span aria-live="polite" className="text-muted text-sm">
          status: {status} · {entries.length} entries
        </span>
      </fieldset>

      <ol
        aria-label="Log entries (newest first)"
        className="max-h-[70vh] overflow-y-auto space-y-2 font-mono text-xs"
      >
        {entries.length === 0 ? (
          <li className="text-muted">Waiting for entries…</li>
        ) : (
          entries.map((e, i) => (
            <li
              key={`${e.ts}-${i}`}
              className={`rounded-[var(--radius-card)] border-l-4 px-3 py-2 ${classFor(e.level)}`}
            >
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span>{e.ts}</span>
                <span className="font-semibold uppercase">{e.level}</span>
                <span>{e.msg}</span>
                {e.request_id ? <span className="opacity-70">rid:{e.request_id.slice(0, 8)}</span> : null}
                {e.trace_id ? <span className="opacity-70">trace:{e.trace_id.slice(0, 8)}</span> : null}
              </div>
              {e.fields ? (
                <pre className="mt-1 whitespace-pre-wrap break-words opacity-80">
                  {JSON.stringify(e.fields, null, 0)}
                </pre>
              ) : null}
            </li>
          ))
        )}
      </ol>
    </div>
  );
}
