// =============================================================================
// chaos/dependency-fail — toxiproxy-style network fault injection at the
// adapter layer. Validates that any sim adapter behind the chaosWrapper
// surfaces faults as structured errors and never produces silent retries.
// =============================================================================

import { describe, it, expect } from "vitest";
import { buildSchedule, chaosWrapper, ChaosError } from "../runner.js";

interface FakeAdapter {
  authenticate(): Promise<{ ok: true; sessionId: string }>;
  readState(): Promise<{ vin: string; soc: number }>;
}

function makeFakeAdapter(): FakeAdapter {
  return {
    async authenticate() {
      return { ok: true, sessionId: "sim-session" };
    },
    async readState() {
      return { vin: "1HGCM82633A004352", soc: 0.78 };
    },
  };
}

describe("chaos/dependency-fail — adapter-layer faults", () => {
  it("network jitter (latency) does not change the result, only timing", async () => {
    const adapter = makeFakeAdapter();
    const schedule = buildSchedule([{ atSecond: 0, action: "latency", ms: 50 }]);
    const wrapped = chaosWrapper(adapter.readState.bind(adapter), schedule);
    const t0 = Date.now();
    const r = await wrapped();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(50);
    expect(r.vin).toBe("1HGCM82633A004352");
  });

  it("error windows surface a typed ChaosError so callers can map to 5xx + Retry-After", async () => {
    const adapter = makeFakeAdapter();
    const schedule = buildSchedule([{ atSecond: 0, action: "error", code: "ECONNRESET" }]);
    const wrapped = chaosWrapper(adapter.authenticate.bind(adapter), schedule);
    await expect(wrapped()).rejects.toBeInstanceOf(ChaosError);
  });

  it("drops are observable as ETIMEDOUT (no silent retry)", async () => {
    const adapter = makeFakeAdapter();
    const schedule = buildSchedule([{ atSecond: 0, action: "drop" }]);
    const wrapped = chaosWrapper(adapter.readState.bind(adapter), schedule);
    let caught: unknown;
    try {
      await wrapped();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ChaosError);
    expect((caught as ChaosError).code).toBe("ETIMEDOUT");
  });
});
