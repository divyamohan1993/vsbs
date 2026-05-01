"use client";

import { useEffect, useRef, useState } from "react";
import { readSse } from "../../lib/sse";

// Live perception event stream for the autonomy dashboard.
//
// The API emits one event per discrete observation: red-light detected,
// pedestrian within braking radius, fault crossed a watch threshold,
// scenario state transition. The hook keeps a rolling tail of the most
// recent N events so the dashboard can render an event log without
// holding the whole booking history in memory.

export type PerceptionCategory =
  | "perception"
  | "fault"
  | "safety"
  | "navigation"
  | "driving"
  | "scenario";

export type PerceptionSeverity = "info" | "watch" | "alert" | "critical";

export interface PerceptionEvent {
  ts: string;
  category: PerceptionCategory;
  severity: PerceptionSeverity;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
  /** Local-only sequence id, assigned on receive. */
  seq?: number;
}

const TAIL_CAP = 40;

export interface UsePerceptionEventsResult {
  events: PerceptionEvent[];
  connected: boolean;
}

export function usePerceptionEvents(bookingId: string): UsePerceptionEventsResult {
  const [events, setEvents] = useState<PerceptionEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    async function run(): Promise<void> {
      try {
        const res = await fetch(
          `/api/proxy/autonomy/${encodeURIComponent(bookingId)}/events/sse`,
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
          if (frame.event === "ping") continue;
          if (frame.event !== "perception") continue;
          try {
            const ev = JSON.parse(frame.data) as PerceptionEvent;
            seqRef.current += 1;
            const stamped: PerceptionEvent = { ...ev, seq: seqRef.current };
            setEvents((prev) => {
              const next = [stamped, ...prev];
              return next.length > TAIL_CAP ? next.slice(0, TAIL_CAP) : next;
            });
          } catch {
            /* skip malformed */
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          // SSE faulted — leave events in place, drop the connected flag.
        }
      } finally {
        if (!cancelled) setConnected(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [bookingId]);

  return { events, connected };
}
