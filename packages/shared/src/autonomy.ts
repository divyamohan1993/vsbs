// =============================================================================
// Autonomy — CommandGrant capability model and helpers.
// Reference: docs/research/autonomy.md §5, docs/research/security.md §7.
// =============================================================================

import { z } from "zod";
import {
  AUTONOMY_MAX_GRANT_SECONDS,
  AUTONOMY_MAX_GEOFENCE_METERS,
} from "./constants.js";

export const AutonomyTierSchema = z.enum([
  "A-AVP", // Automated Valet Parking, geofenced, commercially approved (Mercedes/Bosch Stuttgart)
  "A-SUMMON", // Summon / smart-summon on private property
  "B-L3-HIGHWAY", // Mercedes DRIVE PILOT L3 conditional, highway only
  "B-L4-ROBOTAXI", // operator-owned fleets only
  "C-ROADMAP", // not available in consumer cars as of April 2026
]);
export type AutonomyTier = z.infer<typeof AutonomyTierSchema>;

export const GrantScopeSchema = z.enum([
  "diagnose",
  "drive-to-bay",
  "repair",
  "test-drive",
  "drive-home",
]);
export type GrantScope = z.infer<typeof GrantScopeSchema>;

export const GeofenceSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z
    .number()
    .positive()
    .max(AUTONOMY_MAX_GEOFENCE_METERS),
});
export type Geofence = z.infer<typeof GeofenceSchema>;

/**
 * A signed, time-bounded, amount-bounded capability token. The token is
 * minted by the owner's device (passkey/WebAuthn) and co-signed by the
 * concierge agent and, where applicable, the insurer. The service center
 * receives only the token; every action it takes under the token is logged
 * to an append-only chain (Merkle) that the owner can audit.
 */
export const CommandGrantSchema = z
  .object({
    grantId: z.string().uuid(),
    vehicleId: z.string(),
    granteeSvcCenterId: z.string(),
    tier: AutonomyTierSchema,
    scopes: z.array(GrantScopeSchema).min(1),
    notBefore: z.string().datetime(),
    notAfter: z.string().datetime(),
    geofence: GeofenceSchema,
    maxAutoPayInr: z.number().int().nonnegative(),
    mustNotify: z
      .array(z.enum(["start", "any_write", "finish", "scope_change"]))
      .default(["start", "any_write", "finish"]),
    ownerSigAlg: z.enum(["webauthn-es256", "webauthn-rs256", "ml-dsa-65", "ed25519"]),
    ownerSignatureB64: z.string().min(1),
    witnessSignaturesB64: z.record(z.string(), z.string()).default({}),
  })
  .refine(
    (g) =>
      (new Date(g.notAfter).getTime() - new Date(g.notBefore).getTime()) / 1000 <=
      AUTONOMY_MAX_GRANT_SECONDS,
    { message: `Grant lifetime exceeds AUTONOMY_MAX_GRANT_SECONDS (${AUTONOMY_MAX_GRANT_SECONDS}s)` },
  )
  .refine((g) => new Date(g.notAfter) > new Date(g.notBefore), {
    message: "notAfter must be after notBefore",
  });
export type CommandGrant = z.infer<typeof CommandGrantSchema>;

export const AutonomyActionSchema = z.object({
  actionId: z.string().uuid(),
  grantId: z.string().uuid(),
  timestamp: z.string().datetime(),
  kind: z.enum([
    "grant-accepted",
    "move-start",
    "move-stop",
    "diagnose-start",
    "diagnose-finish",
    "repair-start",
    "repair-finish",
    "payment-hold",
    "payment-settle",
    "grant-revoked",
    "takeover-request",
    "takeover-acknowledged",
    "minimum-risk-maneuver",
  ]),
  payloadHash: z.string().length(64),
  prevChainHash: z.string().length(64).optional(),
  chainHash: z.string().length(64),
});
export type AutonomyAction = z.infer<typeof AutonomyActionSchema>;

export interface AutonomyCapability {
  tier: AutonomyTier;
  /** True iff the vehicle is currently eligible for this tier at the candidate location. */
  eligible: boolean;
  /** Why, in one line, for the UI explanation drawer. */
  reason: string;
}

/**
 * A simple capability resolver the Autonomy specialist uses to decide if
 * it can mint a Tier-A grant. This is intentionally conservative:
 * returning `eligible: false` is always safe.
 */
export interface AutonomyCapabilityContext {
  vehicle: {
    make: string;
    model: string;
    yearsSupported: number[];
    year: number;
    autonomyHw?: string[] | undefined;
  };
  destinationProvider: string; // e.g. "apcoa-stuttgart-p6"
  providersSupported: string[]; // from AUTONOMY_TIER_A_AVP_PROVIDERS
  owner: { autonomyConsentGranted: boolean; insuranceAllowsAutonomy: boolean };
}

export function resolveAutonomyCapability(ctx: AutonomyCapabilityContext): AutonomyCapability {
  if (!ctx.owner.autonomyConsentGranted) {
    return { tier: "A-AVP", eligible: false, reason: "Owner has not consented to autonomy delegation." };
  }
  if (!ctx.owner.insuranceAllowsAutonomy) {
    return { tier: "A-AVP", eligible: false, reason: "Owner's insurance policy does not cover autonomous operation." };
  }
  if (!ctx.providersSupported.includes(ctx.destinationProvider)) {
    return { tier: "A-AVP", eligible: false, reason: "Destination service center does not host an approved AVP provider." };
  }
  if (!ctx.vehicle.yearsSupported.includes(ctx.vehicle.year)) {
    return { tier: "A-AVP", eligible: false, reason: "Vehicle year/trim is not in the supported list for this provider." };
  }
  const has = (hw: string): boolean => ctx.vehicle.autonomyHw?.includes(hw) ?? false;
  if (!has("intelligent-park-pilot")) {
    return { tier: "A-AVP", eligible: false, reason: "Vehicle is not equipped with Intelligent Park Pilot." };
  }
  return { tier: "A-AVP", eligible: true, reason: "All gates cleared — Tier A AVP available." };
}
