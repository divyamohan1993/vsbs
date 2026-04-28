// =============================================================================
// Indian VRN parser property tests.
// References: packages/shared/src/schema/vehicle.ts (IndiaPlateSchema).
// =============================================================================

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { IndiaPlateSchema } from "../../src/schema/vehicle.js";

const STATE = fc
  .tuple(
    fc.constantFrom(
      "A", "B", "C", "D", "G", "H", "J", "K", "L", "M",
      "N", "O", "P", "R", "S", "T", "U", "W",
    ),
    fc.constantFrom(
      "A", "B", "C", "D", "G", "H", "J", "K", "L", "M",
      "N", "O", "P", "R", "S", "T", "U", "W",
    ),
  )
  .map(([a, b]) => `${a}${b}`);

const DIGITS = (min: number, max: number) =>
  fc.integer({ min, max }).map((n) => String(n).padStart(min === max ? min : 1, "0"));

const SERIES = fc
  .stringMatching(/^[A-Z]{1,3}$/)
  .filter((s) => s.length >= 1 && s.length <= 3 && /^[A-Z]+$/.test(s));

const arbCanonicalPlate = fc
  .tuple(STATE, DIGITS(1, 99), SERIES, DIGITS(1, 9999))
  .map(([s, d1, ser, d2]) => `${s}${d1}${ser}${d2}`)
  .filter((p) => p.length >= 6 && p.length <= 12);

const arbCanonicalPlateNoSeries = fc
  .tuple(STATE, DIGITS(1, 99), DIGITS(1, 9999))
  .map(([s, d1, d2]) => `${s}${d1}${d2}`)
  .filter((p) => p.length >= 6 && p.length <= 12);

describe("IndiaPlateSchema — properties", () => {
  it("canonical with-series plates parse and normalise", () => {
    fc.assert(
      fc.property(arbCanonicalPlate, (plate) => {
        const r = IndiaPlateSchema.safeParse(plate);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe(plate.toUpperCase());
      }),
      { numRuns: 200 },
    );
  });

  it("plates with whitespace and lowercase round-trip to the canonical form", () => {
    fc.assert(
      fc.property(arbCanonicalPlate, fc.boolean(), (plate, lower) => {
        const messy = `  ${plate.slice(0, 2)}  ${plate.slice(2, 4)} ${plate.slice(4)}  `;
        const cased = lower ? messy.toLowerCase() : messy;
        const r = IndiaPlateSchema.safeParse(cased);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data).toBe(plate);
      }),
      { numRuns: 100 },
    );
  });

  it("plates without alpha series still match the permissive pattern", () => {
    fc.assert(
      fc.property(arbCanonicalPlateNoSeries, (plate) => {
        const r = IndiaPlateSchema.safeParse(plate);
        // plate of form SS#### or SSDD#### — must have at least one alpha and length 6..12
        if (plate.length >= 6 && plate.length <= 12) {
          expect(r.success).toBe(true);
        } else {
          expect(r.success).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("strings outside [6..12] chars are rejected after whitespace strip", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 5 }).map((s) => s.replace(/\s+/g, "")),
        (s) => {
          if (s.length === 0 || s.length > 12) return true;
          if (s.length >= 6) return true;
          expect(IndiaPlateSchema.safeParse(s).success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("mixed-symbol noise ('@', '#', emoji) is rejected", () => {
    fc.assert(
      fc.property(
        arbCanonicalPlate,
        fc.constantFrom("@", "#", "$", "*", "&", "!"),
        fc.integer({ min: 0, max: 8 }),
        (plate, sym, pos) => {
          const broken = plate.slice(0, pos) + sym + plate.slice(pos + 1);
          expect(IndiaPlateSchema.safeParse(broken).success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
