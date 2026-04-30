import { describe, it, expect } from "vitest";
import {
  CoverageManifestSchema,
  SEED_PASSENGER_LIGHT_MANIFEST,
  SEED_HCV_MANIFEST,
  SEED_TWO_WHEELER_MANIFEST,
  SEED_COVERAGE_MANIFESTS,
  getSeedManifest,
  assertCovered,
  refuseIfTier1Uncovered,
  CoverageGap,
} from "./coverage-manifest.js";
import type { ComponentId } from "./phm.js";

describe("CoverageManifestSchema", () => {
  it("accepts the seeded passenger-light manifest", () => {
    expect(() => CoverageManifestSchema.parse(SEED_PASSENGER_LIGHT_MANIFEST)).not.toThrow();
  });
  it("accepts the seeded HCV manifest", () => {
    expect(() => CoverageManifestSchema.parse(SEED_HCV_MANIFEST)).not.toThrow();
  });
  it("accepts the seeded two-wheeler manifest", () => {
    expect(() => CoverageManifestSchema.parse(SEED_TWO_WHEELER_MANIFEST)).not.toThrow();
  });
  it("rejects an empty coveredComponents list", () => {
    expect(() =>
      CoverageManifestSchema.parse({
        vehicleClass: "passenger-light",
        modelVersion: "v1",
        coveredComponents: [],
      }),
    ).toThrow();
  });
});

describe("seed manifests — content", () => {
  it("passenger-light covers the full tier-1 set", () => {
    const set = new Set(SEED_PASSENGER_LIGHT_MANIFEST.coveredComponents);
    for (const c of [
      "brakes-hydraulic",
      "brakes-pads-front",
      "brakes-pads-rear",
      "abs-module",
      "steering-eps",
      "tire-fl",
      "tire-fr",
      "tire-rl",
      "tire-rr",
      "airbag-srs",
      "adas-camera-front",
      "adas-radar-front",
      "lidar-roof",
      "battery-hv",
    ] as ComponentId[]) {
      expect(set.has(c)).toBe(true);
    }
  });

  it("HCV manifest deliberately excludes light-duty disc-pad models", () => {
    expect(SEED_HCV_MANIFEST.coveredComponents).not.toContain("brakes-pads-front");
    expect(SEED_HCV_MANIFEST.coveredComponents).not.toContain("brakes-pads-rear");
    expect(SEED_HCV_MANIFEST.coveredComponents).not.toContain("brakes-hydraulic");
    const gaps = SEED_HCV_MANIFEST.knownGaps.map((g) => g.component);
    expect(gaps).toContain("brakes-hydraulic");
    expect(gaps).toContain("brakes-pads-front");
  });

  it("two-wheeler manifest has a narrow covered set", () => {
    expect(SEED_TWO_WHEELER_MANIFEST.coveredComponents.length).toBeLessThan(10);
    expect(SEED_TWO_WHEELER_MANIFEST.coveredComponents).toContain("tire-fl");
    expect(SEED_TWO_WHEELER_MANIFEST.coveredComponents).toContain("tire-fr");
    expect(SEED_TWO_WHEELER_MANIFEST.coveredComponents).not.toContain("tire-rl");
    expect(SEED_TWO_WHEELER_MANIFEST.coveredComponents).not.toContain("tire-rr");
  });

  it("getSeedManifest returns undefined for non-seeded classes", () => {
    expect(getSeedManifest("suv")).toBeUndefined();
    expect(getSeedManifest("lcv")).toBeUndefined();
    expect(getSeedManifest("three-wheeler")).toBeUndefined();
    expect(getSeedManifest("ev-passenger")).toBeUndefined();
  });

  it("getSeedManifest returns the seeded manifest for seeded classes", () => {
    expect(getSeedManifest("passenger-light")).toBe(SEED_PASSENGER_LIGHT_MANIFEST);
    expect(getSeedManifest("hcv")).toBe(SEED_HCV_MANIFEST);
    expect(getSeedManifest("two-wheeler")).toBe(SEED_TWO_WHEELER_MANIFEST);
  });

  it("SEED_COVERAGE_MANIFESTS keys all known vehicle classes", () => {
    const expected: Array<keyof typeof SEED_COVERAGE_MANIFESTS> = [
      "passenger-light",
      "suv",
      "lcv",
      "hcv",
      "two-wheeler",
      "three-wheeler",
      "ev-passenger",
    ];
    for (const k of expected) {
      expect(k in SEED_COVERAGE_MANIFESTS).toBe(true);
    }
  });
});

describe("assertCovered", () => {
  it("partitions components into covered and uncovered", () => {
    const r = assertCovered(SEED_TWO_WHEELER_MANIFEST, [
      "tire-fl",
      "brakes-pads-front",
      "airbag-srs", // tier-1, uncovered for two-wheeler
      "lidar-roof", // tier-1, uncovered
    ]);
    expect(r.covered).toEqual(["tire-fl", "brakes-pads-front"]);
    expect(r.uncovered.sort()).toEqual(["airbag-srs", "lidar-roof"]);
    expect(r.tier1Uncovered.sort()).toEqual(["airbag-srs", "lidar-roof"]);
  });

  it("returns no uncovered when manifest covers everything requested", () => {
    const r = assertCovered(SEED_PASSENGER_LIGHT_MANIFEST, [
      "brakes-hydraulic",
      "tire-fl",
      "battery-hv",
    ]);
    expect(r.uncovered).toEqual([]);
    expect(r.tier1Uncovered).toEqual([]);
    expect(r.covered.length).toBe(3);
  });

  it("classifies uncovered tier-2 components as uncovered but not tier1Uncovered", () => {
    const r = assertCovered(SEED_TWO_WHEELER_MANIFEST, ["alternator", "imu"]);
    expect(r.uncovered.sort()).toEqual(["alternator", "imu"]);
    expect(r.tier1Uncovered).toEqual([]);
  });
});

describe("refuseIfTier1Uncovered", () => {
  it("throws CoverageGap when an HCV is asked about hydraulic brakes", () => {
    expect(() =>
      refuseIfTier1Uncovered(SEED_HCV_MANIFEST, ["brakes-hydraulic"]),
    ).toThrow(CoverageGap);
  });

  it("CoverageGap carries vehicleClass and missing list", () => {
    try {
      refuseIfTier1Uncovered(SEED_HCV_MANIFEST, ["brakes-hydraulic", "steering-eps"]);
      throw new Error("did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CoverageGap);
      const cg = e as CoverageGap;
      expect(cg.vehicleClass).toBe("hcv");
      expect(cg.missing.sort()).toEqual(["brakes-hydraulic", "steering-eps"]);
      expect(cg.code).toBe("coverage-gap");
    }
  });

  it("does not throw when all tier-1 components are covered", () => {
    expect(() =>
      refuseIfTier1Uncovered(SEED_PASSENGER_LIGHT_MANIFEST, [
        "brakes-hydraulic",
        "tire-fl",
        "lidar-roof",
        "battery-hv",
      ]),
    ).not.toThrow();
  });

  it("does not throw when only tier-2 or tier-3 components are uncovered", () => {
    expect(() =>
      refuseIfTier1Uncovered(SEED_TWO_WHEELER_MANIFEST, ["alternator", "suspension-dampers"]),
    ).not.toThrow();
  });
});
