import { describe, it, expect } from "vitest";
import { BrakePadRul, Battery12vRul, RUL_MODELS } from "./rul.js";

describe("BrakePadRul", () => {
  it("10mm → 3mm at 5e-5 mm/km → rul ≈ 140,000 km, pFail ≈ 0", () => {
    const r = BrakePadRul.predict({
      currentMm: 10,
      minSafeMm: 3,
      wearRateMmPerKm: 5e-5,
      wearRateSigma: 1e-6,
    });
    expect(r.rulKmMean).toBeCloseTo(140_000, 0);
    expect(r.pFail1000km).toBeLessThan(0.02);
  });

  it("near-minimum pad → pFail1000km ≈ 1", () => {
    const r = BrakePadRul.predict({
      currentMm: 3.05,
      minSafeMm: 3,
      wearRateMmPerKm: 5e-5,
      wearRateSigma: 1e-6,
    });
    expect(r.pFail1000km).toBeCloseTo(1, 2);
  });

  it("below minimum → rul=0, pFail=1", () => {
    const r = BrakePadRul.predict({
      currentMm: 2,
      minSafeMm: 3,
      wearRateMmPerKm: 5e-5,
      wearRateSigma: 1e-6,
    });
    expect(r.rulKmMean).toBe(0);
    expect(r.pFail1000km).toBe(1);
  });

  it("pFailUpper is clamped to 1", () => {
    const r = BrakePadRul.predict({
      currentMm: 3.1,
      minSafeMm: 3,
      wearRateMmPerKm: 5e-5,
      wearRateSigma: 1e-6,
    });
    expect(r.pFailUpper).toBeLessThanOrEqual(1);
  });
});

describe("Battery12vRul", () => {
  it("12.8 V resting, young, good crank → low pFail", () => {
    const r = Battery12vRul.predict({ restingV: 12.8, ageMonths: 12, crankingV: 11.0 });
    expect(r.pFail1000km).toBeLessThan(0.05);
  });

  it("11.7 V resting → high pFail", () => {
    const r = Battery12vRul.predict({ restingV: 11.7, ageMonths: 12, crankingV: 11.0 });
    expect(r.pFail1000km).toBeGreaterThan(0.9);
  });

  it("old battery dominates even with healthy voltages", () => {
    const r = Battery12vRul.predict({ restingV: 12.8, ageMonths: 60, crankingV: 11.0 });
    // ageFactor = (60-36)/24 = 1 → 0.6
    expect(r.pFail1000km).toBeCloseTo(0.6, 2);
  });

  it("low cranking voltage dominates", () => {
    const r = Battery12vRul.predict({ restingV: 12.8, ageMonths: 12, crankingV: 9.5 });
    // crankFactor = (10.5-9.5)/1.0 = 1 → 0.8
    expect(r.pFail1000km).toBeCloseTo(0.8, 2);
  });
});

describe("RUL_MODELS registry", () => {
  it("maps brake pad and 12v battery components", () => {
    expect(RUL_MODELS["brakes-pads-front"]).toBe(BrakePadRul);
    expect(RUL_MODELS["brakes-pads-rear"]).toBe(BrakePadRul);
    expect(RUL_MODELS["battery-12v"]).toBe(Battery12vRul);
  });
});
