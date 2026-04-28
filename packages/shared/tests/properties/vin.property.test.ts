// =============================================================================
// VIN check-digit property tests.
// References: ISO 3779, packages/shared/src/schema/vehicle.ts.
// =============================================================================

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { VinSchema, vinCheckDigitValid } from "../../src/schema/vehicle.js";

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789".split("");
const VIN_TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4,
  "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function computeCheckChar(seventeen: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += (VIN_TRANSLIT[seventeen[i]!] ?? 0) * VIN_WEIGHTS[i]!;
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

const arbVinChar = fc.constantFrom(...VIN_CHARS);

/** Generate a valid VIN by computing the right ISO 3779 check digit. */
const arbValidVin = fc
  .array(arbVinChar, { minLength: 17, maxLength: 17 })
  .map((chars) => {
    const arr = [...chars];
    arr[8] = "0";
    const candidate = arr.join("");
    arr[8] = computeCheckChar(candidate);
    return arr.join("");
  });

describe("VIN check digit (ISO 3779) — properties", () => {
  it("every generated valid VIN passes vinCheckDigitValid", () => {
    fc.assert(
      fc.property(arbValidVin, (vin) => {
        expect(vinCheckDigitValid(vin)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("every generated valid VIN parses through VinSchema", () => {
    fc.assert(
      fc.property(arbValidVin, (vin) => {
        const parsed = VinSchema.safeParse(vin);
        expect(parsed.success).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("tampering any digit position 0..7 or 9..16 is detected with high probability", () => {
    fc.assert(
      fc.property(
        arbValidVin,
        fc.integer({ min: 0, max: 16 }),
        arbVinChar,
        (vin, pos, replacement) => {
          if (pos === 8) return true; // skip the check-digit slot itself
          if (vin[pos] === replacement) return true; // identical = no tamper
          const tampered = vin.slice(0, pos) + replacement + vin.slice(pos + 1);
          // Tampering invalidates the check digit unless we coincidentally land on a collision.
          // The property: the *probability of collision* across the full domain matches the
          // 1/11 expectation. We assert: when collision did NOT happen, the validator catches it.
          const expectedCheck = computeCheckChar(tampered);
          if (expectedCheck === tampered[8]) return true; // collision; the math is consistent
          expect(vinCheckDigitValid(tampered)).toBe(false);
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it("VIN with a forbidden alphabet character (I, O, Q) is rejected", () => {
    fc.assert(
      fc.property(
        arbValidVin,
        fc.integer({ min: 0, max: 16 }),
        fc.constantFrom("I", "O", "Q"),
        (vin, pos, badChar) => {
          const tampered = vin.slice(0, pos) + badChar + vin.slice(pos + 1);
          expect(vinCheckDigitValid(tampered)).toBe(false);
          expect(VinSchema.safeParse(tampered).success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("VIN of wrong length is always rejected", () => {
    fc.assert(
      fc.property(
        fc.array(arbVinChar, { minLength: 0, maxLength: 25 }).filter((a) => a.length !== 17),
        (chars) => {
          expect(vinCheckDigitValid(chars.join(""))).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
