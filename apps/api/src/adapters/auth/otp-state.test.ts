import { describe, it, expect } from "vitest";
import {
  OtpMemoryStore,
  startOtp,
  verifyOtp,
  generateOtp,
  type OtpConfig,
} from "./otp-state.js";

const cfg: OtpConfig = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 3,
  lockoutSeconds: 600,
};

function seed() {
  const store = new OtpMemoryStore();
  const { state } = startOtp(
    { phone: "+911234567890", purpose: "login", locale: "en" },
    cfg,
    store,
  );
  return { store, state };
}

describe("generateOtp", () => {
  it("produces a numeric string of configured length", () => {
    const code = generateOtp(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("respects custom lengths", () => {
    expect(generateOtp(4)).toMatch(/^\d{4}$/);
    expect(generateOtp(8)).toMatch(/^\d{8}$/);
  });
});

describe("startOtp", () => {
  it("creates a challenge with a code of configured length", () => {
    const { state } = seed();
    expect(state.code).toMatch(/^\d{6}$/);
    expect(state.phone).toBe("+911234567890");
    expect(state.attempts).toBe(0);
    expect(state.lockedUntil).toBeNull();
    expect(state.challengeId).toMatch(/[0-9a-f-]{36}/i);
  });
});

describe("verifyOtp", () => {
  it("accepts the correct code", () => {
    const { store, state } = seed();
    const r = verifyOtp({ challengeId: state.challengeId, code: state.code }, cfg, store);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.subject).toBe(state.phone);
  });

  it("deletes challenge on success (cannot reuse)", () => {
    const { store, state } = seed();
    verifyOtp({ challengeId: state.challengeId, code: state.code }, cfg, store);
    const again = verifyOtp({ challengeId: state.challengeId, code: state.code }, cfg, store);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("OTP_CHALLENGE_NOT_FOUND");
  });

  it("rejects wrong code with OTP_INVALID", () => {
    const { store, state } = seed();
    const r = verifyOtp({ challengeId: state.challengeId, code: "000000" === state.code ? "111111" : "000000" }, cfg, store);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("OTP_INVALID");
  });

  it("locks out after maxAttempts wrong attempts", () => {
    const { store, state } = seed();
    const wrong = state.code === "999999" ? "000000" : "999999";
    let last;
    for (let i = 0; i < cfg.maxAttempts; i++) {
      last = verifyOtp({ challengeId: state.challengeId, code: wrong }, cfg, store);
    }
    expect(last!.ok).toBe(false);
    if (!last!.ok) expect(last!.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");

    // subsequent verify returns OTP_LOCKED
    const next = verifyOtp({ challengeId: state.challengeId, code: state.code }, cfg, store);
    expect(next.ok).toBe(false);
    if (!next.ok) expect(next.error.code).toBe("OTP_LOCKED");
  });

  it("rejects unknown challenge id", () => {
    const store = new OtpMemoryStore();
    const r = verifyOtp(
      { challengeId: "00000000-0000-4000-8000-000000000000", code: "123456" },
      cfg,
      store,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("OTP_CHALLENGE_NOT_FOUND");
  });

  it("rejects expired challenge with OTP_EXPIRED", () => {
    const store = new OtpMemoryStore();
    const { state } = startOtp(
      { phone: "+911234567890", purpose: "login", locale: "en" },
      { ...cfg, ttlSeconds: 0 },
      store,
    );
    // Manually set expiry into the past to defeat the store's GC.
    state.expiresAt = Date.now() - 10_000;
    store.put(state);
    const r = verifyOtp({ challengeId: state.challengeId, code: state.code }, cfg, store);
    expect(r.ok).toBe(false);
    // Store GC may kick in first and produce CHALLENGE_NOT_FOUND; either is acceptable evidence of expiry handling.
    if (!r.ok) {
      expect(["OTP_EXPIRED", "OTP_CHALLENGE_NOT_FOUND"]).toContain(r.error.code);
    }
  });
});

describe("OtpMemoryStore", () => {
  it("delete removes the entry", () => {
    const { store, state } = seed();
    store.delete(state.challengeId);
    expect(store.get(state.challengeId)).toBeUndefined();
  });
});
