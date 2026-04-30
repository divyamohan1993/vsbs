// =============================================================================
// Signed geofence registry entries (E3) and autonomy capability resolver v3.
//
// Why this exists:
//   The v2 resolver in autonomy-registry.ts happily accepts an in-memory
//   catalogue. In production a stale or tampered catalogue is a safety
//   hazard — a wrong radius or shifted centre would let the vehicle drive
//   autonomously outside the cleared site. Every catalogue entry must
//   therefore carry an ML-DSA-65 signature from a known witness key, with a
//   validity window. The v3 resolver only accepts a verified subset;
//   rejected entries are surfaced (never silently dropped) so operators
//   can investigate.
//
// This module is intentionally separate from autonomy-registry.ts so that
// consumers that only need the schemas, types, and v2 resolver do not
// transitively pull in @noble/post-quantum at module-load time. Pure
// CommonJS jest runtimes (e.g. apps/mobile) cannot transform the pure-ESM
// @noble package, so the schema-only path stays clean.
//
// References:
//   FIPS 204 (ML-DSA, security category 3 used here).
//   docs/research/security.md §1 (PQ envelope rationale).
// =============================================================================

import { z } from "zod";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { canonicalize } from "./commandgrant-lifecycle.js";
import {
  GeofenceEntrySchema,
  type GeofenceEntry,
  type GeofenceCatalogue,
  type AutonomyCapabilityContextV2,
  type OemCapabilityRegistry,
  resolveAutonomyCapabilityV2,
} from "./autonomy-registry.js";
import type { AutonomyCapability } from "./autonomy.js";

export const SignedGeofenceEntrySchema = z
  .object({
    entry: GeofenceEntrySchema,
    keyId: z.string().min(1),
    /** RFC 3339 datetime; entry valid only between validFrom and validTo. */
    validFrom: z.string().datetime(),
    validTo: z.string().datetime(),
    signerNote: z.string().max(500).default(""),
    signatureB64: z.string().min(1),
  })
  .strict()
  .refine((s) => Date.parse(s.validTo) > Date.parse(s.validFrom), {
    message: "validTo must be after validFrom",
  });
export type SignedGeofenceEntry = z.infer<typeof SignedGeofenceEntrySchema>;

export const SignedGeofenceCatalogueSchema = z.object({
  entries: z.array(SignedGeofenceEntrySchema),
});
export type SignedGeofenceCatalogue = z.infer<typeof SignedGeofenceCatalogueSchema>;

export interface GeofenceWitnessSigningKey {
  keyId: string;
  /** ML-DSA-65 secret key (4032 bytes). */
  secretKey: Uint8Array;
}

export interface GeofenceWitnessVerifyingKey {
  keyId: string;
  /** ML-DSA-65 public key (1952 bytes). */
  publicKey: Uint8Array;
}

export type GeofenceKeyResolver = (
  keyId: string,
) => GeofenceWitnessVerifyingKey | undefined;

interface SigningPayload {
  entry: GeofenceEntry;
  keyId: string;
  validFrom: string;
  validTo: string;
  signerNote: string;
}

function canonicalSignedEntryBytes(p: SigningPayload): Uint8Array {
  // Sort keys deterministically; geofence sub-object keys are also covered
  // because canonicalize sorts every object level.
  const payload = {
    entry: {
      providerId: p.entry.providerId,
      name: p.entry.name,
      geofence: {
        lat: p.entry.geofence.lat,
        lng: p.entry.geofence.lng,
        radiusMeters: p.entry.geofence.radiusMeters,
      },
    },
    keyId: p.keyId,
    signerNote: p.signerNote,
    validFrom: p.validFrom,
    validTo: p.validTo,
  };
  return new TextEncoder().encode(canonicalize(payload));
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface GeofenceValidity {
  validFrom: string;
  validTo: string;
  signerNote?: string;
}

export function signGeofenceEntry(
  entry: GeofenceEntry,
  witnessKey: GeofenceWitnessSigningKey,
  validity: GeofenceValidity,
): SignedGeofenceEntry {
  if (witnessKey.secretKey.length !== 4032) {
    throw new Error("witnessKey.secretKey must be a 4032-byte ML-DSA-65 secret key");
  }
  if (Date.parse(validity.validTo) <= Date.parse(validity.validFrom)) {
    throw new Error("validTo must be after validFrom");
  }
  const note = validity.signerNote ?? "";
  const bytes = canonicalSignedEntryBytes({
    entry,
    keyId: witnessKey.keyId,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    signerNote: note,
  });
  const sig = ml_dsa65.sign(bytes, witnessKey.secretKey);
  const signed: SignedGeofenceEntry = {
    entry,
    keyId: witnessKey.keyId,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    signerNote: note,
    signatureB64: b64Encode(new Uint8Array(sig)),
  };
  return SignedGeofenceEntrySchema.parse(signed);
}

export interface GeofenceVerifyResult {
  valid: boolean;
  reason?: string;
}

export function verifyGeofenceEntry(
  signed: SignedGeofenceEntry,
  resolver: GeofenceKeyResolver,
  now: Date = new Date(),
): GeofenceVerifyResult {
  const parsed = SignedGeofenceEntrySchema.safeParse(signed);
  if (!parsed.success) return { valid: false, reason: `schema: ${parsed.error.message}` };
  const nowMs = now.getTime();
  if (nowMs < Date.parse(signed.validFrom)) {
    return { valid: false, reason: "entry not yet valid" };
  }
  if (nowMs > Date.parse(signed.validTo)) {
    return { valid: false, reason: "entry expired" };
  }
  const key = resolver(signed.keyId);
  if (!key) return { valid: false, reason: `unknown keyId ${signed.keyId}` };
  if (key.publicKey.length !== 1952) {
    return { valid: false, reason: "witness publicKey wrong length" };
  }
  let sig: Uint8Array;
  try {
    sig = b64Decode(signed.signatureB64);
  } catch {
    return { valid: false, reason: "signature not base64" };
  }
  if (sig.length !== 3309) return { valid: false, reason: "signature wrong length" };
  const bytes = canonicalSignedEntryBytes({
    entry: signed.entry,
    keyId: signed.keyId,
    validFrom: signed.validFrom,
    validTo: signed.validTo,
    signerNote: signed.signerNote,
  });
  let ok = false;
  try {
    ok = ml_dsa65.verify(sig, bytes, key.publicKey);
  } catch {
    return { valid: false, reason: "verify threw" };
  }
  return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
}

export interface RejectedGeofenceEntry {
  /** providerId when available (best effort — schema-failed entries may not have it). */
  providerId: string | null;
  reason: string;
}

export interface VerifiedCatalogueResult {
  catalogue: GeofenceCatalogue;
  rejected: RejectedGeofenceEntry[];
}

/**
 * Filter a list of signed catalogue entries to the verified subset. Rejection
 * reasons are surfaced (never silently dropped). The returned catalogue has
 * the same shape as `GeofenceCatalogue` so downstream resolvers do not
 * change shape; the v3 resolver below uses this result directly.
 */
export function loadVerifiedCatalogue(
  rawSigned: readonly SignedGeofenceEntry[],
  resolver: GeofenceKeyResolver,
  now: Date = new Date(),
): VerifiedCatalogueResult {
  const verifiedEntries: GeofenceEntry[] = [];
  const rejected: RejectedGeofenceEntry[] = [];
  const seenProviders = new Set<string>();
  for (const signed of rawSigned) {
    const r = verifyGeofenceEntry(signed, resolver, now);
    const providerId = signed.entry?.providerId ?? null;
    if (!r.valid) {
      rejected.push({ providerId, reason: r.reason ?? "unknown" });
      continue;
    }
    if (providerId !== null && seenProviders.has(providerId)) {
      rejected.push({ providerId, reason: "duplicate providerId in catalogue" });
      continue;
    }
    if (providerId !== null) seenProviders.add(providerId);
    verifiedEntries.push(signed.entry);
  }
  return { catalogue: { entries: verifiedEntries }, rejected };
}

/**
 * Autonomy capability resolver v3. Identical to v2 but the catalogue MUST
 * be the verified output of `loadVerifiedCatalogue`. Callers wanting to
 * accept an unsigned catalogue must keep using v2; the v3 path is the
 * production path and never accepts unsigned input.
 */
export function resolveAutonomyCapabilityV3(
  ctx: AutonomyCapabilityContextV2,
  registry: OemCapabilityRegistry,
  signedCatalogue: readonly SignedGeofenceEntry[],
  resolver: GeofenceKeyResolver,
  now: Date = new Date(),
): AutonomyCapability & { rejected: RejectedGeofenceEntry[] } {
  const verified = loadVerifiedCatalogue(signedCatalogue, resolver, now);
  if (verified.catalogue.entries.length === 0) {
    return {
      tier: "A-AVP",
      eligible: false,
      reason: "No verified geofence entries in signed catalogue.",
      rejected: verified.rejected,
    };
  }
  const result = resolveAutonomyCapabilityV2(ctx, registry, verified.catalogue);
  return { ...result, rejected: verified.rejected };
}
