// =============================================================================
// OTP shared state machine — identical logic used by sim and live drivers.
// Per docs/simulation-policy.md: the adapter is the state machine; only
// the *transport* (live SMS vs. demo live-display) differs.
// =============================================================================

import type {
  OtpState,
  OtpStartRequest,
  OtpVerifyRequest,
  OtpError,
} from "@vsbs/shared";

export interface OtpStoreLike {
  get(challengeId: string): OtpState | undefined;
  put(state: OtpState): void;
  delete(challengeId: string): void;
}

/** In-memory store. In production this is Valkey/Memorystore; interface is identical. */
export class OtpMemoryStore implements OtpStoreLike {
  readonly #map = new Map<string, OtpState>();
  get(challengeId: string): OtpState | undefined {
    const s = this.#map.get(challengeId);
    if (!s) return undefined;
    if (Date.now() > s.expiresAt && (s.lockedUntil ?? 0) < Date.now()) {
      this.#map.delete(challengeId);
      return undefined;
    }
    return s;
  }
  put(state: OtpState): void {
    this.#map.set(state.challengeId, state);
  }
  delete(challengeId: string): void {
    this.#map.delete(challengeId);
  }
}

export interface OtpConfig {
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  lockoutSeconds: number;
}

/** Generate a numeric OTP of the configured length using `crypto`. */
export function generateOtp(length: number): string {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  let out = "";
  for (let i = 0; i < length; i++) {
    const d = digits[i];
    if (d === undefined) throw new Error("rng failure");
    out += String(d % 10);
  }
  return out;
}

export interface OtpStartResult {
  state: OtpState;
}

export function startOtp(
  req: OtpStartRequest,
  cfg: OtpConfig,
  store: OtpStoreLike,
): OtpStartResult {
  const challengeId = crypto.randomUUID();
  const now = Date.now();
  const state: OtpState = {
    challengeId,
    phone: req.phone,
    code: generateOtp(cfg.length),
    purpose: req.purpose,
    createdAt: now,
    expiresAt: now + cfg.ttlSeconds * 1000,
    attempts: 0,
    maxAttempts: cfg.maxAttempts,
    lockedUntil: null,
    locale: req.locale,
  };
  store.put(state);
  return { state };
}

export type OtpVerifyResult =
  | { ok: true; subject: string }
  | { ok: false; error: OtpError };

export function verifyOtp(
  req: OtpVerifyRequest,
  cfg: OtpConfig,
  store: OtpStoreLike,
): OtpVerifyResult {
  const s = store.get(req.challengeId);
  if (!s) return { ok: false, error: { code: "OTP_CHALLENGE_NOT_FOUND" } };

  const now = Date.now();
  if (s.lockedUntil !== null && now < s.lockedUntil) {
    return { ok: false, error: { code: "OTP_LOCKED", unlockAt: new Date(s.lockedUntil).toISOString() } };
  }
  if (now > s.expiresAt) {
    store.delete(s.challengeId);
    return { ok: false, error: { code: "OTP_EXPIRED" } };
  }

  s.attempts += 1;

  if (constantTimeEquals(req.code, s.code)) {
    store.delete(s.challengeId);
    return { ok: true, subject: s.phone };
  }

  if (s.attempts >= s.maxAttempts) {
    s.lockedUntil = now + cfg.lockoutSeconds * 1000;
    store.put(s);
    return { ok: false, error: { code: "OTP_ATTEMPTS_EXCEEDED" } };
  }

  store.put(s);
  return { ok: false, error: { code: "OTP_INVALID" } };
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
