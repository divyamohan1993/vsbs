import { describe, it, expect } from "vitest";
import type { SensorSample } from "@vsbs/shared";
import {
  signFrame,
  verifyFrame,
  generateHmacKey,
  importHmacKey,
  MemorySensorFrameKeyStore,
  ReplayCache,
  canonicalJson,
  canonicalBytes,
  rejectUnsigned,
} from "./signed-frame.js";

function sampleAt(ts: string, vehicleId = "veh-1"): SensorSample {
  return {
    channel: "obd-pid",
    timestamp: ts,
    origin: "real",
    vehicleId,
    value: { pid: "0105", value: 86 },
    health: { selfTestOk: true, trust: 1 },
  };
}

describe("canonicalJson", () => {
  it("sorts object keys", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
  });
  it("treats key order as irrelevant", () => {
    expect(canonicalJson({ x: { b: 2, a: 1 } })).toBe(
      canonicalJson({ x: { a: 1, b: 2 } }),
    );
  });
});

describe("canonicalBytes", () => {
  it("is stable and includes vehicleId, channel, ts, payload, nonce", () => {
    const s = sampleAt("2026-04-30T10:00:00.000Z");
    const a = canonicalBytes(s, "n1");
    const b = canonicalBytes(s, "n1");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const text = new TextDecoder().decode(a);
    expect(text).toContain("veh-1");
    expect(text).toContain("obd-pid");
    expect(text).toContain("2026-04-30T10:00:00.000Z");
    expect(text).toContain("n1");
  });
});

describe("sign + verify round-trip", () => {
  it("verifies a freshly signed frame", async () => {
    const store = new MemorySensorFrameKeyStore();
    const key = await generateHmacKey("k1");
    await store.rotate("veh-1", key);
    const ts = new Date().toISOString();
    const signed = await signFrame(store, sampleAt(ts));
    const result = await verifyFrame(store, signed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sample.vehicleId).toBe("veh-1");
  });

  it("rejects a tampered payload (frame-bad-sig)", async () => {
    const store = new MemorySensorFrameKeyStore();
    const key = await generateHmacKey("k1");
    await store.rotate("veh-1", key);
    const ts = new Date().toISOString();
    const signed = await signFrame(store, sampleAt(ts));
    const tampered = {
      ...signed,
      sample: { ...signed.sample, value: { pid: "0105", value: 999 } },
    };
    const r = await verifyFrame(store, tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("frame-bad-sig");
  });

  it("rejects a tampered timestamp (frame-bad-sig if within window)", async () => {
    const store = new MemorySensorFrameKeyStore();
    const key = await generateHmacKey("k1");
    await store.rotate("veh-1", key);
    const ts = new Date().toISOString();
    const signed = await signFrame(store, sampleAt(ts));
    const tampered = {
      ...signed,
      sample: { ...signed.sample, timestamp: new Date(Date.now() + 1).toISOString() },
    };
    const r = await verifyFrame(store, tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("frame-bad-sig");
  });

  it("rejects a frame outside the replay window (frame-skew)", async () => {
    const store = new MemorySensorFrameKeyStore();
    const key = await generateHmacKey("k1");
    await store.rotate("veh-1", key);
    const old = new Date(Date.now() - 60_000).toISOString();
    const signed = await signFrame(store, sampleAt(old));
    const r = await verifyFrame(store, signed, { windowMs: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("frame-skew");
  });

  it("rejects a replayed nonce (frame-replay)", async () => {
    const store = new MemorySensorFrameKeyStore();
    const key = await generateHmacKey("k1");
    await store.rotate("veh-1", key);
    const cache = new ReplayCache();
    const ts = new Date().toISOString();
    const signed = await signFrame(store, sampleAt(ts), { nonce: "fixed-nonce-1" });
    const r1 = await verifyFrame(store, signed, { replayCache: cache });
    expect(r1.ok).toBe(true);
    const r2 = await verifyFrame(store, signed, { replayCache: cache });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("frame-replay");
  });

  it("rejects when no key is registered for the vehicle (frame-unknown-key)", async () => {
    const senderStore = new MemorySensorFrameKeyStore();
    const verifierStore = new MemorySensorFrameKeyStore();
    const key = await generateHmacKey("k1");
    await senderStore.rotate("veh-1", key);
    const ts = new Date().toISOString();
    const signed = await signFrame(senderStore, sampleAt(ts));
    const r = await verifyFrame(verifierStore, signed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("frame-unknown-key");
  });

  it("rejects unsigned ingest path with frame-unsigned", () => {
    const r = rejectUnsigned();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("frame-unsigned");
  });

  it("rejects malformed envelopes with frame-shape", async () => {
    const store = new MemorySensorFrameKeyStore();
    const r = await verifyFrame(store, { nope: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("frame-shape");
  });

  it("imported raw key signs and verifies symmetrically", async () => {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const store = new MemorySensorFrameKeyStore();
    const key = await importHmacKey("k-raw", raw);
    await store.rotate("veh-1", key);
    const ts = new Date().toISOString();
    const signed = await signFrame(store, sampleAt(ts));
    const r = await verifyFrame(store, signed);
    expect(r.ok).toBe(true);
  });

  it("rotation: old keyId still verifies in-flight frames; new frames sign with new key", async () => {
    const store = new MemorySensorFrameKeyStore();
    const k1 = await generateHmacKey("k1");
    await store.rotate("veh-1", k1);
    const ts = new Date().toISOString();
    const signedOld = await signFrame(store, sampleAt(ts));
    expect(signedOld.keyId).toBe("k1");

    const k2 = await generateHmacKey("k2");
    await store.rotate("veh-1", k2);
    const signedNew = await signFrame(store, sampleAt(ts), { nonce: "nonce-new-2" });
    expect(signedNew.keyId).toBe("k2");

    // Both still verify because the historical key is retained.
    expect((await verifyFrame(store, signedOld)).ok).toBe(true);
    expect((await verifyFrame(store, signedNew)).ok).toBe(true);
  });
});

describe("ReplayCache eviction", () => {
  it("evicts oldest beyond cap", () => {
    const cache = new ReplayCache({ capPerVehicle: 4 });
    const now = Date.now();
    for (let i = 0; i < 4; i++) cache.remember("v", `n${i}`, now);
    expect(cache.size("v")).toBe(4);
    cache.remember("v", "n4", now);
    expect(cache.size("v")).toBe(4);
    expect(cache.seen("v", "n0", now, 5000)).toBe(false);
    expect(cache.seen("v", "n4", now, 5000)).toBe(true);
  });

  it("clears entries past the window on lookup", () => {
    const cache = new ReplayCache();
    const t0 = 1_000_000;
    cache.remember("v", "n", t0);
    expect(cache.seen("v", "n", t0 + 10_000, 5000)).toBe(false);
  });
});
