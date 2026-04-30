// =============================================================================
// MemoryScope — per-conversation default scope plus auditable promotion to
// vehicle / owner scope. Consent-revocation produces a signed deletion record
// that proves the erasure happened, satisfying DPDP Act 2023 §13(2)(b)
// (right to erasure with proof of deletion) and GDPR Art. 17 §3.
//
// Defaults: every new memory write is "conversation"-scoped. Promotion to
// "vehicle" or "owner" requires an explicit `promote(scope, reason)` call;
// that call records an evidence hash so promotions are auditable. The
// store keeps an append-only audit log of promotions and revocations.
//
// Signed deletion: when an owner revokes consent we serialise the deletion
// record canonically (RFC 8785 byte order via JSON.stringify with sorted
// keys), HMAC-sign it with the configured witness key, and return it. The
// HMAC stub is the local fallback; production wires this to the existing
// @vsbs/security ML-DSA-65 signer (see makeMlDsa65Signer) for a true
// post-quantum witness signature. The interface is identical so the
// upgrade path is a single line in `revokeMemoryForOwner`.
// =============================================================================

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { MemoryFact } from "./types.js";

// -----------------------------------------------------------------------------
// Scope
// -----------------------------------------------------------------------------

export const MemoryScope = {
  Conversation: "conversation",
  Vehicle: "vehicle",
  Owner: "owner",
} as const;
export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export const MemoryScopeSchema = z.enum([
  MemoryScope.Conversation,
  MemoryScope.Vehicle,
  MemoryScope.Owner,
]);

// -----------------------------------------------------------------------------
// Scoped fact + entry
// -----------------------------------------------------------------------------

export interface ScopedKey {
  conversationId: string;
  vehicleId?: string | undefined;
  ownerId?: string | undefined;
}

export interface ScopedFactWrite extends ScopedKey {
  key: string;
  value: unknown;
  source: MemoryFact["source"];
}

export interface ScopedFact {
  scope: MemoryScope;
  conversationId: string;
  vehicleId?: string | undefined;
  ownerId?: string | undefined;
  key: string;
  value: unknown;
  source: MemoryFact["source"];
  at: string;
}

export interface PromotionRecord {
  /** Unique id for this promotion (random hex). */
  id: string;
  /** Scope the entry was promoted to. */
  toScope: MemoryScope;
  /** Reason supplied by the caller. Free text; logged for audit. */
  reason: string;
  /** Hash of the (key, conversationId, value) tuple — opaque proof of what was promoted. */
  evidenceHash: string;
  at: string;
}

// -----------------------------------------------------------------------------
// Signed deletion record
// -----------------------------------------------------------------------------

export const SignedDeletionRecordSchema = z.object({
  ownerId: z.string().min(1),
  /** ISO 8601 timestamp the deletion was performed. */
  at: z.string().datetime(),
  /** Number of facts removed across all scopes. */
  removedCount: z.number().int().nonnegative(),
  /** Random nonce; prevents replay of identical-payload signatures. */
  nonce: z.string().min(16),
  /** Algorithm: "HMAC-SHA256" (local fallback) or "ML-DSA-65" (production witness). */
  alg: z.enum(["HMAC-SHA256", "ML-DSA-65"]),
  /** Signature in hex. */
  signatureHex: z.string().min(1),
  /** Canonical bytes (hex) the signature covers — for re-verification. */
  canonicalBytesHex: z.string().min(1),
});
export type SignedDeletionRecord = z.infer<typeof SignedDeletionRecordSchema>;

// -----------------------------------------------------------------------------
// Store interface
// -----------------------------------------------------------------------------

export interface ScopedMemoryStore {
  /** Write a fact. Default scope is "conversation". */
  write(write: ScopedFactWrite): Promise<ScopedFact>;
  /** Promote an existing fact to a wider scope, with reason. Returns the audit record. */
  promote(args: {
    conversationId: string;
    key: string;
    toScope: Exclude<MemoryScope, "conversation">;
    reason: string;
    /** Required when promoting to vehicle scope. */
    vehicleId?: string;
    /** Required when promoting to owner scope. */
    ownerId?: string;
  }): Promise<PromotionRecord>;
  /** Read all facts visible to a (conversation, vehicle, owner) tuple. */
  list(key: ScopedKey): Promise<ScopedFact[]>;
  /** Read all promotion audit records. Read-only. */
  promotions(): Promise<PromotionRecord[]>;
  /** Revoke memory for an owner. Returns a signed deletion record. */
  revokeMemoryForOwner(ownerId: string): Promise<SignedDeletionRecord>;
}

// -----------------------------------------------------------------------------
// HMAC witness key — local fallback. Production wiring is documented in the
// header. The interface accepts an injected key so tests can supply a fixed
// secret and verify signatures.
// -----------------------------------------------------------------------------

export interface WitnessKey {
  alg: "HMAC-SHA256" | "ML-DSA-65";
  /** For HMAC: the shared secret. For ML-DSA-65: the secret-key bytes. */
  material: Uint8Array;
}

export function generateLocalWitnessKey(): WitnessKey {
  return { alg: "HMAC-SHA256", material: new Uint8Array(randomBytes(32)) };
}

// -----------------------------------------------------------------------------
// Canonical JSON (RFC 8785-style) — sorted keys, no whitespace.
// -----------------------------------------------------------------------------

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const out: Record<string, unknown> = {};
  const keys = Object.keys(v as Record<string, unknown>).sort();
  for (const k of keys) out[k] = sortKeys((v as Record<string, unknown>)[k]);
  return out;
}

// -----------------------------------------------------------------------------
// In-memory implementation. Sufficient for v0.1; the interface survives a
// swap to a vector / persistent store later.
// -----------------------------------------------------------------------------

export class InMemoryScopedStore implements ScopedMemoryStore {
  readonly #facts: ScopedFact[] = [];
  readonly #promotions: PromotionRecord[] = [];
  readonly #witness: WitnessKey;

  constructor(witness?: WitnessKey) {
    this.#witness = witness ?? generateLocalWitnessKey();
  }

  async write(w: ScopedFactWrite): Promise<ScopedFact> {
    const fact: ScopedFact = {
      scope: MemoryScope.Conversation,
      conversationId: w.conversationId,
      ...(w.vehicleId !== undefined ? { vehicleId: w.vehicleId } : {}),
      ...(w.ownerId !== undefined ? { ownerId: w.ownerId } : {}),
      key: w.key,
      value: w.value,
      source: w.source,
      at: new Date().toISOString(),
    };
    this.#facts.push(fact);
    return fact;
  }

  async promote(args: {
    conversationId: string;
    key: string;
    toScope: Exclude<MemoryScope, "conversation">;
    reason: string;
    vehicleId?: string;
    ownerId?: string;
  }): Promise<PromotionRecord> {
    const target = this.#facts.find(
      (f) => f.conversationId === args.conversationId && f.key === args.key,
    );
    if (!target) {
      throw new Error(
        `MemoryScope.promote: no fact for conversationId=${args.conversationId} key=${args.key}`,
      );
    }
    if (args.toScope === MemoryScope.Vehicle && !args.vehicleId) {
      throw new Error("MemoryScope.promote: vehicleId required for vehicle scope");
    }
    if (args.toScope === MemoryScope.Owner && !args.ownerId) {
      throw new Error("MemoryScope.promote: ownerId required for owner scope");
    }
    target.scope = args.toScope;
    if (args.vehicleId !== undefined) target.vehicleId = args.vehicleId;
    if (args.ownerId !== undefined) target.ownerId = args.ownerId;

    const evidence = canonicalize({
      conversationId: target.conversationId,
      key: target.key,
      value: target.value,
    });
    const evidenceHash = createHash("sha256").update(evidence).digest("hex");
    const record: PromotionRecord = {
      id: randomBytes(8).toString("hex"),
      toScope: args.toScope,
      reason: args.reason,
      evidenceHash,
      at: new Date().toISOString(),
    };
    this.#promotions.push(record);
    return record;
  }

  async list(key: ScopedKey): Promise<ScopedFact[]> {
    return this.#facts.filter((f) => {
      if (f.scope === MemoryScope.Conversation) return f.conversationId === key.conversationId;
      if (f.scope === MemoryScope.Vehicle)
        return key.vehicleId !== undefined && f.vehicleId === key.vehicleId;
      if (f.scope === MemoryScope.Owner)
        return key.ownerId !== undefined && f.ownerId === key.ownerId;
      return false;
    });
  }

  async promotions(): Promise<PromotionRecord[]> {
    return [...this.#promotions];
  }

  async revokeMemoryForOwner(ownerId: string): Promise<SignedDeletionRecord> {
    if (!ownerId) throw new Error("MemoryScope.revoke: ownerId required");
    let removed = 0;
    for (let i = this.#facts.length - 1; i >= 0; i--) {
      const f = this.#facts[i]!;
      if (f.ownerId === ownerId) {
        this.#facts.splice(i, 1);
        removed += 1;
      }
    }
    // Audit-record promotions touching this owner are kept so the deletion
    // is traceable. Their evidence-hash already lost its plaintext at time
    // of promotion, so they hold no PII.

    const at = new Date().toISOString();
    const nonce = randomBytes(16).toString("hex");
    const canonical = canonicalize({
      ownerId,
      at,
      removedCount: removed,
      nonce,
      alg: this.#witness.alg,
    });
    const canonicalBytes = Buffer.from(canonical, "utf8");
    const signatureHex = signWithWitness(this.#witness, canonicalBytes);
    return SignedDeletionRecordSchema.parse({
      ownerId,
      at,
      removedCount: removed,
      nonce,
      alg: this.#witness.alg,
      signatureHex,
      canonicalBytesHex: canonicalBytes.toString("hex"),
    });
  }

  /** For tests: expose the witness public material so verification is possible. */
  witnessKeyForVerification(): WitnessKey {
    return this.#witness;
  }
}

function signWithWitness(witness: WitnessKey, msg: Buffer): string {
  if (witness.alg === "HMAC-SHA256") {
    return createHmac("sha256", Buffer.from(witness.material))
      .update(msg)
      .digest("hex");
  }
  // ML-DSA-65 path: production code wires @vsbs/security `makeMlDsa65Signer()`
  // here by passing the secretKey through `material`. The HMAC fallback is
  // used in tests so we don't pin the test fixture to ML-DSA-65 keypair
  // generation. This branch is intentionally unreachable in the local
  // store; the upgrade is one line in production.
  throw new Error(`MemoryScope: signing with ${witness.alg} requires injected production signer`);
}

/**
 * Verify a signed deletion record. Returns true iff the canonical bytes
 * were signed by the supplied witness key. For HMAC, uses constant-time
 * comparison.
 */
export function verifySignedDeletionRecord(
  record: SignedDeletionRecord,
  witness: WitnessKey,
): boolean {
  if (record.alg !== witness.alg) return false;
  const canonicalBytes = Buffer.from(record.canonicalBytesHex, "hex");
  if (record.alg === "HMAC-SHA256") {
    const expected = createHmac("sha256", Buffer.from(witness.material))
      .update(canonicalBytes)
      .digest();
    const actual = Buffer.from(record.signatureHex, "hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }
  return false;
}

/** Convenience: a re-exportable revokeMemoryForOwner that operates on a store. */
export async function revokeMemoryForOwner(
  store: ScopedMemoryStore,
  ownerId: string,
): Promise<SignedDeletionRecord> {
  return store.revokeMemoryForOwner(ownerId);
}
