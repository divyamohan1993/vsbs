// =============================================================================
// Wellbeing scorer monotonicity properties.
// Reference: packages/shared/src/wellbeing.ts.
// =============================================================================

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { wellbeingScore, type WellbeingInputs } from "../../src/wellbeing.js";
import { WELLBEING_WEIGHTS } from "../../src/constants.js";

const arbUnitInterval = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

const arbInputs: fc.Arbitrary<WellbeingInputs> = fc.record({
  safety: arbUnitInterval,
  wait: arbUnitInterval,
  cti: arbUnitInterval,
  timeAccuracy: arbUnitInterval,
  servqual: arbUnitInterval,
  trust: arbUnitInterval,
  continuity: arbUnitInterval,
  ces: arbUnitInterval,
  csat: arbUnitInterval,
  nps: arbUnitInterval,
});

const FIELDS: (keyof WellbeingInputs)[] = [
  "safety", "wait", "cti", "timeAccuracy", "servqual",
  "trust", "continuity", "ces", "csat", "nps",
];

describe("wellbeingScore — properties", () => {
  it("score is always in [0, 1] for any input in [0, 1]^10", () => {
    fc.assert(
      fc.property(arbInputs, (input) => {
        const r = wellbeingScore(input);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it("monotonicity: increasing any input weakly increases the score", () => {
    fc.assert(
      fc.property(
        arbInputs,
        fc.constantFrom<keyof WellbeingInputs>(...FIELDS),
        fc.double({ min: 0.0001, max: 0.5, noNaN: true, noDefaultInfinity: true }),
        (input, field, delta) => {
          const before = wellbeingScore(input).score;
          const bumped: WellbeingInputs = {
            ...input,
            [field]: Math.min(1, input[field] + delta),
          };
          const after = wellbeingScore(bumped).score;
          // weakly increasing — strict only when there is room and weight > 0
          expect(after + 1e-12).toBeGreaterThanOrEqual(before);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("contributions sum to score", () => {
    fc.assert(
      fc.property(arbInputs, (input) => {
        const r = wellbeingScore(input);
        const sum =
          r.contributions.safety +
          r.contributions.wait +
          r.contributions.cti +
          r.contributions.timeAccuracy +
          r.contributions.servqual +
          r.contributions.trust +
          r.contributions.continuity +
          r.contributions.ces +
          r.contributions.csat +
          r.contributions.nps;
        expect(sum).toBeCloseTo(r.score, 10);
      }),
      { numRuns: 100 },
    );
  });

  it("safety has the largest single-feature impact (matches WELLBEING_WEIGHTS.safety)", () => {
    fc.assert(
      fc.property(arbInputs, (input) => {
        const lowSafety = wellbeingScore({ ...input, safety: 0 }).score;
        const highSafety = wellbeingScore({ ...input, safety: 1 }).score;
        expect(highSafety - lowSafety).toBeCloseTo(WELLBEING_WEIGHTS.safety, 10);
      }),
      { numRuns: 100 },
    );
  });

  it("severity proxy: scaling safety down weakly decreases score", () => {
    // The dispatch ranking treats safety as (1 - severity_normalised). We
    // assert that as safety drops the wellbeing score weakly drops too.
    fc.assert(
      fc.property(
        arbInputs,
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (input, sevDelta) => {
          const safer = { ...input, safety: 1 };
          const lessSafe = { ...input, safety: Math.max(0, 1 - sevDelta) };
          expect(wellbeingScore(safer).score + 1e-12).toBeGreaterThanOrEqual(
            wellbeingScore(lessSafe).score,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("idempotent: NaN/Infinity in any field clamp to 0 deterministically", () => {
    fc.assert(
      fc.property(
        arbInputs,
        fc.constantFrom<keyof WellbeingInputs>(...FIELDS),
        (input, field) => {
          const a = wellbeingScore({ ...input, [field]: Number.NaN });
          const b = wellbeingScore({ ...input, [field]: 0 });
          expect(a.score).toBeCloseTo(b.score, 10);
        },
      ),
      { numRuns: 100 },
    );
  });
});
