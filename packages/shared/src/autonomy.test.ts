import { describe, it, expect } from "vitest";
import {
  resolveAutonomyCapability,
  CommandGrantSchema,
  type AutonomyCapabilityContext,
} from "./autonomy.js";
import { AUTONOMY_MAX_GRANT_SECONDS, AUTONOMY_MAX_GEOFENCE_METERS } from "./constants.js";

const baseCtx: AutonomyCapabilityContext = {
  vehicle: {
    make: "Mercedes",
    model: "EQS",
    yearsSupported: [2024, 2025, 2026],
    year: 2026,
    autonomyHw: ["intelligent-park-pilot"],
  },
  destinationProvider: "apcoa-stuttgart-p6",
  providersSupported: ["apcoa-stuttgart-p6"],
  owner: { autonomyConsentGranted: true, insuranceAllowsAutonomy: true },
};

describe("resolveAutonomyCapability", () => {
  it("all gates green → eligible=true", () => {
    const r = resolveAutonomyCapability(baseCtx);
    expect(r.eligible).toBe(true);
    expect(r.tier).toBe("A-AVP");
  });

  it("consent off → eligible=false with consent reason", () => {
    const r = resolveAutonomyCapability({ ...baseCtx, owner: { ...baseCtx.owner, autonomyConsentGranted: false } });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/consent/i);
  });

  it("insurance off → eligible=false with insurance reason", () => {
    const r = resolveAutonomyCapability({ ...baseCtx, owner: { ...baseCtx.owner, insuranceAllowsAutonomy: false } });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/insurance/i);
  });

  it("destination not in supported providers → eligible=false", () => {
    const r = resolveAutonomyCapability({ ...baseCtx, providersSupported: [] });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/service center|provider/i);
  });

  it("vehicle year not supported → eligible=false", () => {
    const r = resolveAutonomyCapability({ ...baseCtx, vehicle: { ...baseCtx.vehicle, year: 2010 } });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/year|trim/i);
  });

  it("missing intelligent-park-pilot hw → eligible=false", () => {
    const r = resolveAutonomyCapability({ ...baseCtx, vehicle: { ...baseCtx.vehicle, autonomyHw: [] } });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/park pilot/i);
  });

  it("undefined autonomyHw defaults to not-equipped", () => {
    const { autonomyHw: _omit, ...rest } = baseCtx.vehicle;
    const r = resolveAutonomyCapability({ ...baseCtx, vehicle: rest });
    expect(r.eligible).toBe(false);
  });
});

describe("CommandGrantSchema", () => {
  const validBase = {
    grantId: "11111111-1111-4111-8111-111111111111",
    vehicleId: "veh-1",
    granteeSvcCenterId: "svc-1",
    tier: "A-AVP" as const,
    scopes: ["drive-to-bay" as const],
    notBefore: "2026-04-15T10:00:00.000Z",
    notAfter: "2026-04-15T12:00:00.000Z",
    geofence: { lat: 48.78, lng: 9.18, radiusMeters: 1000 },
    maxAutoPayInr: 5000,
    ownerSigAlg: "ed25519" as const,
    ownerSignatureB64: "sig",
  };

  it("accepts a valid grant", () => {
    const res = CommandGrantSchema.safeParse(validBase);
    expect(res.success).toBe(true);
  });

  it("rejects grant lifetime exceeding AUTONOMY_MAX_GRANT_SECONDS", () => {
    const tooLong = {
      ...validBase,
      notBefore: "2026-04-15T10:00:00.000Z",
      notAfter: new Date(Date.parse("2026-04-15T10:00:00.000Z") + (AUTONOMY_MAX_GRANT_SECONDS + 60) * 1000).toISOString(),
    };
    expect(CommandGrantSchema.safeParse(tooLong).success).toBe(false);
  });

  it("rejects geofence radius above AUTONOMY_MAX_GEOFENCE_METERS", () => {
    const huge = {
      ...validBase,
      geofence: { lat: 0, lng: 0, radiusMeters: AUTONOMY_MAX_GEOFENCE_METERS + 1 },
    };
    expect(CommandGrantSchema.safeParse(huge).success).toBe(false);
  });

  it("rejects notAfter before notBefore", () => {
    const inverted = { ...validBase, notBefore: validBase.notAfter, notAfter: validBase.notBefore };
    expect(CommandGrantSchema.safeParse(inverted).success).toBe(false);
  });
});
