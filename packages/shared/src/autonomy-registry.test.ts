import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  resolveAutonomyCapabilityV2,
  SEED_OEM_REGISTRY,
  SEED_GEOFENCE_CATALOGUE,
  type AutonomyCapabilityContextV2,
} from "./autonomy-registry.js";
import {
  resolveAutonomyCapabilityV3,
  loadVerifiedCatalogue,
  signGeofenceEntry,
  verifyGeofenceEntry,
  type GeofenceKeyResolver,
  type GeofenceWitnessSigningKey,
  type GeofenceWitnessVerifyingKey,
  type SignedGeofenceEntry,
} from "./autonomy-registry-signing.js";

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

function makeKey(keyId: string): {
  signing: GeofenceWitnessSigningKey;
  verifying: GeofenceWitnessVerifyingKey;
} {
  const kp = ml_dsa65.keygen();
  return {
    signing: { keyId, secretKey: new Uint8Array(kp.secretKey) },
    verifying: { keyId, publicKey: new Uint8Array(kp.publicKey) },
  };
}

const validity = {
  validFrom: "2026-01-01T00:00:00.000Z",
  validTo: "2027-01-01T00:00:00.000Z",
  signerNote: "test fixture",
};

describe("signed geofence entries (E3)", () => {
  it("round trips: sign -> verify", () => {
    const { signing, verifying } = makeKey("witness-A");
    const resolver: GeofenceKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const seed = SEED_GEOFENCE_CATALOGUE.entries[0]!;
    const signed = signGeofenceEntry(seed, signing, validity);
    const r = verifyGeofenceEntry(signed, resolver, new Date("2026-04-15T00:00:00.000Z"));
    expect(r.valid).toBe(true);
  });

  it("rejects a tampered entry", () => {
    const { signing, verifying } = makeKey("witness-B");
    const resolver: GeofenceKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const seed = SEED_GEOFENCE_CATALOGUE.entries[0]!;
    const signed = signGeofenceEntry(seed, signing, validity);
    const tampered: SignedGeofenceEntry = {
      ...signed,
      entry: {
        ...signed.entry,
        geofence: { ...signed.entry.geofence, radiusMeters: 5000 },
      },
    };
    const r = verifyGeofenceEntry(tampered, resolver, new Date("2026-04-15T00:00:00.000Z"));
    expect(r.valid).toBe(false);
  });

  it("rejects an expired entry", () => {
    const { signing, verifying } = makeKey("witness-C");
    const resolver: GeofenceKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const seed = SEED_GEOFENCE_CATALOGUE.entries[0]!;
    const signed = signGeofenceEntry(seed, signing, {
      validFrom: "2025-01-01T00:00:00.000Z",
      validTo: "2025-06-01T00:00:00.000Z",
    });
    const r = verifyGeofenceEntry(signed, resolver, new Date("2026-04-15T00:00:00.000Z"));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/expired/);
  });

  it("loadVerifiedCatalogue surfaces reasons for rejected entries", () => {
    const { signing: keyAS, verifying: keyAV } = makeKey("witness-D");
    const { signing: keyBS } = makeKey("witness-E");
    const resolver: GeofenceKeyResolver = (id) => (id === keyAV.keyId ? keyAV : undefined);
    const seed = SEED_GEOFENCE_CATALOGUE.entries[0]!;
    const goodSigned = signGeofenceEntry(seed, keyAS, validity);
    const badSigned = signGeofenceEntry(
      { ...seed, providerId: "ghost-site", name: "Ghost Site" },
      keyBS,
      validity,
    );
    const result = loadVerifiedCatalogue([goodSigned, badSigned], resolver, new Date("2026-04-15T00:00:00.000Z"));
    expect(result.catalogue.entries).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.providerId).toBe("ghost-site");
    expect(result.rejected[0]!.reason).toMatch(/keyId/);
  });

  it("v3 only accepts the verified subset", () => {
    const { signing, verifying } = makeKey("witness-F");
    const resolver: GeofenceKeyResolver = (id) => (id === verifying.keyId ? verifying : undefined);
    const seed = SEED_GEOFENCE_CATALOGUE.entries[0]!;
    const signed = signGeofenceEntry(seed, signing, validity);
    const r = resolveAutonomyCapabilityV3(
      baseCtx,
      SEED_OEM_REGISTRY,
      [signed],
      resolver,
      new Date("2026-04-15T00:00:00.000Z"),
    );
    expect(r.eligible).toBe(true);
    expect(r.rejected).toHaveLength(0);
  });

  it("v3 fails closed when no entries verify", () => {
    const { signing } = makeKey("witness-G");
    const noKeyResolver: GeofenceKeyResolver = () => undefined;
    const seed = SEED_GEOFENCE_CATALOGUE.entries[0]!;
    const signed = signGeofenceEntry(seed, signing, validity);
    const r = resolveAutonomyCapabilityV3(
      baseCtx,
      SEED_OEM_REGISTRY,
      [signed],
      noKeyResolver,
      new Date("2026-04-15T00:00:00.000Z"),
    );
    expect(r.eligible).toBe(false);
    expect(r.rejected.length).toBeGreaterThan(0);
  });
});
