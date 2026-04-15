import { describe, it, expect } from "vitest";
import {
  BrakePadRul,
  Battery12vRul,
  TyreTreadRul,
  HvBatterySohRul,
  EngineOilRul,
  DriveBeltRul,
  WheelBearingRul,
  RUL_MODELS,
} from "./rul.js";

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

describe("TyreTreadRul", () => {
  it("new tyre 8 mm → long RUL at typical wear rate", () => {
    const r = TyreTreadRul.predict({
      currentMm: 8,
      minSafeMm: 1.6,
      wearRateMmPerKm: 7e-5,
      wearRateSigma: 5e-6,
    });
    expect(r.rulKmMean!).toBeGreaterThan(80_000);
    expect(r.pFail1000km).toBeLessThan(0.02);
  });

  it("at legal minimum → pFail = 1", () => {
    const r = TyreTreadRul.predict({
      currentMm: 1.6,
      minSafeMm: 1.6,
      wearRateMmPerKm: 7e-5,
      wearRateSigma: 5e-6,
    });
    expect(r.pFail1000km).toBe(1);
    expect(r.rulKmMean).toBe(0);
  });
});

describe("HvBatterySohRul", () => {
  it("young healthy pack → low pFail", () => {
    const r = HvBatterySohRul.predict({
      cyclesDone: 50,
      capacityFadePct: 1,
      cRateAvg: 0.8,
      avgCellTempC: 25,
    });
    expect(r.pFail1000km).toBeLessThan(0.1);
  });

  it("hot pack + high C-rate collapses RUL", () => {
    const r = HvBatterySohRul.predict({
      cyclesDone: 900,
      capacityFadePct: 19.5,
      cRateAvg: 3,
      avgCellTempC: 55,
    });
    expect(r.pFail1000km).toBeGreaterThan(0.6);
  });

  it("at 20% fade → no margin", () => {
    const r = HvBatterySohRul.predict({
      cyclesDone: 1200,
      capacityFadePct: 20,
      cRateAvg: 1,
      avgCellTempC: 25,
    });
    expect(r.pFail1000km).toBe(1);
  });
});

describe("EngineOilRul", () => {
  it("fresh oil → low pFail", () => {
    const r = EngineOilRul.predict({
      monthsSinceChange: 0,
      kmSinceChange: 100,
      viscosityDropPct: 2,
    });
    expect(r.pFail1000km).toBeLessThan(0.1);
  });

  it("over-age viscosity collapse → escalates", () => {
    const r = EngineOilRul.predict({
      monthsSinceChange: 14,
      kmSinceChange: 11_000,
      viscosityDropPct: 35,
    });
    expect(r.pFail1000km).toBe(1);
  });
});

describe("DriveBeltRul", () => {
  it("new belt → long RUL", () => {
    const r = DriveBeltRul.predict({
      monthsInService: 1,
      kmInService: 200,
      tensionerSlipPct: 0,
    });
    expect(r.rulKmMean!).toBeGreaterThan(80_000);
    expect(r.pFail1000km).toBeLessThan(0.02);
  });

  it("high tensioner slip dominates", () => {
    const r = DriveBeltRul.predict({
      monthsInService: 24,
      kmInService: 50_000,
      tensionerSlipPct: 6,
    });
    expect(r.pFail1000km).toBe(1);
  });
});

describe("WheelBearingRul", () => {
  it("healthy vibration signature → low pFail", () => {
    const r = WheelBearingRul.predict({ rmsG: 0.15, peakG: 0.6, kurtosis: 3.0 });
    expect(r.pFail1000km).toBeLessThan(0.05);
    expect(r.rulKmMean!).toBeGreaterThan(20_000);
  });

  it("ISO 10816 zone C RMS → escalates", () => {
    const r = WheelBearingRul.predict({ rmsG: 0.9, peakG: 2.5, kurtosis: 6.0 });
    expect(r.pFail1000km).toBeGreaterThan(0.9);
  });
});

describe("RUL_MODELS registry", () => {
  it("maps brake pad and 12v battery components", () => {
    expect(RUL_MODELS["brakes-pads-front"]).toBe(BrakePadRul);
    expect(RUL_MODELS["brakes-pads-rear"]).toBe(BrakePadRul);
    expect(RUL_MODELS["battery-12v"]).toBe(Battery12vRul);
  });

  it("maps tyres, HV battery, oil, belt, bearings", () => {
    expect(RUL_MODELS["tire-fl"]).toBe(TyreTreadRul);
    expect(RUL_MODELS["tire-fr"]).toBe(TyreTreadRul);
    expect(RUL_MODELS["tire-rl"]).toBe(TyreTreadRul);
    expect(RUL_MODELS["tire-rr"]).toBe(TyreTreadRul);
    expect(RUL_MODELS["battery-hv"]).toBe(HvBatterySohRul);
    expect(RUL_MODELS["engine-oil-system"]).toBe(EngineOilRul);
    expect(RUL_MODELS["drive-belt"]).toBe(DriveBeltRul);
    expect(RUL_MODELS["wheel-bearings"]).toBe(WheelBearingRul);
  });
});
