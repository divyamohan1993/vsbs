import { describe, expect, it } from "vitest";
import {
  BUDGET_PER_SESSION,
  DEFAULT_K,
  makeAnalyticsCollector,
  type AnalyticsRow,
} from "../src/lib/analytics";
import { seededRng } from "../src/lib/dp";

function row(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    os: "android",
    locale: "en-IN",
    cityBand: "delhi",
    route: "/book",
    theme: "dark",
    durationMs: 5000,
    scrollDepth: 0.5,
    ...overrides,
  };
}

describe("AnalyticsCollector", () => {
  it("starts with the full session budget", () => {
    const c = makeAnalyticsCollector();
    expect(c.budgetRemaining()).toBe(BUDGET_PER_SESSION);
  });

  it("suppresses classes that fall below k", () => {
    const c = makeAnalyticsCollector({ k: DEFAULT_K, rng: seededRng(7n) });
    // 6 of one equivalence class — passes k=5.
    for (let i = 0; i < 6; i++) c.add(row({ os: "android" }));
    // 2 of another — should be suppressed.
    for (let i = 0; i < 2; i++) c.add(row({ os: "linux" }));
    const result = c.flush();
    expect(result.suppressedFraction).toBeCloseTo(2 / 8, 5);
    expect(result.buckets.length).toBe(1);
    // Surviving bucket should have a count near 6.
    expect(result.buckets[0]!.count).toBeGreaterThan(0);
  });

  it("decrements the privacy budget on each flush", () => {
    const c = makeAnalyticsCollector({ epsilonPerFlush: 1, rng: seededRng(7n) });
    for (let i = 0; i < 6; i++) c.add(row());
    c.flush();
    expect(c.budgetRemaining()).toBeCloseTo(BUDGET_PER_SESSION - 1, 5);
  });

  it("refuses to flush once the budget is exhausted", () => {
    const c = makeAnalyticsCollector({
      epsilonPerFlush: 1,
      sessionBudget: 1,
      rng: seededRng(7n),
    });
    for (let i = 0; i < 6; i++) c.add(row());
    const ok = c.flush();
    expect(ok.epsilonSpent).toBe(1);

    for (let i = 0; i < 6; i++) c.add(row());
    const denied = c.flush();
    expect(denied.epsilonSpent).toBe(0);
    expect(denied.buckets.length).toBe(0);
    expect(denied.rowsSkipped).toBe(6);
  });

  it("reset() restores the full budget and clears rows", () => {
    const c = makeAnalyticsCollector({ epsilonPerFlush: 1 });
    for (let i = 0; i < 6; i++) c.add(row());
    c.flush();
    c.reset();
    expect(c.budgetRemaining()).toBe(BUDGET_PER_SESSION);
    expect(c.rows().length).toBe(0);
  });

  it("noisy bucket count is within tolerance of the true count", () => {
    // Average over many flush trials to smooth Laplace noise.
    const N_TRIALS = 200;
    const trueCount = 8;
    let sum = 0;
    for (let t = 0; t < N_TRIALS; t++) {
      const c = makeAnalyticsCollector({ rng: seededRng(BigInt(1 + t)) });
      for (let i = 0; i < trueCount; i++) c.add(row());
      const r = c.flush();
      sum += r.buckets[0]?.count ?? 0;
    }
    const empMean = sum / N_TRIALS;
    expect(Math.abs(empMean - trueCount)).toBeLessThan(1);
  });
});
