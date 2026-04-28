import { describe, expect, it } from "vitest";
import {
  defineSlo,
  evaluate,
  STANDARD_THRESHOLDS,
  VSBS_SLOS,
  type Observation,
} from "../src/slo.js";

const HOUR = 60 * 60 * 1_000;

function obs(good: number, total: number, agoMs: number, now: number): Observation {
  return { good, total, ts: now - agoMs };
}

describe("defineSlo", () => {
  it("rejects targets <= 0 or > 1", () => {
    expect(() => defineSlo({ name: "x", target: 0, window: "30d", sli: { description: "", query: "" } })).toThrow();
    expect(() => defineSlo({ name: "x", target: 1.1, window: "30d", sli: { description: "", query: "" } })).toThrow();
  });

  it("rejects names that are not lowercase-kebab", () => {
    expect(() => defineSlo({ name: "Bad_Name", target: 0.99, window: "30d", sli: { description: "", query: "" } })).toThrow();
  });
});

describe("evaluate", () => {
  it("returns sli=1 when there are zero observations", () => {
    const slo = defineSlo({
      name: "x-test",
      target: 0.999,
      window: "1h",
      sli: { description: "", query: "" },
    });
    const r = evaluate(slo, [], STANDARD_THRESHOLDS, 1_700_000_000_000);
    expect(r.currentSli).toBe(1);
    expect(r.alertFiring).toBe(false);
  });

  it("computes burn rate from observed error fraction", () => {
    const now = 1_700_000_000_000;
    const slo = defineSlo({
      name: "x-test",
      target: 0.99,
      window: "1h",
      sli: { description: "", query: "" },
    });
    // Observed: 5 % errors → burn = 0.05 / 0.01 = 5x
    const r = evaluate(slo, [obs(95, 100, 1_000, now)], STANDARD_THRESHOLDS, now);
    expect(r.currentSli).toBeCloseTo(0.95, 5);
    expect(r.burnRate).toBeCloseTo(5, 5);
  });

  it("fires fast-burn page when 1h burn >= 14.4", () => {
    const now = 1_700_000_000_000;
    const slo = defineSlo({
      name: "x-test",
      target: 0.999,
      window: "30d",
      sli: { description: "", query: "" },
    });
    // 2 % errors over the last hour → burn = 0.02 / 0.001 = 20x  (>= 14.4)
    const o: Observation[] = [obs(98, 100, 30 * 60 * 1_000, now)];
    const r = evaluate(slo, o, STANDARD_THRESHOLDS, now);
    expect(r.alertFiring).toBe(true);
    expect(r.severity).toBe("page");
    const fast = r.thresholds.find((t) => t.name === "fast-burn")!;
    expect(fast.firing).toBe(true);
  });

  it("does not fire when SLI is at or above target", () => {
    const now = 1_700_000_000_000;
    const slo = defineSlo({
      name: "x-test",
      target: 0.99,
      window: "30d",
      sli: { description: "", query: "" },
    });
    const o: Observation[] = [obs(1000, 1000, 5 * 60 * 1_000, now)];
    const r = evaluate(slo, o, STANDARD_THRESHOLDS, now);
    expect(r.alertFiring).toBe(false);
    expect(r.severity).toBeNull();
  });

  it("ignores observations outside the SLO window", () => {
    const now = 1_700_000_000_000;
    const slo = defineSlo({
      name: "x-test",
      target: 0.99,
      window: "1h",
      sli: { description: "", query: "" },
    });
    // The 100% bad observation was 5 hours ago → outside the 1h window.
    const o: Observation[] = [obs(0, 100, 5 * HOUR, now)];
    const r = evaluate(slo, o, STANDARD_THRESHOLDS, now);
    expect(r.currentSli).toBe(1);
  });

  it("error budget remaining drops as errors accumulate", () => {
    const now = 1_700_000_000_000;
    const slo = defineSlo({
      name: "x-test",
      target: 0.99,
      window: "30d",
      sli: { description: "", query: "" },
    });
    // 0.5 % errors over the last day → half the budget consumed.
    const o: Observation[] = [obs(995, 1000, 12 * HOUR, now)];
    const r = evaluate(slo, o, STANDARD_THRESHOLDS, now);
    expect(r.errorBudgetRemaining).toBeGreaterThan(0);
    expect(r.errorBudgetRemaining).toBeLessThan(1);
  });
});

describe("VSBS_SLOS", () => {
  it("includes the four canonical SLOs", () => {
    const names = VSBS_SLOS.map((s) => s.name).sort();
    expect(names).toEqual([
      "api-availability",
      "api-latency-p99",
      "autonomy-handoff-success",
      "concierge-turn-success",
    ]);
  });

  it("each SLO has a target in (0, 1]", () => {
    for (const slo of VSBS_SLOS) {
      expect(slo.target).toBeGreaterThan(0);
      expect(slo.target).toBeLessThanOrEqual(1);
    }
  });

  it("STANDARD_THRESHOLDS conform to Google SRE workbook", () => {
    const fast = STANDARD_THRESHOLDS.find((t) => t.name === "fast-burn")!;
    const slow = STANDARD_THRESHOLDS.find((t) => t.name === "slow-burn")!;
    expect(fast.window).toBe("1h");
    expect(fast.multiplier).toBe(14.4);
    expect(slow.window).toBe("6h");
    expect(slow.multiplier).toBe(6);
  });
});
