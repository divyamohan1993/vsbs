"use client";

import { useEffect, useRef, useState } from "react";
import { readSse } from "../../lib/sse";

// Telemetry feed for the autonomy dashboard.
//
// Strategy:
//   1. SSE on /api/proxy/autonomy/:bookingId/telemetry/sse is the
//      primary transport. Next.js's API-route proxy is HTTP-only, so
//      WebSocket upgrades get rejected at the boundary and offer no
//      benefit in dev or in our current Cloud Run topology.
//   2. If SSE fails (sim bring-up, upstream cold start), fall back to
//      a deterministic local sim feed so the UI is always testable.
//   3. The optional WS path stays opt-in via NEXT_PUBLIC_AUTONOMY_WS=1
//      for production deployments that terminate WS upstream.

// L5 stack-shaped telemetry frame. Every channel except the eight back-compat
// fields is optional, so older bridges still validate. The dashboard reads
// what's present and falls back gracefully where a channel is missing.

export interface SensorHealth {
  id: string;
  label: string;
  status: "ok" | "watch" | "alert" | "offline";
  hz?: number;
  returns?: number;
  tempC?: number;
  fovDeg?: number;
  rangeM?: number;
}

export interface TelemetryFrame {
  ts: string;
  origin: "real" | "sim";
  simSource?: string;
  speedKph: number;
  headingDeg: number;
  brakePadFrontPercent: number;
  hvSocPercent: number;
  coolantTempC: number;
  tpms: { fl: number; fr: number; rl: number; rr: number };

  gps?: { lat: number; lng: number };
  accel?: { x: number; y: number; z: number };
  distanceToServiceCentreM?: number;
  nearbyVehicles?: number;
  nearbyPedestrians?: number;
  trafficLightState?: "green" | "yellow" | "red" | "off" | "unknown";

  sensors?: {
    cameras?: SensorHealth[];
    radars?: SensorHealth[];
    lidars?: SensorHealth[];
    ultrasonic?: SensorHealth[];
    thermal?: SensorHealth[];
    microphones?: SensorHealth[];
  };

  gnss?: {
    fix: "none" | "2d" | "3d" | "rtk-float" | "rtk-fixed";
    satellites: number;
    hdop: number;
    pdop?: number;
    constellations?: Partial<{
      gps: number;
      glonass: number;
      galileo: number;
      beidou: number;
      qzss: number;
      navic: number;
    }>;
    rtkAgeS?: number;
    posAccuracyM?: number;
    speedAccuracyMps?: number;
  };

  imu?: {
    accel: { x: number; y: number; z: number };
    gyro: { x: number; y: number; z: number };
    magneto?: { x: number; y: number; z: number };
    tempC?: number;
    biasInstabilityDegHr?: number;
  };

  wheels?: {
    rpm: { fl: number; fr: number; rl: number; rr: number };
    hubTempC?: { fl: number; fr: number; rl: number; rr: number };
    tpmsKpa: { fl: number; fr: number; rl: number; rr: number };
    tpmsTempC?: { fl: number; fr: number; rl: number; rr: number };
  };

  chassis?: {
    steeringAngleDeg: number;
    steeringTorqueNm?: number;
    brakePressureBar?: { front: number; rear: number };
    rideHeightMm?: { fl: number; fr: number; rl: number; rr: number };
    frictionCoef?: number;
  };

  powertrain?: {
    motorFront?: { torqueNm: number; tempStatorC: number; tempRotorC: number; rpm: number };
    motorRear?: { torqueNm: number; tempStatorC: number; tempRotorC: number; rpm: number };
    inverterTempC?: number;
    inverterCurrentA?: number;
    hvBusV?: number;
    hvBusA?: number;
    aux12vV?: number;
    hvCellsMv?: number[];
    hvCellsTempC?: number[];
    hvIsolationKohm?: number;
    hvSocPercent: number;
    hvSohPercent?: number;
    hvSopKw?: number;
    coolantMotorC?: number;
    coolantBatteryC?: number;
    coolantInverterC?: number;
    coolantTempC: number;
  };

  perception?: {
    detections?: Partial<{
      vehicles: number;
      pedestrians: number;
      cyclists: number;
      twoWheelers: number;
      animals: number;
      signs: number;
      cones: number;
    }>;
    tracks?: Array<{
      id: string;
      cls: "vehicle" | "pedestrian" | "cyclist" | "two-wheeler" | "animal" | "static" | "unknown";
      distanceM: number;
      bearingDeg: number;
      vMps: number;
      predictionHorizonS?: number;
      risk?: number;
    }>;
    bevOccupancy?: { occupiedRatio: number; peakUncertainty?: number };
    laneGraph?: { currentLane: number; totalLanes: number; confidence: number };
    trafficLight?: { state: "green" | "yellow" | "red" | "off" | "unknown"; ttcS?: number; confidence?: number };
    freeSpaceRatio?: number;
    drivableAreaMiou?: number;
  };

  planner?: {
    horizonS?: number;
    sampledTrajectories?: number;
    selectedAlt?: number;
    softViolations?: number;
    hardViolations?: number;
    cvar95?: number;
    behavior?:
      | "cruise"
      | "follow"
      | "lane-change"
      | "merge"
      | "yield"
      | "stop"
      | "park"
      | "minimal-risk-manoeuvre";
  };

  control?: {
    throttle?: number;
    brake?: number;
    steering?: number;
    gear?: number;
  };

  compute?: {
    primary?: { soc?: string; cpuPct?: number; gpuPct?: number; npuPct?: number; ramPct?: number; tempC?: number; powerW?: number };
    lockstep?: { soc?: string; cpuPct?: number; diffPpm?: number; tempC?: number };
    hsmHeartbeatOk?: boolean;
  };

  network?: {
    rsrpDbm?: number;
    rsrqDb?: number;
    sinrDb?: number;
    mecRttMs?: number;
    wifiRssiDbm?: number;
    hdMapVersion?: string;
    hdMapSyncedAt?: string;
    hdMapDeltasPending?: number;
  };

  v2x?: {
    bsmRxPerSec?: number;
    camRxPerSec?: number;
    spatRxPerSec?: number;
    mapRxPerSec?: number;
    denmRxPerSec?: number;
    rsaRxPerSec?: number;
    latestKind?: "BSM" | "CAM" | "SPaT" | "MAP" | "DENM" | "RSA" | "SSM" | "TIM";
    latestSummary?: string;
    neighbours?: number;
  };

  safety?: {
    oddCompliant?: boolean;
    oddReason?: string;
    oodMahalanobis?: number;
    oodThreshold?: number;
    takeoverRung?: number;
    ttcSec?: number;
    fttiMs?: number;
    capabilityBudget?: number;
    mrmActive?: boolean;
    mrmKind?: string;
  };

  cabin?: {
    cabinTempC?: number;
    cabinHumidityPct?: number;
    co2Ppm?: number;
    pm25Ugm3?: number;
    driverAttention?: { gazeOnRoad: number; eyesClosed: boolean; handsOnWheel?: boolean; seatBelt?: boolean };
    occupants?: number;
  };

  environment?: {
    weather?: "clear" | "cloudy" | "rain" | "fog" | "snow" | "storm";
    visibilityM?: number;
    ambientTempC?: number;
    ambientHumidityPct?: number;
    windKph?: number;
    pavement?: "asphalt-dry" | "asphalt-wet" | "concrete" | "gravel" | "ice" | "snow";
    timeOfDay?: "day" | "dusk" | "night" | "dawn";
  };

  software?: {
    perceptionVersion?: string;
    plannerVersion?: string;
    controlVersion?: string;
    osVersion?: string;
    calibrationVersion?: string;
    shadowModeUploadAt?: string;
  };

  throttle?: number;
  brake?: number;
  steering?: number;
  gear?: number;
}

export interface TelemetryHistory {
  speedKph: number[];
  headingDeg: number[];
  brakePadFrontPercent: number[];
  hvSocPercent: number[];
  coolantTempC: number[];
  tpms: number[];
}

// Frozen pre-mount placeholder — keeps SSR + client hydration deterministic.
// The first SSE frame replaces it within ~750 ms.
const FALLBACK: TelemetryFrame = {
  ts: "2026-04-15T08:00:00.000Z",
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
      const enabled =
        typeof process !== "undefined" &&
        process.env?.NEXT_PUBLIC_AUTONOMY_WS === "1";
      if (!enabled) return false;
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
