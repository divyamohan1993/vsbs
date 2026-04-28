import { describe, it, expect } from "vitest";
import {
  makeSimSecretRotator,
  httpAuthSecret,
  webhookSigningSecret,
  databasePassword,
  registerBuiltins,
  SAFE_PASSWORD_CHARS,
} from "../src/secrets.js";

describe("secret rotator", () => {
  it("registers and rotates the three built-in secrets", () => {
    const r = makeSimSecretRotator();
    registerBuiltins(r);
    const a = r.rotateSecret("http_auth");
    const b = r.rotateSecret("webhook_sign");
    const c = r.rotateSecret("db_password");
    expect(a.value.length).toBeGreaterThanOrEqual(40);
    expect(b.value.length).toBeGreaterThanOrEqual(40);
    expect(c.value.length).toBe(24);
    for (const ch of c.value) {
      expect(SAFE_PASSWORD_CHARS.includes(ch)).toBe(true);
    }
  });

  it("keeps a versioned ring at the configured size (default 3)", () => {
    const r = makeSimSecretRotator();
    r.register("k", () => "v");
    for (let i = 0; i < 5; i++) r.rotateSecret("k");
    const versions = r.versions("k");
    expect(versions.length).toBe(3);
    expect(versions[0]!.version).toBeGreaterThan(versions[2]!.version);
  });

  it("disable removes a specific version from current()", () => {
    const r = makeSimSecretRotator();
    r.register("k", () => `seed-${Math.random()}`);
    const v1 = r.rotateSecret("k");
    expect(r.current("k")?.version).toBe(v1.version);
    r.disable("k", v1.version);
    expect(r.current("k")).toBeNull();
  });

  it("due() reports secrets older than rotationDays", () => {
    const r = makeSimSecretRotator({ rotationDays: 0 });
    r.register("k", httpAuthSecret);
    r.rotateSecret("k");
    const future = new Date(Date.now() + 60_000);
    expect(r.due(future)).toContain("k");
  });

  it("sweep rotates all due secrets at once", () => {
    const r = makeSimSecretRotator({ rotationDays: 0 });
    r.register("a", () => "1");
    r.register("b", () => "2");
    r.rotateSecret("a"); r.rotateSecret("b");
    const future = new Date(Date.now() + 60_000);
    const swept = r.sweep(future).sort();
    expect(swept).toEqual(["a", "b"]);
  });

  it("databasePassword has zero modulo bias", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const p = databasePassword(24);
      for (const ch of p) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(40);
  });

  it("httpAuthSecret + webhookSigningSecret produce >= 256 bits", () => {
    const a = httpAuthSecret();
    const b = webhookSigningSecret();
    // base64 of 32 bytes is 43 chars (no padding)
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(b.length).toBeGreaterThanOrEqual(43);
  });
});
