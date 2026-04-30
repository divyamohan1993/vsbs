import { describe, it, expect } from "vitest";
import {
  AnomalyMonitor,
  anomalyStatement,
  klDivergence,
  uniformPmf,
  bucket,
} from "./anomaly.js";
import { arbitrate } from "./fusion.js";
import type { SensorSample } from "@vsbs/shared";

describe("klDivergence", () => {
  it("KL(P||P) is zero", () => {
    const p = uniformPmf(16);
    expect(klDivergence(p, p)).toBeCloseTo(0, 10);
  });

  it("KL is non-negative for arbitrary distributions", () => {
    const p = [0.1, 0.2, 0.3, 0.4];
    const q = [0.4, 0.3, 0.2, 0.1];
    expect(klDivergence(p, q)).toBeGreaterThan(0);
  });

  it("KL with a zero-support q where p is non-zero is huge (capped)", () => {
    const p = [0.5, 0.5];
    const q = [1, 0];
    expect(klDivergence(p, q)).toBe(1e9);
  });
});

describe("bucket", () => {
  it("clamps below and above the domain", () => {
    expect(bucket(-1, 0, 10, 16)).toBe(0);
    expect(bucket(20, 0, 10, 16)).toBe(15);
  });
  it("places mid-domain values in middle bins", () => {
    expect(bucket(5, 0, 10, 16)).toBe(8);
  });
});

describe("AnomalyMonitor false-positive rate under stationary noise", () => {
  it("does not fire on uniform-baseline observations near the baseline mean", () => {
    const m = new AnomalyMonitor({
      min: 0,
      max: 100,
      bins: 16,
      baseline: uniformPmf(16),
    });
    let fired = 0;
    let rng = 1234567;
    function next(): number {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 2 ** 32;
    }
    for (let i = 0; i < 200; i++) {
      const v = next() * 100; // uniform across the domain
      const verdict = m.observe("v", "obd-pid", v);
      if (verdict.state === "anomaly") fired += 1;
    }
    expect(fired).toBe(0);
  });
});

describe("AnomalyMonitor drift detection", () => {
  it("fires when the distribution shifts to a single bin and stays there", () => {
    // Baseline: uniform 0..100. Observations all hit a tight bin near 95.
    const m = new AnomalyMonitor({
      min: 0,
      max: 100,
      bins: 16,
      baseline: uniformPmf(16),
      thresholdNats: 0.5,
      consecutiveTrigger: 5,
      alpha: 0.2, // higher alpha so drift is visible inside the test budget
    });
    let lastState = "ok";
    for (let i = 0; i < 80; i++) {
      const v = m.observe("v", "obd-pid", 95);
      lastState = v.state;
    }
    expect(lastState).toBe("anomaly");
  });

  it("recovers to ok once the channel returns to baseline", () => {
    const m = new AnomalyMonitor({
      min: 0,
      max: 100,
      bins: 16,
      baseline: uniformPmf(16),
      thresholdNats: 0.5,
      consecutiveTrigger: 5,
      alpha: 0.05,
    });
    // Drive into anomaly: many samples at one bin.
    for (let i = 0; i < 200; i++) m.observe("v", "obd-pid", 95);
    const peak = m.snapshot("v", "obd-pid")!;
    expect(peak.consecutive).toBeGreaterThanOrEqual(5);

    // Recovery: drive uniformly across the domain for many sweeps. The
    // running pmf decays toward the baseline; once kl drops below the
    // threshold, `consecutive` resets to 0 and the verdict is "ok".
    let recovered = false;
    for (let sweep = 0; sweep < 60 && !recovered; sweep++) {
      for (let bin = 0; bin < 16; bin++) {
        const value = (bin + 0.5) * (100 / 16);
        const v = m.observe("v", "obd-pid", value);
        if (v.state === "ok") {
          recovered = true;
          break;
        }
      }
    }
    expect(recovered).toBe(true);
  });
});

describe("anomalyStatement integrates with arbitrate", () => {
  it("synthesised contradicting statement resolves to sensor-failure", () => {
    const verdict = {
      vehicleId: "v",
      channel: "obd-pid" as const,
      state: "anomaly" as const,
      klNats: 1.2,
      threshold: 0.5,
      consecutive: 5,
      consecutiveTrigger: 5,
      observedAt: new Date().toISOString(),
    };
    const stmt = anomalyStatement(verdict)!;
    const samples: SensorSample[] = [
      {
        channel: "obd-pid",
        timestamp: new Date().toISOString(),
        origin: "real",
        vehicleId: "v",
        value: { pid: "0105", value: 87 },
        health: { selfTestOk: true, trust: 1 },
      },
    ];
    const out = arbitrate("v", [stmt], samples);
    expect(out.statements[0]!.status).toBe("sensor-failure");
  });
});
