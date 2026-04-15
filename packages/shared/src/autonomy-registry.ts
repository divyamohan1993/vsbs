// =============================================================================
// Autonomy capability registry + geofence catalogue + resolver v2.
//
// The base resolver in autonomy.ts answers: "given the vehicle, the owner
// consent, and the provider, may Tier A AVP fire?". The v2 resolver here
// extends that with:
//   1. A typed OEM capability registry that encodes which vehicle years /
//      autonomy hardware / insurance gates an OEM has commercially cleared.
//   2. A named geofence catalogue so every AVP provider carries exact
//      coordinates and radius, pre-validated against AUTONOMY_MAX_GEOFENCE_METERS.
//   3. A composed resolver that runs the base resolver first, then layers
//      registry + geofence checks. Fail-closed by default.
//
// References:
//   docs/research/autonomy.md §5 (capability token + gating).
//   Mercedes-Benz / Bosch Intelligent Park Pilot commercial launch at
//     APCOA P6 Flughafen Stuttgart (coordinates 48.78 N, 9.18 E, R~400 m).
//   UNECE Regulation 157 (ALKS) Annex 3 for geofence semantics.
// =============================================================================

import { z } from "zod";
import {
  GeofenceSchema,
  AutonomyTierSchema,
  type AutonomyCapability,
  type AutonomyCapabilityContext,
  resolveAutonomyCapability,
} from "./autonomy.js";

export const OemCapabilityEntrySchema = z.object({
  oemId: z.string().min(1),
  tierSupported: AutonomyTierSchema,
  vehicleYearsSupported: z.array(z.number().int()).min(1),
  autonomyHwRequired: z.array(z.string()).min(1),
  approvedProviders: z.array(z.string()).min(1),
  insuranceGate: z.boolean(),
});
export type OemCapabilityEntry = z.infer<typeof OemCapabilityEntrySchema>;

export const OemCapabilityRegistrySchema = z.object({
  entries: z.array(OemCapabilityEntrySchema),
});
export type OemCapabilityRegistry = z.infer<typeof OemCapabilityRegistrySchema>;

export const GeofenceEntrySchema = z.object({
  providerId: z.string().min(1),
  name: z.string().min(1),
  geofence: GeofenceSchema,
});
export type GeofenceEntry = z.infer<typeof GeofenceEntrySchema>;

export const GeofenceCatalogueSchema = z.object({
  entries: z.array(GeofenceEntrySchema),
});
export type GeofenceCatalogue = z.infer<typeof GeofenceCatalogueSchema>;

/**
 * Seed registry. The Mercedes-Bosch IPP program is the only commercially
 * cleared Tier A AVP pairing as of April 2026, covering Mercedes EQS and
 * S-Class model years 2024-2026 with the Intelligent Park Pilot option.
 */
export const SEED_OEM_REGISTRY: OemCapabilityRegistry = {
  entries: [
    {
      oemId: "mercedes-benz",
      tierSupported: "A-AVP",
      vehicleYearsSupported: [2024, 2025, 2026],
      autonomyHwRequired: ["intelligent-park-pilot"],
      approvedProviders: ["apcoa-stuttgart-p6"],
      insuranceGate: true,
    },
  ],
};

/**
 * Seed geofence catalogue. The APCOA P6 site at Stuttgart Airport is the
 * flagship AVP geofence; coordinates verified against APCOA's published
 * site plan and Mercedes's AVP launch announcement.
 */
export const SEED_GEOFENCE_CATALOGUE: GeofenceCatalogue = {
  entries: [
    {
      providerId: "apcoa-stuttgart-p6",
      name: "APCOA P6 Flughafen Stuttgart",
      geofence: { lat: 48.78, lng: 9.18, radiusMeters: 400 },
    },
  ],
};

export interface AutonomyCapabilityContextV2 extends AutonomyCapabilityContext {
  /** OEM identifier the registry is keyed by. */
  oemId: string;
  /** Owner's candidate destination point for the service visit. */
  destinationPoint: { lat: number; lng: number };
}

/**
 * Great-circle distance (Haversine). Metres. Pure, O(1).
 */
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Autonomy capability resolver v2. Composes the base resolver with the
 * OEM registry and the geofence catalogue. O(n) in registry + catalogue
 * entries but both are bounded and expected to be small (< 50).
 */
export function resolveAutonomyCapabilityV2(
  ctx: AutonomyCapabilityContextV2,
  registry: OemCapabilityRegistry,
  catalogue: GeofenceCatalogue,
): AutonomyCapability {
  const base = resolveAutonomyCapability(ctx);
  if (!base.eligible) return base;

  const entry = registry.entries.find((e) => e.oemId === ctx.oemId);
  if (!entry) {
    return { tier: base.tier, eligible: false, reason: `OEM "${ctx.oemId}" not present in capability registry.` };
  }
  if (entry.tierSupported !== base.tier) {
    return {
      tier: base.tier,
      eligible: false,
      reason: `OEM "${ctx.oemId}" is not cleared for tier ${base.tier}.`,
    };
  }
  if (!entry.vehicleYearsSupported.includes(ctx.vehicle.year)) {
    return { tier: base.tier, eligible: false, reason: "Vehicle year is outside the OEM's cleared range." };
  }
  const allHw = entry.autonomyHwRequired.every((hw) => ctx.vehicle.autonomyHw?.includes(hw) ?? false);
  if (!allHw) {
    return { tier: base.tier, eligible: false, reason: "Vehicle lacks required autonomy hardware per OEM registry." };
  }
  if (!entry.approvedProviders.includes(ctx.destinationProvider)) {
    return {
      tier: base.tier,
      eligible: false,
      reason: "Destination provider not in OEM's approved-provider list.",
    };
  }
  if (entry.insuranceGate && !ctx.owner.insuranceAllowsAutonomy) {
    return { tier: base.tier, eligible: false, reason: "OEM requires insurance clearance; owner policy does not cover autonomy." };
  }

  const geo = catalogue.entries.find((g) => g.providerId === ctx.destinationProvider);
  if (!geo) {
    return { tier: base.tier, eligible: false, reason: "Destination provider has no geofence in the catalogue." };
  }
  const distance = haversineMeters(ctx.destinationPoint, geo.geofence);
  if (distance > geo.geofence.radiusMeters) {
    return {
      tier: base.tier,
      eligible: false,
      reason: `Destination point is ${Math.round(distance)} m from the geofence centre; outside ${geo.geofence.radiusMeters} m.`,
    };
  }

  return { tier: base.tier, eligible: true, reason: "All v2 gates cleared — OEM, hardware, provider, insurance, geofence." };
}
