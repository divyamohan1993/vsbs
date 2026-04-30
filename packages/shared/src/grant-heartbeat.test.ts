import { describe, it, expect, vi } from "vitest";
import {
  FakeHeartbeatClock,
  HeartbeatPolicySchema,
  HeartbeatRunner,
  type HeartbeatRevocation,
} from "./grant-heartbeat.js";

function makeRunner(opts?: { evaluator?: () => Promise<{ tier1Healthy: boolean; reasons: string[] }> }) {
  const clock = new FakeHeartbeatClock();
  const revocations: HeartbeatRevocation[] = [];
  const runner = new HeartbeatRunner({
    clock,
    onRevoke: (r) => {
      revocations.push(r);
    },
  });
  return { clock, runner, revocations };
}

describe("HeartbeatPolicySchema", () => {
  it("uses sane defaults", () => {
    const p = HeartbeatPolicySchema.parse({});
    expect(p.intervalMs).toBe(1_000);
    expect(p.maxMissedBeats).toBe(3);
    expect(p.defaultGrantTtlMs).toBe(300_000);
    expect(p.tier1RevocationOnFlip).toBe(true);
  });

  it("rejects defaultGrantTtlMs above 5 minutes", () => {
    expect(() => HeartbeatPolicySchema.parse({ defaultGrantTtlMs: 600_000 })).toThrow();
  });
});

describe("HeartbeatRunner", () => {
  it("ticks once per intervalMs", async () => {
    const { clock, runner } = makeRunner();
    const evaluator = vi.fn(async () => ({ tier1Healthy: true, reasons: [] }));
    runner.start("grant-1", { intervalMs: 100 }, evaluator);

    await clock.tick(99);
    await runner.drain();
    expect(evaluator).toHaveBeenCalledTimes(0);

    await clock.tick(1);
    await runner.drain();
    expect(evaluator).toHaveBeenCalledTimes(1);

    // Advance one interval at a time, draining after each so the runner's
    // in-flight guard does not skip a virtual tick.
    for (let i = 0; i < 3; i++) {
      await clock.tick(100);
      await runner.drain();
    }
    expect(evaluator.mock.calls.length).toBeGreaterThanOrEqual(4);

    runner.stop("grant-1");
  });

  it("revokes immediately on tier1Healthy=false", async () => {
    const { clock, runner, revocations } = makeRunner();
    runner.start("grant-2", { intervalMs: 1_000 }, async () => ({
      tier1Healthy: false,
      reasons: ["brake-pressure-loss"],
    }));
    await clock.tick(1_000);
    await runner.drain();
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.reason).toBe("tier1-flip");
    expect(revocations[0]!.reasons).toContain("brake-pressure-loss");
    expect(runner.isRunning("grant-2")).toBe(false);
  });

  it("does not debounce — first false fires", async () => {
    const { clock, runner, revocations } = makeRunner();
    let calls = 0;
    runner.start("grant-3", { intervalMs: 500 }, async () => {
      calls++;
      return { tier1Healthy: false, reasons: [`tick-${calls}`] };
    });
    await clock.tick(500);
    await runner.drain();
    expect(revocations).toHaveLength(1);
    // No second tick should have fired.
    await clock.tick(2_000);
    await runner.drain();
    expect(revocations).toHaveLength(1);
  });

  it("revokes on maxMissedBeats consecutive throws", async () => {
    const { clock, runner, revocations } = makeRunner();
    runner.start("grant-4", { intervalMs: 100, maxMissedBeats: 3 }, async () => {
      throw new Error("evaluator unreachable");
    });
    await clock.tick(100);
    await runner.drain();
    expect(revocations).toHaveLength(0);
    await clock.tick(100);
    await runner.drain();
    expect(revocations).toHaveLength(0);
    await clock.tick(100);
    await runner.drain();
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.reason).toBe("missed-beats");
  });

  it("resets missed counter on a healthy beat", async () => {
    const { clock, runner, revocations } = makeRunner();
    let calls = 0;
    runner.start("grant-5", { intervalMs: 50, maxMissedBeats: 3 }, async () => {
      calls++;
      if (calls === 1 || calls === 2) throw new Error("boom");
      return { tier1Healthy: true, reasons: [] };
    });
    await clock.tick(50);
    await runner.drain();
    await clock.tick(50);
    await runner.drain();
    await clock.tick(50);
    await runner.drain();
    expect(revocations).toHaveLength(0);
    runner.stop("grant-5");
  });

  it("stop() is idempotent and stops further ticks", async () => {
    const { clock, runner } = makeRunner();
    const evaluator = vi.fn(async () => ({ tier1Healthy: true, reasons: [] }));
    runner.start("grant-6", { intervalMs: 100 }, evaluator);
    await clock.tick(100);
    await runner.drain();
    runner.stop("grant-6");
    runner.stop("grant-6"); // idempotent
    runner.stop("nonexistent"); // idempotent
    const before = evaluator.mock.calls.length;
    await clock.tick(1_000);
    await runner.drain();
    expect(evaluator.mock.calls.length).toBe(before);
  });

  it("rejects start() for the same grant twice", () => {
    const { runner } = makeRunner();
    runner.start("grant-7", { intervalMs: 100 }, async () => ({ tier1Healthy: true, reasons: [] }));
    expect(() =>
      runner.start("grant-7", { intervalMs: 100 }, async () => ({ tier1Healthy: true, reasons: [] })),
    ).toThrow();
    runner.stop("grant-7");
  });
});
