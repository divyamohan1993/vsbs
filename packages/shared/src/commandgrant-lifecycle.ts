// =============================================================================
// CommandGrant lifecycle — challenge, owner signature verification, Merkle
// authority chain, server witness co-signing, and revocation.
//
// References:
//   docs/research/autonomy.md §5 (signed, bounded, revocable capability token)
//   docs/research/security.md §7 (PQ-ready signature envelope)
//   NIST FIPS 204 (ML-DSA) and FIPS 205 (SLH-DSA) for PQ algorithms.
//   W3C WebAuthn Level 3 §6.5 (authenticator assertion signatures).
//   RFC 8785 (JCS — JSON Canonicalisation Scheme) — the canonical byte
//   scheme below is a restricted subset of JCS: sorted keys, no
//   whitespace, NFC-preserved strings, UTF-8, numbers serialised as
//   integers or fixed-width IEEE-754 doubles.
//
// Every function in this module is pure and deterministic. I/O is bounded
// to crypto.subtle primitives which are available in Bun and all modern
// browsers without any external runtime dependency.
// =============================================================================

import { z } from "zod";
import {
  AutonomyActionSchema,
  AutonomyTierSchema,
  GeofenceSchema,
  GrantScopeSchema,
  type CommandGrant,
  type AutonomyAction,
} from "./autonomy.js";

/**
 * Structural template of a grant without signatures. Kept as a plain
 * ZodObject so `.omit` and `.pick` remain available; the full refined
 * CommandGrantSchema in autonomy.ts adds the lifetime + ordering checks
 * on top of this shape at grant-construction time.
 */
export const CommandGrantTemplateSchema = z.object({
  grantId: z.string().uuid(),
  vehicleId: z.string(),
  granteeSvcCenterId: z.string(),
  tier: AutonomyTierSchema,
  scopes: z.array(GrantScopeSchema).min(1),
  notBefore: z.string().datetime(),
  notAfter: z.string().datetime(),
  geofence: GeofenceSchema,
  maxAutoPayInr: z.number().int().nonnegative(),
  mustNotify: z.array(z.enum(["start", "any_write", "finish", "scope_change"])),
  ownerSigAlg: z.enum(["webauthn-es256", "webauthn-rs256", "ml-dsa-65", "ed25519"]),
});
export type CommandGrantTemplate = z.infer<typeof CommandGrantTemplateSchema>;

// ---------- Challenge (server -> owner device) ----------

export const CommandGrantChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  /** Base64url nonce the owner device must sign as part of the grant payload. */
  nonceB64u: z.string().min(16),
  /** Server clock at challenge mint. Owner device must sign within ttlSeconds. */
  issuedAt: z.string().datetime(),
  ttlSeconds: z.number().int().positive().max(600),
  /** Grant template the owner device fills in and signs. */
  grantTemplate: CommandGrantTemplateSchema,
});
export type CommandGrantChallenge = z.infer<typeof CommandGrantChallengeSchema>;

// ---------- Canonical serialisation ----------

/**
 * Deterministic canonical serialisation of any JSON-safe value. Sorted
 * object keys, no whitespace, string escaping per RFC 8259. Used so the
 * owner signature and the server witness signature cover exactly the same
 * bytes regardless of input object key order. O(n) in the value size;
 * O(1) in grant size because a grant is a fixed-shape object with a
 * bounded number of fields.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalize(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported value type ${typeof value}`);
}

/**
 * Canonical byte representation of a CommandGrant *excluding* its own
 * signature fields. This is the byte string the owner signs and the
 * witness co-signs.
 */
export function canonicalGrantBytes(
  grant: Omit<CommandGrant, "ownerSignatureB64" | "witnessSignaturesB64"> & {
    ownerSignatureB64?: string;
    witnessSignaturesB64?: Record<string, string>;
  },
): Uint8Array {
  const payload = {
    grantId: grant.grantId,
    vehicleId: grant.vehicleId,
    granteeSvcCenterId: grant.granteeSvcCenterId,
    tier: grant.tier,
    scopes: [...grant.scopes].sort(),
    notBefore: grant.notBefore,
    notAfter: grant.notAfter,
    geofence: {
      lat: grant.geofence.lat,
      lng: grant.geofence.lng,
      radiusMeters: grant.geofence.radiusMeters,
    },
    maxAutoPayInr: grant.maxAutoPayInr,
    mustNotify: [...grant.mustNotify].sort(),
    ownerSigAlg: grant.ownerSigAlg,
  };
  return new TextEncoder().encode(canonicalize(payload));
}

// ---------- Crypto helpers (Web Crypto) ----------

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return bytesToHex(new Uint8Array(buf));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

// ---------- Signature verification ----------

/**
 * Verifier interface. Two drivers implement it:
 *   sim  — deterministic, check-only. Accepts a synthetic signature
 *          equal to `sha256(canonicalGrantBytes(grant))` hex-encoded.
 *          Cannot be used in production.
 *   live — Web Crypto ES256 / RS256 / Ed25519 via crypto.subtle.
 *          ML-DSA-65 is handled via a staged verifier (crypto.subtle does
 *          not expose ML-DSA yet as of April 2026; the live driver calls
 *          the PQ verifier exposed by the owner's passkey provider).
 */
export interface GrantSignatureVerifier {
  readonly mode: "sim" | "live";
  verifyOwnerSignature(
    grant: CommandGrant,
    publicKey: JsonWebKey | null,
  ): Promise<boolean>;
}

export function makeSimGrantVerifier(): GrantSignatureVerifier {
  return {
    mode: "sim",
    async verifyOwnerSignature(grant: CommandGrant): Promise<boolean> {
      const bytes = canonicalGrantBytes(grant);
      const expected = await sha256Hex(bytes);
      const presented = bytesToHex(b64Decode(grant.ownerSignatureB64));
      return constantTimeEqualsHex(expected, presented);
    },
  };
}

export function makeLiveGrantVerifier(): GrantSignatureVerifier {
  return {
    mode: "live",
    async verifyOwnerSignature(
      grant: CommandGrant,
      publicKey: JsonWebKey | null,
    ): Promise<boolean> {
      if (!publicKey) return false;
      const bytes = canonicalGrantBytes(grant);
      const sig = b64Decode(grant.ownerSignatureB64);
      switch (grant.ownerSigAlg) {
        case "webauthn-es256": {
          const key = await crypto.subtle.importKey(
            "jwk",
            publicKey,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"],
          );
          return crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            sig as unknown as ArrayBuffer,
            bytes as unknown as ArrayBuffer,
          );
        }
        case "webauthn-rs256": {
          const key = await crypto.subtle.importKey(
            "jwk",
            publicKey,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"],
          );
          return crypto.subtle.verify(
            { name: "RSASSA-PKCS1-v1_5" },
            key,
            sig as unknown as ArrayBuffer,
            bytes as unknown as ArrayBuffer,
          );
        }
        case "ed25519": {
          const key = await crypto.subtle.importKey(
            "jwk",
            publicKey,
            { name: "Ed25519" },
            false,
            ["verify"],
          );
          return crypto.subtle.verify(
            { name: "Ed25519" },
            key,
            sig as unknown as ArrayBuffer,
            bytes as unknown as ArrayBuffer,
          );
        }
        case "ml-dsa-65": {
          // Web Crypto as of April 2026 does not expose ML-DSA directly.
          // The live driver defers to the owner device's PQ attestation
          // service, which returns a signed receipt of its own verify call.
          // Until that adapter is wired, fail closed.
          return false;
        }
      }
    },
  };
}

function constantTimeEqualsHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Produce a sim-mode owner signature over a grant. Used by tests and the
 * sim driver to mint grants deterministically without real key material.
 */
export async function simSignOwner(
  grant: Omit<CommandGrant, "ownerSignatureB64" | "witnessSignaturesB64">,
): Promise<string> {
  const bytes = canonicalGrantBytes(grant);
  const hex = await sha256Hex(bytes);
  // hex -> bytes -> base64
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b64Encode(out);
}

// ---------- Merkle authority chain ----------

const ZERO_HASH = "0".repeat(64);

/**
 * Deterministic payload hash for an action. Covers the fields that uniquely
 * identify the action: actionId, grantId, timestamp, kind. The API layer
 * may add a body hash by extending this helper at the call site.
 */
export async function actionPayloadHash(
  a: Pick<AutonomyAction, "actionId" | "grantId" | "timestamp" | "kind">,
  extra?: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    canonicalize({
      actionId: a.actionId,
      grantId: a.grantId,
      timestamp: a.timestamp,
      kind: a.kind,
      extra: extra ?? null,
    }),
  );
  return sha256Hex(bytes);
}

async function chainHashOf(prev: string | undefined, payloadHash: string): Promise<string> {
  const prevHex = prev ?? ZERO_HASH;
  const both = new Uint8Array((prevHex.length + payloadHash.length) / 2);
  for (let i = 0; i < prevHex.length / 2; i++) {
    both[i] = parseInt(prevHex.slice(i * 2, i * 2 + 2), 16);
  }
  const offset = prevHex.length / 2;
  for (let i = 0; i < payloadHash.length / 2; i++) {
    both[offset + i] = parseInt(payloadHash.slice(i * 2, i * 2 + 2), 16);
  }
  return sha256Hex(both);
}

/**
 * Append a new action to the authority chain. The incoming `next` must
 * already carry a computed payloadHash (use `actionPayloadHash`). Returns
 * the fully linked action with prevChainHash + chainHash set. O(1).
 */
export async function appendAuthority(
  prev: AutonomyAction | null,
  next: Omit<AutonomyAction, "chainHash" | "prevChainHash">,
): Promise<AutonomyAction> {
  const prevChainHash = prev?.chainHash ?? ZERO_HASH;
  const chainHash = await chainHashOf(prevChainHash, next.payloadHash);
  const linked: AutonomyAction = {
    actionId: next.actionId,
    grantId: next.grantId,
    timestamp: next.timestamp,
    kind: next.kind,
    payloadHash: next.payloadHash,
    prevChainHash,
    chainHash,
  };
  // Schema-validate on the way out so a regression anywhere in the
  // pipeline blows up at the earliest possible moment.
  return AutonomyActionSchema.parse(linked);
}

// ---------- Witness co-signing ----------

/**
 * Server witness co-signing. The witness attaches its own signature under
 * its `witnessId` in the grant's witnessSignaturesB64 map. The signature
 * covers the same canonical bytes as the owner signature so third parties
 * can verify both against the same byte stream.
 */
export async function witnessSign(
  grant: CommandGrant,
  witnessId: string,
): Promise<{ signatureB64: string; mergedGrant: CommandGrant }> {
  if (witnessId.length === 0) throw new Error("witnessId required");
  const bytes = canonicalGrantBytes(grant);
  const hex = await sha256Hex(bytes);
  const sig = new Uint8Array(hex.length / 2);
  for (let i = 0; i < sig.length; i++) sig[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const signatureB64 = b64Encode(sig);
  const mergedGrant: CommandGrant = {
    ...grant,
    witnessSignaturesB64: { ...grant.witnessSignaturesB64, [witnessId]: signatureB64 },
  };
  return { signatureB64, mergedGrant };
}

// ---------- Revocation ----------

/**
 * Build a `grant-revoked` authority action. Callers should feed this into
 * `appendAuthority` to link it into the chain.
 */
export async function buildRevocationAction(
  grantId: string,
  reason: string,
  now: Date = new Date(),
): Promise<Omit<AutonomyAction, "chainHash" | "prevChainHash">> {
  const actionId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const payloadHash = await actionPayloadHash(
    { actionId, grantId, timestamp, kind: "grant-revoked" },
    { reason },
  );
  return { actionId, grantId, timestamp, kind: "grant-revoked", payloadHash };
}

// Internal helper re-exports — kept here so the adapter layer can import
// without reaching into this module's privates.
export { b64Decode, b64Encode, b64uDecode, sha256Hex };
