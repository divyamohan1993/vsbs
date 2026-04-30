// =============================================================================
// Dual-control grant minting + off-platform audit log shape (D2).
//
// Why this exists:
//   A single owner signature is not enough authority for an autonomous
//   driving capability that, mis-handled, could kill someone. The owner
//   passkey co-signs with at least one of: ops-witness (the VSBS concierge),
//   regulator-witness (where applicable). m-of-n quorum is enforced; older
//   signatures than the configured age window are rejected; duplicate roles
//   are rejected; missing-required-roles cause rejection.
//
//   The Merkle authority chain that already lives in
//   commandgrant-lifecycle.ts is *internal* state. Real-world deployments
//   need a tamper-evident off-platform log (BigQuery + immutable storage,
//   QLDB, or an external timestamping authority). This module defines the
//   minimal sink contract; concrete sinks live alongside the API adapters.
//
// References:
//   docs/research/security.md §7 (witness co-signing).
//   docs/research/autonomy.md §5.4 (multi-party authorisation).
//   FIPS 204 (ML-DSA), W3C WebAuthn Level 3 (passkey signatures).
// =============================================================================

import { z } from "zod";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import {
  CommandGrantSchema,
  type CommandGrant,
  type AutonomyAction,
} from "./autonomy.js";
import { canonicalGrantBytes } from "./commandgrant-lifecycle.js";

// ---------- Policy ----------

export const DualControlRoleSchema = z.enum([
  "owner-passkey",
  "ops-witness",
  "regulator-witness",
]);
export type DualControlRole = z.infer<typeof DualControlRoleSchema>;

export const DualControlPolicySchema = z
  .object({
    requiredSigners: z.number().int().min(2).max(5).default(2),
    /** Roles that MAY sign. The quorum picks any m of these. */
    allowedRoleIds: z
      .array(DualControlRoleSchema)
      .min(2)
      .default(["owner-passkey", "ops-witness", "regulator-witness"]),
    /**
     * Roles that MUST be present in the verified set. owner-passkey is the
     * default required-must signer because no grant can exist without it.
     */
    mandatoryRoleIds: z.array(DualControlRoleSchema).default(["owner-passkey"]),
    /** Max time between the earliest and latest signature, ms. */
    maxAgeBetweenSignaturesMs: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60 * 1000)
      .default(60_000),
  })
  .strict()
  .refine((p) => p.requiredSigners <= p.allowedRoleIds.length, {
    message: "requiredSigners exceeds allowedRoleIds",
  })
  .refine((p) => p.mandatoryRoleIds.every((r) => p.allowedRoleIds.includes(r)), {
    message: "mandatoryRoleIds must be a subset of allowedRoleIds",
  });
export type DualControlPolicy = z.infer<typeof DualControlPolicySchema>;

// ---------- Signature submissions ----------

export const DualControlSignatureSchema = z
  .object({
    role: DualControlRoleSchema,
    keyId: z.string().min(1),
    /** RFC 3339 timestamp of signing. */
    signedAt: z.string().datetime(),
    /** Base64-encoded signature bytes. */
    sigB64: z.string().min(1),
    /**
     * Algorithm tag. ml-dsa-65 uses the local PQ verifier. webauthn variants
     * are out-of-scope here — the API gateway converts WebAuthn assertions
     * to ml-dsa-65 co-signatures via the witness service before calling this
     * module. That keeps this layer pure and deterministic.
     */
    alg: z.literal("ml-dsa-65"),
  })
  .strict();
export type DualControlSignature = z.infer<typeof DualControlSignatureSchema>;

export type DualControlPublicKey = {
  role: DualControlRole;
  keyId: string;
  /** ML-DSA-65 public key (1952 bytes). */
  publicKey: Uint8Array;
};

export type DualControlKeyResolver = (
  role: DualControlRole,
  keyId: string,
) => DualControlPublicKey | undefined;

// ---------- Result types ----------

export type DualControlAssembleResult =
  | {
      kind: "verified";
      grant: CommandGrant;
      verifiedSigners: Array<{ role: DualControlRole; keyId: string; signedAt: string }>;
    }
  | {
      kind: "rejected";
      reasons: string[];
    };

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Assemble a dual-control grant. Returns a typed rejection on any failure.
 *
 * Verification rules:
 *   - all submitted signatures must verify against the canonical grant bytes
 *   - duplicate roles are rejected (each role may sign at most once)
 *   - any role not in policy.allowedRoleIds is rejected
 *   - the verified count must be >= policy.requiredSigners
 *   - every role in policy.mandatoryRoleIds must be present
 *   - max(signedAt) - min(signedAt) must be <= maxAgeBetweenSignaturesMs
 */
export function assembleDualControlGrant(
  grant: CommandGrant,
  policy: DualControlPolicy,
  signatures: readonly DualControlSignature[],
  resolver: DualControlKeyResolver,
): DualControlAssembleResult {
  const reasons: string[] = [];
  const grantParse = CommandGrantSchema.safeParse(grant);
  if (!grantParse.success) {
    reasons.push(`invalid grant: ${grantParse.error.message}`);
    return { kind: "rejected", reasons };
  }

  const allowed = new Set(policy.allowedRoleIds);
  const seenRoles = new Set<DualControlRole>();
  const verified: Array<{ role: DualControlRole; keyId: string; signedAt: string }> = [];
  const bytes = canonicalGrantBytes(grant);

  for (const s of signatures) {
    if (!allowed.has(s.role)) {
      reasons.push(`role ${s.role} not in allowedRoleIds`);
      continue;
    }
    if (seenRoles.has(s.role)) {
      reasons.push(`duplicate role ${s.role}`);
      continue;
    }
    const key = resolver(s.role, s.keyId);
    if (!key) {
      reasons.push(`unknown key ${s.role}/${s.keyId}`);
      continue;
    }
    if (key.publicKey.length !== 1952) {
      reasons.push(`bad public key length for ${s.role}/${s.keyId}`);
      continue;
    }
    let sigBytes: Uint8Array;
    try {
      sigBytes = b64Decode(s.sigB64);
    } catch {
      reasons.push(`signature for ${s.role} not base64`);
      continue;
    }
    if (sigBytes.length !== 3309) {
      reasons.push(`signature for ${s.role} wrong length`);
      continue;
    }
    let ok = false;
    try {
      ok = ml_dsa65.verify(sigBytes, bytes, key.publicKey);
    } catch {
      reasons.push(`verify threw for ${s.role}`);
      continue;
    }
    if (!ok) {
      reasons.push(`signature mismatch for ${s.role}`);
      continue;
    }
    seenRoles.add(s.role);
    verified.push({ role: s.role, keyId: s.keyId, signedAt: s.signedAt });
  }

  if (verified.length < policy.requiredSigners) {
    reasons.push(
      `quorum not met: ${verified.length} verified < ${policy.requiredSigners} required`,
    );
  }
  for (const must of policy.mandatoryRoleIds) {
    if (!seenRoles.has(must)) {
      reasons.push(`mandatory role ${must} missing`);
    }
  }
  if (verified.length >= 2) {
    const times = verified.map((v) => Date.parse(v.signedAt)).sort((a, b) => a - b);
    const span = times[times.length - 1]! - times[0]!;
    if (span > policy.maxAgeBetweenSignaturesMs) {
      reasons.push(
        `signature window ${span}ms exceeds policy.maxAgeBetweenSignaturesMs (${policy.maxAgeBetweenSignaturesMs}ms)`,
      );
    }
  }

  if (reasons.length > 0) return { kind: "rejected", reasons };

  return {
    kind: "verified",
    grant,
    verifiedSigners: verified,
  };
}

// ---------- Off-platform audit sink ----------

export const OffPlatformAuditEntrySchema = z
  .object({
    /** chainHash of the AutonomyAction being recorded. */
    chainHash: z.string().length(64),
    /** Full action shape so the sink can store it as the canonical record. */
    action: z.object({
      actionId: z.string().uuid(),
      grantId: z.string().uuid(),
      timestamp: z.string().datetime(),
      kind: z.string(),
      payloadHash: z.string().length(64),
      prevChainHash: z.string().length(64).optional(),
    }),
    /** Source environment / region / shard. */
    source: z.string().min(1).default("vsbs-prod"),
  })
  .strict();
export type OffPlatformAuditEntry = z.infer<typeof OffPlatformAuditEntrySchema>;

export interface OffPlatformAuditReceipt {
  /** Sink-assigned external id (e.g., BigQuery insertId, QLDB documentId). */
  externalId: string;
  /** Sink-assigned receipt token — opaque to VSBS. */
  receipt: string;
  /** When the sink ack'd the write. */
  ackedAt: string;
}

export interface OffPlatformAuditSink {
  readonly name: string;
  appendAuditEntry(entry: OffPlatformAuditEntry): Promise<OffPlatformAuditReceipt>;
}

/** In-memory sink for tests. Stores entries in order; deterministic externalIds. */
export class InMemoryOffPlatformSink implements OffPlatformAuditSink {
  readonly name = "in-memory";
  readonly entries: Array<{ entry: OffPlatformAuditEntry; receipt: OffPlatformAuditReceipt }> = [];

  async appendAuditEntry(entry: OffPlatformAuditEntry): Promise<OffPlatformAuditReceipt> {
    const parsed = OffPlatformAuditEntrySchema.parse(entry);
    const externalId = `mem-${this.entries.length + 1}`;
    const receipt: OffPlatformAuditReceipt = {
      externalId,
      receipt: `r-${externalId}`,
      ackedAt: new Date().toISOString(),
    };
    this.entries.push({ entry: parsed, receipt });
    return receipt;
  }
}

/**
 * Sink that throws — used as the default in live deployments to make a
 * missing AUDIT_OFFPLATFORM_SINK_URL configuration fail loudly at the
 * first audit write.
 */
export class NotConfiguredOffPlatformSink implements OffPlatformAuditSink {
  readonly name = "not-configured";
  async appendAuditEntry(_entry: OffPlatformAuditEntry): Promise<OffPlatformAuditReceipt> {
    throw new Error(
      "Off-platform audit sink not configured. Set AUDIT_OFFPLATFORM_SINK_URL or provide a sink.",
    );
  }
}

/**
 * Helper: pipe an authority chain action into the sink. Callers normally
 * already hold the linked AutonomyAction returned from `appendAuthority`;
 * this helper wraps the shape mapping.
 */
export async function recordOffPlatformAudit(
  sink: OffPlatformAuditSink,
  action: AutonomyAction,
  source: string,
): Promise<OffPlatformAuditReceipt> {
  return sink.appendAuditEntry({
    chainHash: action.chainHash,
    action: {
      actionId: action.actionId,
      grantId: action.grantId,
      timestamp: action.timestamp,
      kind: action.kind,
      payloadHash: action.payloadHash,
      ...(action.prevChainHash !== undefined ? { prevChainHash: action.prevChainHash } : {}),
    },
    source,
  });
}
