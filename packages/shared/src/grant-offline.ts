// =============================================================================
// Offline grant envelope — MRM-only authority on connectivity loss.
//
// Why this exists:
//   When the vehicle and the witness service can no longer reach each other,
//   the on-vehicle controller has two choices: ride out the network gap
//   under the original CommandGrant (unsafe — a tier-1 flip cannot be
//   communicated) or revert to a pre-signed offline envelope that authorises
//   only Minimum Risk Maneuver actions. We pick the second.
//
//   The envelope is:
//     1. Signed with ML-DSA-65 by a witness key the vehicle already trusts
//        from the active grant. The witness key id is recorded.
//     2. Bounded by a hard 30-second TTL — non-overridable. After that the
//        vehicle MUST stop or hand control back to the driver.
//     3. Restricted to two actions: mrm-stop, mrm-pull-over. Anything else
//        is refused even with a valid signature.
//
// References:
//   UNECE R157 §5.1.5 (MRM under loss of communication).
//   docs/research/security.md §1 (PQ envelope rationale).
//   FIPS 204 (ML-DSA, security category 3 used here).
// =============================================================================

import { z } from "zod";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { CommandGrantSchema, type CommandGrant } from "./autonomy.js";
import { canonicalize } from "./commandgrant-lifecycle.js";

/** Hard cap on offline envelope lifetime. Non-overridable. */
export const OFFLINE_GRANT_MAX_TTL_MS = 30_000;

const OfflineActionSchema = z.enum(["mrm-stop", "mrm-pull-over"]);
export type OfflineAction = z.infer<typeof OfflineActionSchema>;

export const OfflineGrantEnvelopeSchema = z
  .object({
    grant: CommandGrantSchema,
    /** Capped at OFFLINE_GRANT_MAX_TTL_MS regardless of caller input. */
    offlineTtlMs: z
      .number()
      .int()
      .positive()
      .max(OFFLINE_GRANT_MAX_TTL_MS),
    issuedAt: z.string().datetime(),
    /** Witness key identifier — must already be referenced in the host grant. */
    keyId: z.string().min(1),
    /** Allow-list of actions. Move actions explicitly forbidden. */
    allowedActions: z
      .array(OfflineActionSchema)
      .min(1)
      .max(2)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: "allowedActions must be unique",
      }),
    /** Base64-encoded ML-DSA-65 signature over canonical envelope bytes (signature field excluded). */
    signatureB64: z.string().min(1),
  })
  .strict();
export type OfflineGrantEnvelope = z.infer<typeof OfflineGrantEnvelopeSchema>;

export interface WitnessSigningKey {
  keyId: string;
  /** ML-DSA-65 secret key (4032 bytes). */
  secretKey: Uint8Array;
}

export interface WitnessVerifyingKey {
  keyId: string;
  /** ML-DSA-65 public key (1952 bytes). */
  publicKey: Uint8Array;
}

export type WitnessKeyResolver = (keyId: string) => WitnessVerifyingKey | undefined;

// ---------- Canonical bytes ----------

interface EnvelopeForSigning {
  grant: CommandGrant;
  offlineTtlMs: number;
  issuedAt: string;
  keyId: string;
  allowedActions: OfflineAction[];
}

function canonicalEnvelopeBytes(env: EnvelopeForSigning): Uint8Array {
  const payload = {
    allowedActions: [...env.allowedActions].sort(),
    grantId: env.grant.grantId,
    grantOwnerSig: env.grant.ownerSignatureB64,
    issuedAt: env.issuedAt,
    keyId: env.keyId,
    offlineTtlMs: env.offlineTtlMs,
    vehicleId: env.grant.vehicleId,
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

// ---------- Mint ----------

export interface MintOfflineEnvelopeInput {
  grant: CommandGrant;
  witnessKey: WitnessSigningKey;
  /** Caller's preferred TTL — clamped to OFFLINE_GRANT_MAX_TTL_MS. */
  offlineTtlMs?: number;
  /** Subset of allowed offline actions. Defaults to all. */
  allowedActions?: OfflineAction[];
  /** Issue clock; defaults to Date.now(). */
  now?: Date;
}

export function mintOfflineEnvelope(input: MintOfflineEnvelopeInput): OfflineGrantEnvelope {
  const ttl = Math.min(
    input.offlineTtlMs ?? OFFLINE_GRANT_MAX_TTL_MS,
    OFFLINE_GRANT_MAX_TTL_MS,
  );
  if (ttl <= 0 || !Number.isFinite(ttl) || !Number.isInteger(ttl)) {
    throw new Error("offlineTtlMs must be a positive integer ms value");
  }
  if (input.witnessKey.secretKey.length !== 4032) {
    throw new Error("witnessKey.secretKey must be a 4032-byte ML-DSA-65 secret key");
  }
  const allowed: OfflineAction[] = input.allowedActions
    ? [...new Set(input.allowedActions)]
    : ["mrm-stop", "mrm-pull-over"];
  if (allowed.length === 0) throw new Error("allowedActions cannot be empty");
  const issuedAt = (input.now ?? new Date()).toISOString();

  const forSigning: EnvelopeForSigning = {
    grant: input.grant,
    offlineTtlMs: ttl,
    issuedAt,
    keyId: input.witnessKey.keyId,
    allowedActions: allowed,
  };
  const bytes = canonicalEnvelopeBytes(forSigning);
  const sig = ml_dsa65.sign(bytes, input.witnessKey.secretKey);

  const envelope: OfflineGrantEnvelope = {
    grant: input.grant,
    offlineTtlMs: ttl,
    issuedAt,
    keyId: input.witnessKey.keyId,
    allowedActions: allowed,
    signatureB64: b64Encode(new Uint8Array(sig)),
  };
  // Validate on the way out so a regression here fails fast.
  return OfflineGrantEnvelopeSchema.parse(envelope);
}

// ---------- Verify ----------

export interface OfflineEnvelopeVerifyResult {
  valid: boolean;
  reason?: string;
}

export function verifyOfflineEnvelope(
  envelope: OfflineGrantEnvelope,
  resolver: WitnessKeyResolver,
): OfflineEnvelopeVerifyResult {
  const parsed = OfflineGrantEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    return { valid: false, reason: `schema: ${parsed.error.message}` };
  }
  if (envelope.offlineTtlMs > OFFLINE_GRANT_MAX_TTL_MS) {
    return { valid: false, reason: "ttl exceeds OFFLINE_GRANT_MAX_TTL_MS" };
  }
  const key = resolver(envelope.keyId);
  if (!key) return { valid: false, reason: `unknown keyId ${envelope.keyId}` };
  if (key.publicKey.length !== 1952) {
    return { valid: false, reason: "witness publicKey wrong length" };
  }
  let sig: Uint8Array;
  try {
    sig = b64Decode(envelope.signatureB64);
  } catch {
    return { valid: false, reason: "signature not base64" };
  }
  if (sig.length !== 3309) {
    return { valid: false, reason: "signature wrong length" };
  }
  const bytes = canonicalEnvelopeBytes({
    grant: envelope.grant,
    offlineTtlMs: envelope.offlineTtlMs,
    issuedAt: envelope.issuedAt,
    keyId: envelope.keyId,
    allowedActions: [...envelope.allowedActions],
  });
  let ok = false;
  try {
    ok = ml_dsa65.verify(sig, bytes, key.publicKey);
  } catch {
    return { valid: false, reason: "verify threw" };
  }
  if (!ok) return { valid: false, reason: "signature mismatch" };
  return { valid: true };
}

// ---------- Permit ----------

export interface PermitOfflineActionInput {
  envelope: OfflineGrantEnvelope;
  action: OfflineAction;
  resolver: WitnessKeyResolver;
  now?: Date;
}

export interface PermitOfflineActionResult {
  permitted: boolean;
  reason?: string;
}

/**
 * Returns whether an offline action is permitted under the envelope right now.
 * Enforces:
 *   - schema valid
 *   - signature verifies under the resolved witness key
 *   - now < issuedAt + offlineTtlMs
 *   - action ∈ envelope.allowedActions
 *   - action is one of the hard-coded MRM-only set
 */
export function permitOfflineAction(input: PermitOfflineActionInput): PermitOfflineActionResult {
  const verifyResult = verifyOfflineEnvelope(input.envelope, input.resolver);
  if (!verifyResult.valid) {
    return { permitted: false, reason: verifyResult.reason ?? "verify failed" };
  }
  const allowedSet = new Set(input.envelope.allowedActions);
  if (!allowedSet.has(input.action)) {
    return { permitted: false, reason: `action ${input.action} not in envelope allowedActions` };
  }
  const issuedMs = Date.parse(input.envelope.issuedAt);
  if (Number.isNaN(issuedMs)) {
    return { permitted: false, reason: "invalid issuedAt" };
  }
  const nowMs = (input.now ?? new Date()).getTime();
  if (nowMs < issuedMs) {
    return { permitted: false, reason: "envelope not yet valid" };
  }
  if (nowMs - issuedMs > input.envelope.offlineTtlMs) {
    return { permitted: false, reason: "envelope expired" };
  }
  // Defence in depth: even if a future schema change widens allowedActions,
  // the offline path here will still refuse anything outside MRM.
  if (input.action !== "mrm-stop" && input.action !== "mrm-pull-over") {
    return { permitted: false, reason: "non-MRM action refused offline" };
  }
  return { permitted: true };
}

/** Test/dev helper — generate a fresh ML-DSA-65 keypair. Not for live use. */
export function generateWitnessKeypair(keyId: string): {
  signing: WitnessSigningKey;
  verifying: WitnessVerifyingKey;
} {
  const kp = ml_dsa65.keygen();
  return {
    signing: { keyId, secretKey: new Uint8Array(kp.secretKey) },
    verifying: { keyId, publicKey: new Uint8Array(kp.publicKey) },
  };
}
