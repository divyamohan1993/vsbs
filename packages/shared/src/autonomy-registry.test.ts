import { describe, it, expect } from "vitest";
import {
  resolveAutonomyCapabilityV2,
  SEED_OEM_REGISTRY,
  SEED_GEOFENCE_CATALOGUE,
  type AutonomyCapabilityContextV2,
} from "./autonomy-registry.js";

const baseCtx: AutonomyCapabilityContextV2 = {
  oemId: "mercedes-benz",
  vehicle: {
    make: "Mercedes",
    model: "EQS",
    yearsSupported: [2024, 2025, 2026],
    year: 2026,
    autonomyHw: ["intelligent-park-pilot"],
  },
  destinationProvider: "apcoa-stuttgart-p6",
  providersSupported: ["apcoa-stuttgart-p6"],
  destinationPoint: { lat: 48.78, lng: 9.18 },
  owner: { autonomyConsentGranted: true, insuranceAllowsAutonomy: true },
};

describe("resolveAutonomyCapabilityV2", () => {
  it("all gates green → eligible", () => {
    const r = resolveAutonomyCapabilityV2(baseCtx, SEED_OEM_REGISTRY, SEED_GEOFENCE_CATALOGUE);
    expect(r.eligible).toBe(true);
  });

  it("base resolver failure short-circuits", () => {
    const r = resolveAutonomyCapabilityV2(
      { ...baseCtx, owner: { ...baseCtx.owner, autonomyConsentGranted: false } },
      SEED_OEM_REGISTRY,
      SEED_GEOFENCE_CATALOGUE,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/consent/i);
  });

  it("unknown OEM fails", () => {
    const r = resolveAutonomyCapabilityV2({ ...baseCtx, oemId: "unknown-oem" }, SEED_OEM_REGISTRY, SEED_GEOFENCE_CATALOGUE);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/registry/i);
  });

  it("year outside registry range fails", () => {
    const r = resolveAutonomyCapabilityV2(
      { ...baseCtx, vehicle: { ...baseCtx.vehicle, year: 2022, yearsSupported: [2022, 2023, 2024, 2025, 2026] } },
      SEED_OEM_REGISTRY,
      SEED_GEOFENCE_CATALOGUE,
    );
    expect(r.eligible).toBe(false);
  });

  it("missing hardware fails", () => {
    const r = resolveAutonomyCapabilityV2(
      { ...baseCtx, vehicle: { ...baseCtx.vehicle, autonomyHw: [] } },
      SEED_OEM_REGISTRY,
      SEED_GEOFENCE_CATALOGUE,
    );
    expect(r.eligible).toBe(false);
  });

  it("provider not in OEM approved list fails", () => {
    const r = resolveAutonomyCapabilityV2(
      { ...baseCtx, destinationProvider: "other-provider", providersSupported: ["other-provider"] },
      SEED_OEM_REGISTRY,
      SEED_GEOFENCE_CATALOGUE,
    );
    expect(r.eligible).toBe(false);
  });

  it("destination outside geofence fails", () => {
    const r = resolveAutonomyCapabilityV2(
      { ...baseCtx, destinationPoint: { lat: 48.9, lng: 9.5 } },
      SEED_OEM_REGISTRY,
      SEED_GEOFENCE_CATALOGUE,
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/geofence/i);
  });

  it("insurance gate off when OEM requires it fails", () => {
    const r = resolveAutonomyCapabilityV2(
      { ...baseCtx, owner: { autonomyConsentGranted: true, insuranceAllowsAutonomy: false } },
      SEED_OEM_REGISTRY,
      SEED_GEOFENCE_CATALOGUE,
    );
    expect(r.eligible).toBe(false);
  });
});
