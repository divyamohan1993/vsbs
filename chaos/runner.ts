// =============================================================================
// chaos/runner — vitest-friendly scenario runner. Each scenario is a plain
// TS file under scenarios/. The runner exposes:
//
//   chaosWrapper<T>(target, schedule) — wraps any async-callable target with
//   latency / error / timeout injection, driven by a small declarative
//   schedule. Used inside scenario tests to harden adapter integrations.
//
// The schedule is a sequence of windows:
//   { atSecond: 0, action: "ok" }
//   { atSecond: 5, action: "latency", ms: 800 }
//   { atSecond: 10, action: "error", code: "ECONNRESET" }
//   { atSecond: 12, action: "timeout" }
//
// scheduledAction(t) returns the action active at offset t seconds.
// =============================================================================

export type ChaosAction =
  | { action: "ok" }
  | { action: "latency"; ms: number }
  | { action: "error"; code: string; message?: string }
  | { action: "timeout" }
  | { action: "drop" };

export interface ChaosWindow extends ChaosAction {
  atSecond: number;
}

export interface ChaosSchedule {
  windows: ChaosWindow[];
  /** Optional clock override for deterministic tests. */
  now?: () => number;
}

export function scheduledAction(schedule: ChaosSchedule, atSecond: number): ChaosAction {
  let active: ChaosAction = { action: "ok" };
  for (const w of schedule.windows) {
    if (atSecond >= w.atSecond) active = stripWindow(w);
    else break;
  }
  return active;
}

function stripWindow(w: ChaosWindow): ChaosAction {
  switch (w.action) {
    case "ok":
      return { action: "ok" };
    case "latency":
      return { action: "latency", ms: w.ms };
    case "error":
      return { action: "error", code: w.code, ...(w.message !== undefined ? { message: w.message } : {}) };
    case "timeout":
      return { action: "timeout" };
    case "drop":
      return { action: "drop" };
  }
}

export class ChaosError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "ChaosError";
  }
}

/** Wraps any async function with latency / error / timeout injection. */
export function chaosWrapper<TArgs extends unknown[], TRes>(
  inner: (...args: TArgs) => Promise<TRes>,
  schedule: ChaosSchedule,
  startedAt: number = Date.now(),
): (...args: TArgs) => Promise<TRes> {
  return async (...args: TArgs) => {
    const offsetSec = ((schedule.now ?? Date.now)() - startedAt) / 1_000;
    const action = scheduledAction(schedule, offsetSec);
    switch (action.action) {
      case "ok":
        return inner(...args);
      case "latency": {
        await new Promise((r) => setTimeout(r, action.ms));
        return inner(...args);
      }
      case "drop":
      case "timeout":
        await new Promise((r) => setTimeout(r, 5_000));
        throw new ChaosError("ETIMEDOUT", "chaos-induced timeout");
      case "error":
        throw new ChaosError(action.code, action.message ?? `chaos error ${action.code}`);
    }
  };
}

/** Convenience: build a schedule from a sparse array. */
export function buildSchedule(windows: ChaosWindow[]): ChaosSchedule {
  return { windows: windows.slice().sort((a, b) => a.atSecond - b.atSecond) };
}

import { describe, it, expect } from "vitest";

describe("chaos/runner", () => {
  it("scheduledAction returns the latest active window", () => {
    const s = buildSchedule([
      { atSecond: 0, action: "ok" },
      { atSecond: 5, action: "latency", ms: 200 },
      { atSecond: 10, action: "error", code: "BOOM" },
    ]);
    expect(scheduledAction(s, 0).action).toBe("ok");
    expect(scheduledAction(s, 6).action).toBe("latency");
    expect(scheduledAction(s, 11).action).toBe("error");
  });

  it("chaosWrapper injects errors when the schedule says so", async () => {
    const schedule = buildSchedule([{ atSecond: 0, action: "error", code: "ECONNRESET" }]);
    const wrapped = chaosWrapper(async () => "ok", schedule);
    await expect(wrapped()).rejects.toThrow(/ECONNRESET/);
  });

  it("chaosWrapper passes through 'ok' windows untouched", async () => {
    const schedule = buildSchedule([{ atSecond: 0, action: "ok" }]);
    const wrapped = chaosWrapper(async (x: number) => x + 1, schedule);
    await expect(wrapped(41)).resolves.toBe(42);
  });
});
