"use client";

import { useEffect, useRef, useState } from "react";
import { readSse } from "../../lib/sse";

// Telemetry feed for the autonomy dashboard.
//
// Strategy:
//   1. Try a WebSocket on /api/proxy/autonomy/:bookingId/telemetry/ws
//      first — the server upgrades onto the underlying autonomy router
//      when present.
//   2. On a connection failure or `close` with code != 1000, fall back
//      to SSE on /api/proxy/autonomy/:bookingId/telemetry/sse.
//   3. While neither is available (sim bring-up), the hook returns a
//      deterministic local feed so the UI is testable.

export interface TelemetryFrame {
  ts: string;
  speedKph: number;
  headingDeg: number;
  brakePadFrontPercent: number;
  hvSocPercent: number;
  coolantTempC: number;
  tpms: { fl: number; fr: number; rl: number; rr: number };
  origin: "real" | "sim";
}

export interface TelemetryHistory {
  speedKph: number[];
  headingDeg: number[];
  brakePadFrontPercent: number[];
  hvSocPercent: number[];
  coolantTempC: number[];
  tpms: number[];
}

const FALLBACK: TelemetryFrame = {
  ts: new Date().toISOString(),
  speedKph: 0,
  headingDeg: 0,
  brakePadFrontPercent: 78,
  hvSocPercent: 64,
  coolantTempC: 92,
  tpms: { fl: 230, fr: 232, rl: 228, rr: 231 },
  origin: "sim",
};

export type TransportStatus = "connecting" | "websocket" | "sse" | "local-sim" | "disconnected";

const HISTORY_CAP = 60;

export interface UseTelemetryStreamResult {
  frame: TelemetryFrame;
  history: TelemetryHistory;
  status: TransportStatus;
  error: string | null;
  reconnect: () => void;
  lastTickMs: number;
}

export function useTelemetryStream(bookingId: string): UseTelemetryStreamResult {
  const [frame, setFrame] = useState<TelemetryFrame>(FALLBACK);
  const [history, setHistory] = useState<TelemetryHistory>({
    speedKph: [],
    headingDeg: [],
    brakePadFrontPercent: [],
    hvSocPercent: [],
    coolantTempC: [],
    tpms: [],
  });
  const [status, setStatus] = useState<TransportStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [lastTickMs, setLastTickMs] = useState<number>(Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const aborter = useRef<AbortController | null>(null);
  const simHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  const reconnect = (): void => setVersion((v) => v + 1);

  const ingest = (f: TelemetryFrame): void => {
    setFrame(f);
    setLastTickMs(Date.now());
    setHistory((h) => ({
      speedKph: pushCap(h.speedKph, f.speedKph),
      headingDeg: pushCap(h.headingDeg, f.headingDeg),
      brakePadFrontPercent: pushCap(h.brakePadFrontPercent, f.brakePadFrontPercent),
      hvSocPercent: pushCap(h.hvSocPercent, f.hvSocPercent),
      coolantTempC: pushCap(h.coolantTempC, f.coolantTempC),
      tpms: pushCap(h.tpms, (f.tpms.fl + f.tpms.fr + f.tpms.rl + f.tpms.rr) / 4),
    }));
  };

  useEffect(() => {
    let cancelled = false;
    setStatus("connecting");
    setError(null);

    function startLocalSim(): void {
      setStatus("local-sim");
      let i = 0;
      simHandle.current = setInterval(() => {
        if (cancelled) return;
        i++;
        const f: TelemetryFrame = {
          ts: new Date().toISOString(),
          speedKph: 12 + (i % 7) + Math.sin(i / 6) * 2.5,
          headingDeg: (i * 3) % 360,
          brakePadFrontPercent: 78 - ((i * 0.05) % 4),
          hvSocPercent: 64 - ((i * 0.04) % 6),
          coolantTempC: 92 + ((i * 0.1) % 3),
          tpms: {
            fl: 230 + ((i * 0.2) % 3),
            fr: 232 - ((i * 0.15) % 2),
            rl: 228 + ((i * 0.1) % 2),
            rr: 231 + ((i * 0.05) % 2),
          },
          origin: "sim",
        };
        ingest(f);
      }, 750);
    }

    async function startSse(): Promise<boolean> {
      try {
        const ctrl = new AbortController();
        aborter.current = ctrl;
        const res = await fetch(
          `/api/proxy/autonomy/${encodeURIComponent(bookingId)}/telemetry/sse`,
          {
            method: "GET",
            headers: { accept: "text/event-stream" },
            signal: ctrl.signal,
          },
        );
        if (!res.ok || !res.body) return false;
        setStatus("sse");
        for await (const ev of readSse(res.body)) {
          if (cancelled) break;
          if (ev.event !== "telemetry") continue;
          try {
            const payload = JSON.parse(ev.data) as TelemetryFrame;
            ingest(payload);
          } catch {
            /* skip malformed frames */
          }
        }
        return true;
      } catch (err) {
        if ((err as Error).name === "AbortError") return true;
        setError((err as Error).message);
        return false;
      }
    }

    function startWs(): boolean {
      if (typeof window === "undefined" || !("WebSocket" in window)) return false;
      try {
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${proto}//${window.location.host}/api/proxy/autonomy/${encodeURIComponent(bookingId)}/telemetry/ws`;
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          if (cancelled) return;
          setStatus("websocket");
        };
        ws.onmessage = (ev) => {
          if (cancelled) return;
          try {
            const payload = JSON.parse(typeof ev.data === "string" ? ev.data : "") as TelemetryFrame;
            ingest(payload);
          } catch {
            /* skip malformed */
          }
        };
        ws.onerror = () => {
          if (cancelled) return;
        };
        ws.onclose = (ev) => {
          if (cancelled) return;
          if (ev.code !== 1000) {
            void startSse().then((ok) => {
              if (!ok && !cancelled) startLocalSim();
            });
          }
        };
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    }

    if (!startWs()) {
      void startSse().then((ok) => {
        if (!ok && !cancelled) startLocalSim();
      });
    }

    return () => {
      cancelled = true;
      if (simHandle.current) clearInterval(simHandle.current);
      simHandle.current = null;
      if (wsRef.current) {
        try {
          wsRef.current.close(1000);
        } catch {
          /* already closed */
        }
        wsRef.current = null;
      }
      if (aborter.current) {
        aborter.current.abort();
        aborter.current = null;
      }
    };
  }, [bookingId, version]);

  return { frame, history, status, error, reconnect, lastTickMs };
}

function pushCap(arr: number[], v: number): number[] {
  const next = arr.length >= HISTORY_CAP ? arr.slice(arr.length - HISTORY_CAP + 1) : arr.slice();
  next.push(v);
  return next;
}
