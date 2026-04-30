// =============================================================================
// PHM × autonomy composition — property-based invariants.
//
// These properties encode load-bearing safety contracts that the autonomy
// resolver and the takeover planner depend on. If any of them ever fail,
// VSBS is unsafe to ship: a regression here can promote a tier-1 unsafe
// reading into a path that mints a Tier-A grant.
//
// Reference: docs/research/prognostics.md §2-4, docs/research/autonomy.md §5.
// =============================================================================

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  phmAction,
  isTierOneSensorDead,
  ComponentIdSchema,
  PhmStateSchema,
  type PhmReading,
  type PhmAction,
  type ComponentId,
  type PhmState,
} from "./phm.js";

const ALL_COMPONENTS = ComponentIdSchema.options as readonly ComponentId[];
const ALL_STATES = PhmStateSchema.options as readonly PhmState[];

const arbComponent = fc.constantFrom(...ALL_COMPONENTS);
const arbState = fc.constantFrom(...ALL_STATES);
const arbTier = fc.constantFrom<1 | 2 | 3>(1, 2, 3);
const arbModelSource = fc.constantFrom(
  "physics-of-failure",
  "empirical-rule",
  "ensemble-transformer",
  "ensemble-lstm",
  "inspection",
);

interface ProbInterval {
  pFailLower: number;
  pFail1000km: number;
  pFailUpper: number;
}

const arbProbInterval = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
  )
  .map<ProbInterval>(([a, b, c]) => {
    const sorted = [a, b, c].sort((x, y) => x - y);
    return {
      pFailLower: sorted[0] ?? 0,
      pFail1000km: sorted[1] ?? 0,
      pFailUpper: sorted[2] ?? 0,
    };
  });

const arbReading = fc
  .record({
    vehicleId: fc.uuid(),
    component: arbComponent,
    tier: arbTier,
    state: arbState,
    interval: arbProbInterval,
    modelSource: arbModelSource,
    featuresVersion: fc.constantFrom("v1", "v2", "v3"),
    suspectedSensorFailure: fc.boolean(),
  })
  .map<PhmReading>((r) => ({
    vehicleId: r.vehicleId,
    component: r.component,
    tier: r.tier,
    state: r.state,
    pFail1000km: r.interval.pFail1000km,
    pFailLower: r.interval.pFailLower,
    pFailUpper: r.interval.pFailUpper,
    modelSource: r.modelSource as PhmReading["modelSource"],
    featuresVersion: r.featuresVersion,
    updatedAt: "2026-04-15T10:00:00.000Z",
    suspectedSensorFailure: r.suspectedSensorFailure,
  }));

describe("PHM × autonomy invariants — property-based", () => {
  it("P1: tier-1 unsafe in motion → takeover-required-and-block-autonomy with mrm=true", () => {
    fc.assert(
      fc.property(arbReading, (raw) => {
        const r: PhmReading = { ...raw, tier: 1, state: "unsafe" };
        const action = phmAction(r, true);
        expect(action.kind).toBe("takeover-required-and-block-autonomy");
        if (action.kind !== "takeover-required-and-block-autonomy") return;
        expect(action.mrm).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("P2: tier-1 with suspected sensor failure → isTierOneSensorDead.dead=true", () => {
    fc.assert(
      fc.property(arbReading, (raw) => {
        const r: PhmReading = { ...raw, tier: 1, suspectedSensorFailure: true };
        const verdict = isTierOneSensorDead([r]);
        expect(verdict.dead).toBe(true);
        expect(verdict.component).toBe(r.component);
        expect(verdict.reason).toMatch(/SOTIF/);
      }),
      { numRuns: 200 },
    );
  });

  it("P3: pFailLower ≤ pFail1000km ≤ pFailUpper holds for the generator", () => {
    fc.assert(
      fc.property(arbReading, (r) => {
        expect(r.pFailLower).toBeLessThanOrEqual(r.pFail1000km);
        expect(r.pFail1000km).toBeLessThanOrEqual(r.pFailUpper);
      }),
      { numRuns: 500 },
    );
  });

  it("P4: action severity is monotone non-decreasing with state, tier-1 + in-motion held fixed", () => {
    // Severity ranking — higher index ⇒ stricter outcome for the autonomy resolver.
    const severityRank: Record<PhmAction["kind"], number> = {
      "silent": 0,
      "remind-next-open": 1,
      "alert-propose-booking": 2,
      "manual-drive-to-shop": 3,
      "refuse-autonomy-propose-mobile": 4,
      "takeover-required-and-block-autonomy": 5,
    };
    const stateOrder: PhmState[] = ["healthy", "watch", "act-soon", "critical", "unsafe"];

    fc.assert(
      fc.property(arbReading, (raw) => {
        let prev = -1;
        for (const s of stateOrder) {
          const r: PhmReading = { ...raw, tier: 1, state: s };
          const k = phmAction(r, true).kind;
          const rank = severityRank[k];
          expect(rank).toBeGreaterThanOrEqual(prev);
          prev = rank;
        }
      }),
      { numRuns: 200 },
    );
  });

  it("P5: phmAction is pure — equal inputs ⇒ equal outputs", () => {
    fc.assert(
      fc.property(arbReading, fc.boolean(), (r, inMotion) => {
        const a1 = phmAction(r, inMotion);
        const a2 = phmAction(r, inMotion);
        expect(a1).toEqual(a2);
      }),
      { numRuns: 500 },
    );
  });

  it("P6: tier-2/3 critical or unsafe never returns takeover at rest", () => {
    fc.assert(
      fc.property(arbReading, fc.constantFrom<2 | 3>(2, 3), fc.constantFrom("critical", "unsafe"), (raw, tier, state) => {
        const r: PhmReading = { ...raw, tier, state: state as PhmState };
        const action = phmAction(r, false);
        expect(action.kind).not.toBe("takeover-required-and-block-autonomy");
      }),
      { numRuns: 300 },
    );
  });

  it("P7: healthy is silent regardless of tier or in-motion", () => {
    fc.assert(
      fc.property(arbReading, fc.boolean(), (raw, inMotion) => {
        const r: PhmReading = { ...raw, state: "healthy" };
        expect(phmAction(r, inMotion)).toEqual({ kind: "silent" });
      }),
      { numRuns: 200 },
    );
  });
});
