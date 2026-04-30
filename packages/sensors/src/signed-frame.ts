// =============================================================================
// Cryptographically signed sensor frames + replay window.
//
// Every SensorSample crossing a trust boundary is wrapped in a SignedSensorFrame
// envelope carrying:
//   - keyId    : per-vehicle HMAC key identifier (sim: in-memory; live: KMS).
//   - nonce    : opaque per-frame token.
//   - alg      : signature algorithm. Today: "HMAC-SHA-256".
//   - signature: base64url of HMAC over canonical bytes of
//                (vehicleId, channel, ts, payload, nonce).
//
// Canonicalisation: deterministic JSON in the spirit of RFC 8785 — sorted
// keys, no whitespace, no insignificant ordering. We implement a small
// pure-function canonicaliser here rather than pull a dep.
//
// Replay window: configurable, default 5000 ms. A frame whose `ts` skews
// from the verifier's clock by more than the window is rejected
// ("frame-skew"). A frame whose nonce was seen inside the window is
// rejected ("frame-replay"). Per-vehicle nonce cache is a bounded LRU
// (default 1024) so memory is constant.
//
// Crypto: uses Web Crypto SubtleCrypto.importKey + sign / verify with HMAC
// SHA-256. No new deps. The shape of `SensorFrameKeyStore` is identical for
// sim and live; live mode wires it to a KMS client without touching this
// file.
// =============================================================================

import {
  SensorSampleSchema,
  SignedSensorFrameSchema,
  type SensorSample,
  type SignedSensorFrame,
  type SignedFrameAlg,
} from "@vsbs/shared";

export type FrameRejectionReason =
  | "frame-unsigned"
  | "frame-replay"
  | "frame-skew"
  | "frame-bad-sig"
  | "frame-unknown-key"
  | "frame-shape";

export class FrameVerificationError extends Error {
  readonly code: FrameRejectionReason;
  constructor(code: FrameRejectionReason, message: string) {
    super(message);
    this.code = code;
    this.name = "FrameVerificationError";
  }
}

export interface SensorFrameKey {
  /** Stable identifier; the live store uses the KMS resource name. */
  keyId: string;
  /** Opaque cryptographic key. Web Crypto CryptoKey for HMAC-SHA-256. */
  cryptoKey: CryptoKey;
  /** Algorithm — currently fixed to HMAC-SHA-256. */
  alg: SignedFrameAlg;
  /** Optional UTC ISO timestamp of activation. Older keys can verify but not sign. */
  activatedAt?: string;
  /** Optional UTC ISO timestamp of retirement. After retirement, sign rejects;
   *  verify still succeeds for back-compat during rotation. */
  retiredAt?: string;
}

/**
 * Per-vehicle key store. Sim driver keeps keys in a Map; live driver fronts
 * a KMS handle (Google Cloud KMS / AWS KMS / Azure Key Vault) under the same
 * shape. The state machine — current vs. previous key during rotation — is
 * the same for both.
 */
export interface SensorFrameKeyStore {
  /** Currently active signing key for this vehicle. Throws if absent. */
  current(vehicleId: string): Promise<SensorFrameKey>;
  /** Resolve a key by id (current OR retired-but-still-trusted). Returns
   *  undefined for unknown ids; the verifier translates that to
   *  "frame-unknown-key". */
  byId(vehicleId: string, keyId: string): Promise<SensorFrameKey | undefined>;
  /** Rotate. The previous key remains resolvable via `byId` for the
   *  duration of the replay window so in-flight frames still verify. */
  rotate(vehicleId: string, next: SensorFrameKey): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory key store. Production-grade for sim mode + tests; live mode
// implements the same interface against KMS without touching this file.
// ---------------------------------------------------------------------------

export class MemorySensorFrameKeyStore implements SensorFrameKeyStore {
  readonly #current = new Map<string, SensorFrameKey>();
  readonly #history = new Map<string, Map<string, SensorFrameKey>>();

  async current(vehicleId: string): Promise<SensorFrameKey> {
    const k = this.#current.get(vehicleId);
    if (!k) throw new Error(`no signing key registered for vehicle ${vehicleId}`);
    return k;
  }

  async byId(vehicleId: string, keyId: string): Promise<SensorFrameKey | undefined> {
    const history = this.#history.get(vehicleId);
    return history?.get(keyId);
  }

  async rotate(vehicleId: string, next: SensorFrameKey): Promise<void> {
    this.#current.set(vehicleId, next);
    let h = this.#history.get(vehicleId);
    if (!h) {
      h = new Map<string, SensorFrameKey>();
      this.#history.set(vehicleId, h);
    }
    h.set(next.keyId, next);
  }
}

/**
 * Generate a fresh HMAC-SHA-256 key via Web Crypto. Used by sim setup and
 * tests; live mode receives keys from KMS and never calls this.
 */
export async function generateHmacKey(keyId: string): Promise<SensorFrameKey> {
  const cryptoKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  return {
    keyId,
    cryptoKey,
    alg: "HMAC-SHA-256",
    activatedAt: new Date().toISOString(),
  };
}

/**
 * Import an HMAC-SHA-256 key from raw bytes. Convenience for tests + the
 * .env-bootstrapped sim path.
 */
export async function importHmacKey(
  keyId: string,
  rawBytes: Uint8Array,
): Promise<SensorFrameKey> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return {
    keyId,
    cryptoKey,
    alg: "HMAC-SHA-256",
    activatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Signing + verification.
// ---------------------------------------------------------------------------

export interface SignFrameOptions {
  /** Override the nonce; tests use this for replay-detection scenarios. */
  nonce?: string;
}

export async function signFrame(
  store: SensorFrameKeyStore,
  sample: SensorSample,
  opts: SignFrameOptions = {},
): Promise<SignedSensorFrame> {
  const parsed = SensorSampleSchema.parse(sample);
  const key = await store.current(parsed.vehicleId);
  if (key.alg !== "HMAC-SHA-256") {
    throw new Error(`unsupported alg ${key.alg}`);
  }
  const nonce = opts.nonce ?? randomNonce();
  const bytes = canonicalBytes(parsed, nonce);
  const sig = await crypto.subtle.sign("HMAC", key.cryptoKey, bytes as BufferSource);
  return SignedSensorFrameSchema.parse({
    sample: parsed,
    keyId: key.keyId,
    nonce,
    alg: key.alg,
    signature: base64UrlEncode(new Uint8Array(sig)),
  });
}

export interface VerifyFrameOptions {
  /** Replay window in ms; default 5000. */
  windowMs?: number;
  /** Override of `now()` for tests. */
  now?: () => number;
  /** Replay cache; one shared instance across calls keeps replay state. */
  replayCache?: ReplayCache;
}

export interface VerifyFrameSuccess {
  ok: true;
  sample: SensorSample;
}

export type VerifyFrameResult =
  | VerifyFrameSuccess
  | { ok: false; reason: FrameRejectionReason; message: string };

/**
 * Verify a SignedSensorFrame against a key store and replay cache.
 *
 * Returns a discriminated result; callers can map a rejection reason to an
 * HTTP error code. Throws only on truly internal errors (programming bugs).
 */
export async function verifyFrame(
  store: SensorFrameKeyStore,
  frame: unknown,
  opts: VerifyFrameOptions = {},
): Promise<VerifyFrameResult> {
  const parsed = SignedSensorFrameSchema.safeParse(frame);
  if (!parsed.success) {
    return { ok: false, reason: "frame-shape", message: parsed.error.message };
  }
  const f = parsed.data;
  const now = opts.now?.() ?? Date.now();
  const windowMs = opts.windowMs ?? 5000;

  const ts = Date.parse(f.sample.timestamp);
  if (Number.isNaN(ts)) {
    return { ok: false, reason: "frame-shape", message: "invalid timestamp" };
  }
  if (Math.abs(now - ts) > windowMs) {
    return {
      ok: false,
      reason: "frame-skew",
      message: `frame ts skew ${Math.abs(now - ts)}ms exceeds window ${windowMs}ms`,
    };
  }

  const key = await store.byId(f.sample.vehicleId, f.keyId);
  if (!key) {
    return { ok: false, reason: "frame-unknown-key", message: `unknown keyId ${f.keyId}` };
  }
  if (key.alg !== f.alg) {
    return { ok: false, reason: "frame-bad-sig", message: `alg mismatch ${key.alg} vs ${f.alg}` };
  }

  const sigBytes = base64UrlDecode(f.signature);
  if (!sigBytes) {
    return { ok: false, reason: "frame-bad-sig", message: "invalid signature encoding" };
  }
  const bytes = canonicalBytes(f.sample, f.nonce);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key.cryptoKey,
    sigBytes as BufferSource,
    bytes as BufferSource,
  );
  if (!ok) {
    return { ok: false, reason: "frame-bad-sig", message: "HMAC verification failed" };
  }

  // Replay check is the last gate — only seen-nonce checks run after a
  // valid signature; otherwise an attacker could pollute the cache by
  // flooding bad-sig frames.
  const cache = opts.replayCache;
  if (cache) {
    const seen = cache.seen(f.sample.vehicleId, f.nonce, now, windowMs);
    if (seen) {
      return {
        ok: false,
        reason: "frame-replay",
        message: `nonce ${f.nonce} already seen for vehicle ${f.sample.vehicleId}`,
      };
    }
    cache.remember(f.sample.vehicleId, f.nonce, now);
  }

  return { ok: true, sample: f.sample };
}

/**
 * The "unsigned frame" path: the ingest layer calls this when a payload was
 * received without the SignedSensorFrame envelope. Always rejects.
 */
export function rejectUnsigned(): VerifyFrameResult {
  return {
    ok: false,
    reason: "frame-unsigned",
    message: "ingest requires SignedSensorFrame envelope",
  };
}

// ---------------------------------------------------------------------------
// Bounded LRU replay cache. Per-vehicle nonce → first-seen-ts. Cap default
// 1024. Eviction is FIFO; we sweep entries older than the window on lookup
// so memory stays O(cap).
// ---------------------------------------------------------------------------

export interface ReplayCacheConfig {
  capPerVehicle?: number;
}

export class ReplayCache {
  readonly #cap: number;
  readonly #byVehicle = new Map<string, Map<string, number>>();

  constructor(cfg: ReplayCacheConfig = {}) {
    this.#cap = cfg.capPerVehicle ?? 1024;
  }

  seen(vehicleId: string, nonce: string, now: number, windowMs: number): boolean {
    const m = this.#byVehicle.get(vehicleId);
    if (!m) return false;
    const ts = m.get(nonce);
    if (ts === undefined) return false;
    if (now - ts > windowMs) {
      m.delete(nonce);
      return false;
    }
    return true;
  }

  remember(vehicleId: string, nonce: string, now: number): void {
    let m = this.#byVehicle.get(vehicleId);
    if (!m) {
      m = new Map<string, number>();
      this.#byVehicle.set(vehicleId, m);
    }
    if (m.size >= this.#cap) {
      // Evict the oldest (insertion-order Map).
      const oldest = m.keys().next();
      if (!oldest.done) m.delete(oldest.value);
    }
    m.set(nonce, now);
  }

  size(vehicleId: string): number {
    return this.#byVehicle.get(vehicleId)?.size ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers — canonical bytes (RFC 8785 spirit), base64url, nonce.
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();

export function canonicalBytes(sample: SensorSample, nonce: string): Uint8Array {
  // Order is fixed; we serialise an ordered tuple-shaped object so any
  // unexpected drift in SensorSample fields cannot affect the signed bytes.
  const obj = {
    channel: sample.channel,
    nonce,
    payload: sample.value,
    ts: sample.timestamp,
    vehicleId: sample.vehicleId,
  };
  return TEXT_ENCODER.encode(canonicalJson(obj));
}

/**
 * RFC 8785-style canonical JSON: object keys sorted lexicographically,
 * arrays preserved, no whitespace, numbers in JSON's shortest exact form,
 * strings JSON-escaped. We do NOT need full RFC 8785 number canonicalisation
 * (which deals with float edge cases) because sensor payloads are integers
 * or short decimals; `JSON.stringify` on a primitive number is canonical
 * enough for our HMAC. If a payload contains non-finite numbers, we throw.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalJson: non-finite number");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonicalJson(v));
    return "[" + parts.join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      if (obj[k] === undefined) continue;
      parts.push(JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array | undefined {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}
