import { describe, it, expect } from "vitest";
import {
  buildTakeoverPrompt,
  escalateTakeover,
  minimumRiskManeuver,
  TakeoverPromptSchema,
  type TakeoverRung,
} from "./takeover.js";

describe("buildTakeoverPrompt", () => {
  it("produces schema-valid prompts for every rung", () => {
    const rungs: TakeoverRung[] = ["informational", "warning", "urgent", "emergency-mrm"];
    for (const r of rungs) {
      const p = buildTakeoverPrompt(r, 1000);
      expect(TakeoverPromptSchema.safeParse(p).success).toBe(true);
      expect(p.rung).toBe(r);
    }
  });

  it("adds modalities monotonically across the ladder", () => {
    const info = buildTakeoverPrompt("informational", 0);
    const warn = buildTakeoverPrompt("warning", 0);
    const urg = buildTakeoverPrompt("urgent", 0);
    const mrm = buildTakeoverPrompt("emergency-mrm", 0);
    expect(info.modalities).toEqual({ visual: true, auditory: false, tactile: false, haptic: false });
    expect(warn.modalities).toEqual({ visual: true, auditory: true, tactile: false, haptic: false });
    expect(urg.modalities).toEqual({ visual: true, auditory: true, tactile: true, haptic: true });
    expect(mrm.modalities).toEqual({ visual: true, auditory: true, tactile: true, haptic: true });
  });
});

describe("escalateTakeover", () => {
  it("holds when elapsed is within the rung window", () => {
    expect(escalateTakeover("informational", 500, false)).toEqual({ kind: "hold", rung: "informational" });
  });

  it("ack short-circuits escalation", () => {
    expect(escalateTakeover("urgent", 999_999, true)).toEqual({ kind: "acknowledged", rung: "urgent" });
  });

  it("escalates informational -> warning", () => {
    const p = buildTakeoverPrompt("informational", 0);
    expect(escalateTakeover("informational", p.maxHoldMs, false)).toEqual({ kind: "escalate", rung: "warning" });
  });

  it("escalates warning -> urgent", () => {
    const p = buildTakeoverPrompt("warning", 0);
    expect(escalateTakeover("warning", p.maxHoldMs, false)).toEqual({ kind: "escalate", rung: "urgent" });
  });

  it("urgent rung elapsed triggers MRM", () => {
    const p = buildTakeoverPrompt("urgent", 0);
    expect(escalateTakeover("urgent", p.maxHoldMs, false)).toEqual({ kind: "mrm-triggered" });
  });

  it("emergency-mrm is terminal", () => {
    expect(escalateTakeover("emergency-mrm", 0, false)).toEqual({ kind: "mrm-triggered" });
    expect(escalateTakeover("emergency-mrm", 0, true)).toEqual({ kind: "mrm-triggered" });
  });
});

describe("minimumRiskManeuver", () => {
  it("hands to driver when driver present and in ODD", () => {
    const plan = minimumRiskManeuver({ speedMps: 15, inOdd: true, hardShoulderReachable: true, driverPresent: true });
    expect(plan.action).toBe("hand-to-driver");
    expect(plan.hazardsOn).toBe(true);
  });

  it("pulls to hard shoulder when reachable and driver absent", () => {
    const plan = minimumRiskManeuver({ speedMps: 20, inOdd: false, hardShoulderReachable: true, driverPresent: false });
    expect(plan.action).toBe("pull-to-hard-shoulder");
    expect(plan.unlockDoorsAfterStop).toBe(true);
  });

  it("stops in lane when no refuge reachable", () => {
    const plan = minimumRiskManeuver({ speedMps: 25, inOdd: false, hardShoulderReachable: false, driverPresent: false });
    expect(plan.action).toBe("slow-to-stop-in-lane");
    expect(plan.hazardsOn).toBe(true);
    expect(plan.unlockDoorsAfterStop).toBe(true);
  });

  it("caps deceleration at R157 limit (4 m/s^2)", () => {
    const plan = minimumRiskManeuver({ speedMps: 30, inOdd: false, hardShoulderReachable: false, driverPresent: false });
    expect(plan.decelMps2).toBeLessThanOrEqual(4);
  });
});
