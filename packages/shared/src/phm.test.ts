import { describe, it, expect } from "vitest";
import { phmAction, phmActionWithCoverage, isTierOneSensorDead, type PhmReading } from "./phm.js";
import {
  SEED_TWO_WHEELER_MANIFEST,
  SEED_PASSENGER_LIGHT_MANIFEST,
} from "./coverage-manifest.js";

function reading(partial: Partial<PhmReading>): PhmReading {
  return {
    vehicleId: "v1",
    component: "brakes-pads-front",
    tier: 1,
    state: "healthy",
    pFail1000km: 0,
    pFailLower: 0,
    pFailUpper: 0,
    modelSource: "physics-of-failure",
    featuresVersion: "v1",
    updatedAt: "2026-04-15T10:00:00.000Z",
    suspectedSensorFailure: false,
    ...partial,
  };
}

describe("phmAction", () => {
  it("healthy → silent", () => {
    expect(phmAction(reading({ state: "healthy" }), false)).toEqual({ kind: "silent" });
  });

  it("watch → remind-next-open", () => {
    expect(phmAction(reading({ state: "watch" }), false)).toEqual({ kind: "remind-next-open" });
  });

  it("act-soon → alert-propose-booking amber", () => {
    expect(phmAction(reading({ state: "act-soon" }), false)).toEqual({
      kind: "alert-propose-booking",
      severity: "amber",
    });
  });

  it("critical tier-1 in motion → takeover + mrm", () => {
    expect(phmAction(reading({ state: "critical", tier: 1 }), true)).toEqual({
      kind: "takeover-required-and-block-autonomy",
      mrm: true,
    });
  });

  it("critical tier-1 at rest → takeover, mrm=false", () => {
    expect(phmAction(reading({ state: "critical", tier: 1 }), false)).toEqual({
      kind: "takeover-required-and-block-autonomy",
      mrm: false,
    });
  });

  it("critical tier-2 → refuse-autonomy", () => {
    expect(phmAction(reading({ state: "critical", tier: 2 }), false)).toEqual({
      kind: "refuse-autonomy-propose-mobile",
    });
  });

  it("unsafe in motion → takeover + mrm", () => {
    expect(phmAction(reading({ state: "unsafe", tier: 1 }), true)).toEqual({
      kind: "takeover-required-and-block-autonomy",
      mrm: true,
    });
  });

  it("unsafe tier-1 at rest → takeover, mrm=false", () => {
    expect(phmAction(reading({ state: "unsafe", tier: 1 }), false)).toEqual({
      kind: "takeover-required-and-block-autonomy",
      mrm: false,
    });
  });

  it("unsafe tier-2 at rest → refuse-autonomy", () => {
    expect(phmAction(reading({ state: "unsafe", tier: 2 }), false)).toEqual({
      kind: "refuse-autonomy-propose-mobile",
    });
  });
});

describe("isTierOneSensorDead", () => {
  it("detects tier-1 suspected failure", () => {
    const r = isTierOneSensorDead([
      reading({ component: "brakes-pads-front", tier: 1, suspectedSensorFailure: true }),
    ]);
    expect(r.dead).toBe(true);
    expect(r.component).toBe("brakes-pads-front");
    expect(r.reason).toMatch(/SOTIF/);
  });

  it("ignores tier-2 failures", () => {
    const r = isTierOneSensorDead([
      reading({ component: "imu", tier: 2, suspectedSensorFailure: true }),
    ]);
    expect(r.dead).toBe(false);
  });

  it("returns dead=false for empty list", () => {
    expect(isTierOneSensorDead([]).dead).toBe(false);
  });
});

describe("phmActionWithCoverage", () => {
  it("delegates to phmAction when component is covered", () => {
    const r = reading({ state: "watch", component: "tire-fl" });
    expect(phmActionWithCoverage(r, false, SEED_PASSENGER_LIGHT_MANIFEST)).toEqual({
      kind: "remind-next-open",
    });
  });

  it("refuses with reason when the component is uncovered for the vehicle class", () => {
    // airbag-srs is not in the two-wheeler covered set.
    const r = reading({ state: "healthy", component: "airbag-srs" });
    const action = phmActionWithCoverage(r, false, SEED_TWO_WHEELER_MANIFEST);
    expect(action.kind).toBe("refuse-autonomy-propose-mobile");
    if (action.kind !== "refuse-autonomy-propose-mobile") throw new Error("unreachable");
    expect(action.reason).toBe("component not covered for vehicle class");
  });

  it("uncovered overrides 'unsafe' in motion — refusal still wins", () => {
    // The point: VSBS has no calibrated model, so it cannot say anything
    // operational about it. Refusal is the only honest answer.
    const r = reading({ state: "unsafe", component: "lidar-roof" });
    const action = phmActionWithCoverage(r, true, SEED_TWO_WHEELER_MANIFEST);
    expect(action.kind).toBe("refuse-autonomy-propose-mobile");
  });

  it("preserves takeover behaviour for covered components in motion", () => {
    const r = reading({ state: "unsafe", component: "tire-fl", tier: 1 });
    expect(phmActionWithCoverage(r, true, SEED_PASSENGER_LIGHT_MANIFEST)).toEqual({
      kind: "takeover-required-and-block-autonomy",
      mrm: true,
    });
  });
});
