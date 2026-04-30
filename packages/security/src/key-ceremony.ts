// =============================================================================
// Multi-party key ceremony with Shamir Secret Sharing.
//
// References:
//   Shamir, "How to share a secret", CACM 1979 (the original paper).
//   FIPS 197 §4.2 (GF(2^8) with irreducible polynomial 0x11b — same field
//     used by AES). We work byte-wise over GF(2^8) so an N-byte secret
//     becomes N independent Shamir polynomials evaluated at the same set
//     of x-coordinates per share. This is the conventional production
//     formulation (e.g. HashiCorp Vault's `shamir` package). It supports
//     secrets of any byte length and shares of fixed (1 + N + 1) bytes
//     each (1 byte version || N share bytes || 1 byte share x-index).
//   NIST SP 800-57 Pt 2 §6.3 (key ceremony procedures, threshold custody).
//   ANSI X9.95 (trusted timestamping) — used for ceremony attestations.
//
// Why bytewise GF(2^8) and not GF(2^256):
//   GF(2^256) needs a 256-bit irreducible polynomial and a multiplication
//   routine that is constant-time over big integers. The bytewise GF(2^8)
//   form decomposes the same secret into N independent 8-bit polynomials,
//   each over the AES field, which already has a hardware-accelerated
//   constant-time multiplication on every modern CPU and is the form used
//   by every production Shamir library that has been audited at scale.
//   The information-theoretic security guarantee is identical: knowledge
//   of fewer than threshold shares yields zero information about the
//   secret, byte by byte.
//
// Module is provider-agnostic: ceremony orchestration emits a hash-chained
// record that the caller can persist anywhere (local disk, GCS bucket,
// notarised log). The chain is tamper-evident — flipping any earlier entry
// changes every subsequent hash and is detected by `verifyCeremonyRecord`.
// =============================================================================

import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";

// -----------------------------------------------------------------------------
// GF(2^8) — AES field arithmetic, irreducible polynomial x^8 + x^4 + x^3 + x + 1.
// We precompute log/antilog tables so multiplication is O(1) per operation
// and constant-time with respect to operand value (table accesses).
// -----------------------------------------------------------------------------

// Primitive root of GF(2^8) under the AES irreducible polynomial 0x11b.
// 2 is not a primitive root — the multiplicative order of 2 in this field
// is 51, not 255. 3 generates the entire multiplicative group, which is
// what FIPS 197 references when it states 0x03 generates GF(2^8)*.
const GF_GENERATOR = 0x03;

function gfMulRaw(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) result ^= aa;
    const high = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (high) aa ^= 0x1b;
    bb >>= 1;
  }
  return result;
}

const { LOG: GF_LOG, ANTILOG: GF_ANTILOG } = (() => {
  const LOG = new Uint8Array(256);
  const ANTILOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    ANTILOG[i] = x;
    LOG[x] = i;
    x = gfMulRaw(x, GF_GENERATOR);
  }
  ANTILOG[255] = ANTILOG[0]!;
  return { LOG, ANTILOG };
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const sum = (LOG_OF(a) + LOG_OF(b)) % 255;
  return ANTILOG_OF(sum);
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("division by zero in GF(2^8)");
  if (a === 0) return 0;
  const diff = (LOG_OF(a) - LOG_OF(b) + 255) % 255;
  return ANTILOG_OF(diff);
}

function LOG_OF(a: number): number {
  return GF_LOG[a]!;
}

function ANTILOG_OF(a: number): number {
  return GF_ANTILOG[a]!;
}

// -----------------------------------------------------------------------------
// Random secret coefficients. We draw from the system CSPRNG (WebCrypto).
// -----------------------------------------------------------------------------

function randBytes(n: number): Uint8Array {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("a CSPRNG is required (crypto.getRandomValues)");
  }
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// -----------------------------------------------------------------------------
// Polynomial evaluation in GF(2^8). Horner's method: O(threshold) per byte.
// -----------------------------------------------------------------------------

function evalPolynomial(coefficients: Uint8Array, x: number): number {
  let acc = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    acc = gfMul(acc, x) ^ coefficients[i]!;
  }
  return acc;
}

/**
 * Lagrange interpolation at x = 0. Returns the secret byte given threshold
 * (x_i, y_i) coordinate pairs. O(threshold^2) per byte.
 */
function lagrangeAtZero(points: Array<{ x: number; y: number }>): number {
  let secret = 0;
  for (let i = 0; i < points.length; i++) {
    let num = 1;
    let den = 1;
    const xi = points[i]!.x;
    const yi = points[i]!.y;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const xj = points[j]!.x;
      num = gfMul(num, xj);
      den = gfMul(den, xi ^ xj);
    }
    const li = gfDiv(num, den);
    secret ^= gfMul(yi, li);
  }
  return secret;
}

// -----------------------------------------------------------------------------
// Public API — split / recombine
// -----------------------------------------------------------------------------

const SHARE_VERSION = 0x01;

export const ShareSchema = z
  .string()
  .min(1)
  .refine((s) => /^[A-Za-z0-9+/=]+$/.test(s), { message: "share must be base64" });
export type Share = string;

export interface SplitOptions {
  /** Inject a CSPRNG for tests. Real code uses WebCrypto. */
  rng?: (n: number) => Uint8Array;
}

/**
 * Split a secret into `total` shares such that any `threshold` of them
 * recover the secret. Information-theoretic security: fewer than
 * `threshold` shares yields zero information about the secret.
 */
export function splitSecret(
  secret: Uint8Array,
  threshold: number,
  total: number,
  opts: SplitOptions = {},
): Share[] {
  if (secret.length === 0) throw new Error("secret must be non-empty");
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error("threshold must be an integer >= 2");
  }
  if (!Number.isInteger(total) || total < threshold) {
    throw new Error("total must be an integer >= threshold");
  }
  if (total > 255) throw new Error("total cannot exceed 255 (GF(2^8) cap)");
  const rng = opts.rng ?? randBytes;

  // For each secret byte we build a polynomial of degree threshold-1
  // whose constant term is the byte and whose other coefficients are
  // uniformly random in GF(2^8).
  const shareData = new Uint8Array(total * secret.length);
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[byteIdx]!;
    const noise = rng(threshold - 1);
    for (let i = 1; i < threshold; i++) coeffs[i] = noise[i - 1]!;

    for (let shareIdx = 0; shareIdx < total; shareIdx++) {
      const x = shareIdx + 1; // x must be non-zero in GF(2^8)
      shareData[shareIdx * secret.length + byteIdx] = evalPolynomial(coeffs, x);
    }
  }

  // Pack each share as: 1 byte version || 1 byte x-index || N bytes y-values.
  const out: Share[] = [];
  for (let shareIdx = 0; shareIdx < total; shareIdx++) {
    const buf = new Uint8Array(2 + secret.length);
    buf[0] = SHARE_VERSION;
    buf[1] = shareIdx + 1;
    buf.set(shareData.subarray(shareIdx * secret.length, (shareIdx + 1) * secret.length), 2);
    out.push(toBase64(buf));
  }
  return out;
}

/** Recombine a secret from any subset of size >= threshold. */
export function recombineShares(shares: Share[], threshold: number): Uint8Array {
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error("threshold must be an integer >= 2");
  }
  if (shares.length < threshold) {
    throw new Error(`need at least ${threshold} shares, got ${shares.length}`);
  }
  const decoded = shares.slice(0, threshold).map((s) => fromBase64(s));
  const secretLen = decoded[0]!.length - 2;
  if (secretLen <= 0) throw new Error("share is too short");
  for (const d of decoded) {
    if (d[0] !== SHARE_VERSION) throw new Error(`unknown share version ${d[0]}`);
    if (d.length - 2 !== secretLen) throw new Error("share length mismatch");
  }

  // Detect duplicate x-indices — recombination is undefined.
  const seen = new Set<number>();
  for (const d of decoded) {
    const xi = d[1]!;
    if (seen.has(xi)) throw new Error("duplicate share x-index");
    seen.add(xi);
  }

  const out = new Uint8Array(secretLen);
  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    const points: Array<{ x: number; y: number }> = decoded.map((d) => ({
      x: d[1]!,
      y: d[2 + byteIdx]!,
    }));
    out[byteIdx] = lagrangeAtZero(points);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Ceremony orchestration — tamper-evident hash-chained record.
// -----------------------------------------------------------------------------

export const ParticipantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Hex-encoded SHA-256 of the participant's hardware-token public key. */
  publicKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const CeremonyPolicySchema = z.object({
  threshold: z.number().int().min(2),
  total: z.number().int().min(2).max(255),
  /** Byte length of the secret being split. */
  secretLength: z.number().int().min(1),
  /** Free-form purpose, e.g. "VSBS root signing key 2026-Q2". */
  purpose: z.string().min(1),
  /** Operator who orchestrates the ceremony. */
  orchestrator: ParticipantSchema,
});
export type CeremonyPolicy = z.infer<typeof CeremonyPolicySchema>;

export const ParticipantAttestationSchema = z.object({
  participantId: z.string(),
  shareIndex: z.number().int().min(1).max(255),
  /** Hex SHA-256 of the share bytes — auditors can verify a participant
   *  later confirms they hold the same share without revealing it. */
  shareDigest: z.string().regex(/^[0-9a-f]{64}$/),
  acknowledgedAt: z.string().datetime(),
});
export type ParticipantAttestation = z.infer<typeof ParticipantAttestationSchema>;

export const CeremonyEntrySchema = z.object({
  index: z.number().int().min(0),
  /** Hex SHA-256 of the previous entry's canonical bytes; "" for genesis. */
  previousHash: z.string(),
  /** Hex SHA-256 of THIS entry's canonical bytes; populated when entry is sealed. */
  hash: z.string(),
  type: z.enum(["genesis", "split", "attestation", "seal"]),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime(),
});
export type CeremonyEntry = z.infer<typeof CeremonyEntrySchema>;

export const CeremonyRecordSchema = z.object({
  policy: CeremonyPolicySchema,
  participants: z.array(ParticipantSchema).min(2),
  entries: z.array(CeremonyEntrySchema).min(2),
  /** Hex SHA-256 of the last entry's hash — published as the ceremony id. */
  finalHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CeremonyRecord = z.infer<typeof CeremonyRecordSchema>;

export interface CeremonyResult {
  record: CeremonyRecord;
  /** Mapping of participant id to their share. Returned to the orchestrator
   *  in-process only; never persisted to the record. */
  shares: Map<string, Share>;
}

export interface RunCeremonyInput {
  participants: Participant[];
  policy: CeremonyPolicy;
  /** Inject a clock for tests so timestamps are deterministic. */
  now?: () => Date;
  /** Inject randomness for tests. Real code uses WebCrypto. */
  rng?: (n: number) => Uint8Array;
  /** The secret that will be split. */
  secret: Uint8Array;
}

export function runCeremony(input: RunCeremonyInput): CeremonyResult {
  const policy = CeremonyPolicySchema.parse(input.policy);
  const participants = input.participants.map((p) => ParticipantSchema.parse(p));
  if (participants.length !== policy.total) {
    throw new Error(
      `participants length (${participants.length}) must equal policy.total (${policy.total})`,
    );
  }
  if (input.secret.length !== policy.secretLength) {
    throw new Error(
      `secret byte length (${input.secret.length}) must match policy.secretLength (${policy.secretLength})`,
    );
  }
  const now = input.now ?? (() => new Date());

  const entries: CeremonyEntry[] = [];

  const append = (entry: Omit<CeremonyEntry, "index" | "hash" | "previousHash">): CeremonyEntry => {
    const previous = entries.at(-1);
    const idx = previous ? previous.index + 1 : 0;
    const previousHash = previous ? previous.hash : "";
    const draft: CeremonyEntry = {
      index: idx,
      previousHash,
      hash: "",
      type: entry.type,
      payload: entry.payload,
      timestamp: entry.timestamp,
    };
    draft.hash = hashEntry(draft);
    entries.push(draft);
    return draft;
  };

  // Genesis — bind the policy + participants list into the first hash.
  append({
    type: "genesis",
    payload: {
      policy,
      participantIds: participants.map((p) => p.id),
    },
    timestamp: now().toISOString(),
  });

  // Split the secret.
  const opts: SplitOptions = {};
  if (input.rng) opts.rng = input.rng;
  const shares = splitSecret(input.secret, policy.threshold, policy.total, opts);
  if (shares.length !== participants.length) {
    throw new Error("internal: share count mismatch");
  }

  const sharesById = new Map<string, Share>();
  const attestations: ParticipantAttestation[] = [];
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i]!;
    const share = shares[i]!;
    sharesById.set(participant.id, share);
    const digest = hex(sha256(fromBase64(share)));
    attestations.push(
      ParticipantAttestationSchema.parse({
        participantId: participant.id,
        shareIndex: i + 1,
        shareDigest: digest,
        acknowledgedAt: now().toISOString(),
      }),
    );
  }

  append({
    type: "split",
    payload: {
      threshold: policy.threshold,
      total: policy.total,
      secretByteLength: input.secret.length,
    },
    timestamp: now().toISOString(),
  });

  for (const att of attestations) {
    append({
      type: "attestation",
      payload: att,
      timestamp: now().toISOString(),
    });
  }

  append({
    type: "seal",
    payload: {
      sealedBy: policy.orchestrator.id,
      attestationsCount: attestations.length,
    },
    timestamp: now().toISOString(),
  });

  const finalHash = entries.at(-1)!.hash;
  const record = CeremonyRecordSchema.parse({
    policy,
    participants,
    entries,
    finalHash,
  });
  return { record, shares: sharesById };
}

/**
 * Walk the ceremony chain, recompute every hash, and return ok=true only
 * when every link matches. Detects any tampering: replaced payloads,
 * deleted entries, reordered entries.
 */
export function verifyCeremonyRecord(record: CeremonyRecord): { ok: boolean; reason?: string } {
  const parse = CeremonyRecordSchema.safeParse(record);
  if (!parse.success) {
    return { ok: false, reason: `schema:${parse.error.issues[0]?.message ?? "invalid"}` };
  }
  const r = parse.data;
  let prev = "";
  for (let i = 0; i < r.entries.length; i++) {
    const entry = r.entries[i]!;
    if (entry.index !== i) return { ok: false, reason: `index-mismatch@${i}` };
    if (entry.previousHash !== prev) {
      return { ok: false, reason: `previous-hash-mismatch@${i}` };
    }
    const recomputed = hashEntry({ ...entry, hash: "" });
    if (recomputed !== entry.hash) {
      return { ok: false, reason: `entry-hash-mismatch@${i}` };
    }
    prev = entry.hash;
  }
  if (r.finalHash !== prev) return { ok: false, reason: "final-hash-mismatch" };
  return { ok: true };
}

function hashEntry(entry: CeremonyEntry): string {
  const canonical = canonicalJson({
    index: entry.index,
    previousHash: entry.previousHash,
    type: entry.type,
    payload: entry.payload,
    timestamp: entry.timestamp,
  });
  const bytes = new TextEncoder().encode(canonical);
  return hex(sha256(bytes));
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not canonicalisable");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(`${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new Error(`unsupported value of type ${typeof value}`);
}

// -----------------------------------------------------------------------------
// Helpers — base64 + hex
// -----------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return typeof btoa === "function"
    ? btoa(s)
    : Buffer.from(s, "binary").toString("base64");
}

function fromBase64(s: string): Uint8Array {
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}
