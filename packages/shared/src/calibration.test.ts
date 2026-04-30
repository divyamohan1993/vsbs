import { describe, it, expect } from "vitest";
import {
  CalibrationKeySchema,
  CalibrationEntrySchema,
  DEFAULT_CALIBRATION_ENTRY,
  SEED_CALIBRATION_ENTRIES,
  CalibrationRegistry,
  buildSeedCalibrationRegistry,
  type CalibrationEntry,
} from "./calibration.js";

describe("CalibrationKeySchema", () => {
  it("accepts a well-formed key", () => {
    expect(() =>
      CalibrationKeySchema.parse({
        oem: "Honda",
        model: "Civic",
        year: 2024,
        region: "IN",
      }),
    ).not.toThrow();
  });

  it("rejects an invalid region code", () => {
    expect(() =>
      CalibrationKeySchema.parse({
        oem: "Honda",
        model: "Civic",
        year: 2024,
        region: "India",
      }),
    ).toThrow();
  });

  it("rejects out-of-range years", () => {
    expect(() =>
      CalibrationKeySchema.parse({
        oem: "Honda",
        model: "Civic",
        year: 1900,
        region: "IN",
      }),
    ).toThrow();
  });
});

describe("CalibrationEntrySchema", () => {
  it("rejects negative wear rates", () => {
    expect(() =>
      CalibrationEntrySchema.parse({
        ...DEFAULT_CALIBRATION_ENTRY,
        brakePadWearRateMmPerKm: -1,
      }),
    ).toThrow();
  });

  it("rejects malformed Arrhenius reference", () => {
    expect(() =>
      CalibrationEntrySchema.parse({
        ...DEFAULT_CALIBRATION_ENTRY,
        hvBatteryArrheniusReferenceC: 200,
      }),
    ).toThrow();
  });

  it("rejects non-positive oil change interval", () => {
    expect(() =>
      CalibrationEntrySchema.parse({
        ...DEFAULT_CALIBRATION_ENTRY,
        oilChangeIntervalKm: 0,
      }),
    ).toThrow();
  });
});

describe("CalibrationRegistry", () => {
  it("returns DEFAULT_CALIBRATION_ENTRY when registry is empty", () => {
    const reg = new CalibrationRegistry();
    const r = reg.get({ oem: "Acme", model: "X", year: 2026, region: "ZZ" });
    expect(r.usedFallback).toBe(true);
    expect(r.entry).toBe(DEFAULT_CALIBRATION_ENTRY);
    expect(r.matchedKey).toEqual(DEFAULT_CALIBRATION_ENTRY.key);
  });

  it("exact-match lookup", () => {
    const reg = new CalibrationRegistry();
    const exact: CalibrationEntry = {
      key: { oem: "Honda", model: "Civic", year: 2024, region: "IN" },
      brakePadWearRateMmPerKm: 0.0002,
      brakePadWearRateSigma: 0.00005,
      tyreWearRateMmPerKm: 0.00018,
      tyreWearRateSigma: 0.00006,
      hvBatteryArrheniusReferenceC: 30,
      oilChangeIntervalKm: 8_000,
      beltLifeKm: 90_000,
      regionNotes: "Civic 2024 India tuned.",
    };
    reg.put(exact);
    const r = reg.get({ oem: "Honda", model: "Civic", year: 2024, region: "IN" });
    expect(r.usedFallback).toBe(false);
    expect(r.entry).toEqual(exact);
    expect(r.matchedKey).toEqual(exact.key);
  });

  it("falls back to regional default when no exact match", () => {
    const reg = buildSeedCalibrationRegistry();
    const r = reg.get({ oem: "Honda", model: "Civic", year: 2024, region: "IN" });
    expect(r.usedFallback).toBe(true);
    expect(r.entry.key.region).toBe("IN");
    expect(r.entry.brakePadWearRateMmPerKm).toBe(0.00018);
  });

  it("falls back to global default when no exact and no regional match", () => {
    const reg = buildSeedCalibrationRegistry();
    const r = reg.get({ oem: "Honda", model: "Civic", year: 2024, region: "JP" });
    expect(r.usedFallback).toBe(true);
    expect(r.entry).toBe(DEFAULT_CALIBRATION_ENTRY);
  });

  it("usedFallback flag is the discriminator the caller relies on", () => {
    const reg = buildSeedCalibrationRegistry();
    const exact: CalibrationEntry = {
      key: { oem: "Honda", model: "Civic", year: 2024, region: "IN" },
      brakePadWearRateMmPerKm: 0.00021,
      brakePadWearRateSigma: 0.00007,
      tyreWearRateMmPerKm: 0.00019,
      tyreWearRateSigma: 0.00006,
      hvBatteryArrheniusReferenceC: 31,
      oilChangeIntervalKm: 7_000,
      beltLifeKm: 75_000,
      regionNotes: "Civic 2024 IN exact.",
    };
    reg.put(exact);
    const exactHit = reg.get({ oem: "Honda", model: "Civic", year: 2024, region: "IN" });
    expect(exactHit.usedFallback).toBe(false);
    const fbHit = reg.get({ oem: "Honda", model: "Accord", year: 2024, region: "IN" });
    expect(fbHit.usedFallback).toBe(true);
  });

  it("rejects malformed entries via Zod at put()", () => {
    const reg = new CalibrationRegistry();
    expect(() =>
      reg.put({
        key: { oem: "Honda", model: "Civic", year: 2024, region: "India" },
        brakePadWearRateMmPerKm: 0.0001,
        brakePadWearRateSigma: 0.00003,
        tyreWearRateMmPerKm: 0.0001,
        tyreWearRateSigma: 0.00003,
        hvBatteryArrheniusReferenceC: 25,
        oilChangeIntervalKm: 10_000,
        beltLifeKm: 100_000,
        regionNotes: "",
      } as CalibrationEntry),
    ).toThrow();
  });

  it("buildSeedCalibrationRegistry seeds at least 4 regional defaults", () => {
    const reg = buildSeedCalibrationRegistry();
    expect(SEED_CALIBRATION_ENTRIES.length).toBeGreaterThanOrEqual(4);
    const sizes = reg.size();
    expect(sizes.regional).toBeGreaterThanOrEqual(3);
  });

  it("deterministic — same put sequence yields same get result", () => {
    const reg1 = buildSeedCalibrationRegistry();
    const reg2 = buildSeedCalibrationRegistry();
    const k = { oem: "X", model: "Y", year: 2024, region: "DE" } as const;
    expect(reg1.get(k)).toEqual(reg2.get(k));
  });
});
