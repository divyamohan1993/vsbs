// =============================================================================
// Realistic sensor simulator. Every sample is stamped `origin: "sim"` so the
// pipeline can never confuse it with real data.
//
// We ship noise models grounded in plausible physics — see prognostics.md
// and autonomy.md §2 for the reasoning on each channel. The intent is not to
// reproduce any vehicle dynamics simulator; it is to exercise the fusion,
// PHM, and arbitration logic end-to-end without hardware.
// =============================================================================

import type { SensorSample, SensorChannel } from "@vsbs/shared";

function gaussian(mu: number, sigma: number): number {
  // Box-Muller.
  const u1 = Math.max(1e-12, Math.random());
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mu + sigma * z;
}

export interface FaultInjection {
  channel: SensorChannel;
  kind: "bias" | "stuck" | "dropout" | "spike";
  amount: number; // meaning depends on kind
  startsAt: number; // ms
  endsAt?: number; // ms
}

export interface SimVehicle {
  vehicleId: string;
  state: {
    speedKph: number;
    brakePressureBar: number;
    tirePressuresBar: [number, number, number, number];
    oilPressureBar: number;
    coolantC: number;
    batteryV12: number;
    hvBatterySoC: number;
    hvBatteryCellMaxDeltaV: number;
  };
  faults: FaultInjection[];
}

export function defaultVehicle(vehicleId: string): SimVehicle {
  return {
    vehicleId,
    state: {
      speedKph: 0,
      brakePressureBar: 0,
      tirePressuresBar: [2.3, 2.3, 2.3, 2.3],
      oilPressureBar: 3.5,
      coolantC: 85,
      batteryV12: 12.6,
      hvBatterySoC: 0.72,
      hvBatteryCellMaxDeltaV: 0.02,
    },
    faults: [],
  };
}

function applyFault(ch: SensorChannel, value: number, faults: FaultInjection[], nowMs: number): { v: number; ok: boolean } {
  for (const f of faults) {
    if (f.channel !== ch) continue;
    if (nowMs < f.startsAt) continue;
    if (f.endsAt !== undefined && nowMs > f.endsAt) continue;
    switch (f.kind) {
      case "bias":
        return { v: value + f.amount, ok: true };
      case "stuck":
        return { v: f.amount, ok: true };
      case "spike":
        return { v: value + f.amount * (Math.random() > 0.5 ? 1 : -1), ok: true };
      case "dropout":
        return { v: Number.NaN, ok: false };
    }
  }
  return { v: value, ok: true };
}

export function sampleBrakePressure(v: SimVehicle): SensorSample {
  const nowMs = Date.now();
  const nominal = v.state.brakePressureBar;
  const noisy = gaussian(nominal, 0.05);
  const f = applyFault("brake-pressure", noisy, v.faults, nowMs);
  return {
    channel: "brake-pressure",
    timestamp: new Date(nowMs).toISOString(),
    origin: "sim",
    vehicleId: v.vehicleId,
    value: { bar: f.v },
    health: { selfTestOk: f.ok, trust: f.ok ? 0.95 : 0 },
  };
}

export function sampleTpms(v: SimVehicle): SensorSample[] {
  const nowMs = Date.now();
  const labels: Array<"tire-fl" | "tire-fr" | "tire-rl" | "tire-rr"> = [
    "tire-fl",
    "tire-fr",
    "tire-rl",
    "tire-rr",
  ];
  return v.state.tirePressuresBar.map((p, i) => {
    const noisy = gaussian(p, 0.02);
    const f = applyFault("tpms", noisy, v.faults, nowMs);
    return {
      channel: "tpms" as const,
      timestamp: new Date(nowMs).toISOString(),
      origin: "sim" as const,
      vehicleId: v.vehicleId,
      value: { position: labels[i], bar: f.v },
      health: { selfTestOk: f.ok, trust: f.ok ? 0.9 : 0 },
    };
  });
}

export function sampleHvBattery(v: SimVehicle): SensorSample {
  const nowMs = Date.now();
  const soc = gaussian(v.state.hvBatterySoC, 0.005);
  const dv = gaussian(v.state.hvBatteryCellMaxDeltaV, 0.002);
  const f = applyFault("bms", soc, v.faults, nowMs);
  return {
    channel: "bms",
    timestamp: new Date(nowMs).toISOString(),
    origin: "sim",
    vehicleId: v.vehicleId,
    value: { soc: f.v, cellMaxDeltaV: dv, thermalWarning: dv > 0.08 || soc > 1 },
    health: { selfTestOk: f.ok, trust: f.ok ? 0.9 : 0 },
  };
}

export function sampleAll(v: SimVehicle): SensorSample[] {
  return [sampleBrakePressure(v), ...sampleTpms(v), sampleHvBattery(v)];
}
