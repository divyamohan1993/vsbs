import { describe, it, expect } from "vitest";
import {
  IdentityPlatformSimDriver,
  IdentityPlatformLiveDriver,
  deriveTenantId,
  type FirebaseTenantClient,
} from "./identity-platform.js";

describe("deriveTenantId", () => {
  it("is deterministic for the same secret + region", async () => {
    const a = await deriveTenantId("secret-A", "asia-south1");
    const b = await deriveTenantId("secret-A", "asia-south1");
    expect(a).toBe(b);
  });

  it("differs across regions", async () => {
    const inT = await deriveTenantId("secret-A", "asia-south1");
    const usT = await deriveTenantId("secret-A", "us-central1");
    expect(inT).not.toBe(usT);
    expect(inT.startsWith("vsbs-asiasouth1-")).toBe(true);
    expect(usT.startsWith("vsbs-uscentral1-")).toBe(true);
  });

  it("differs across secrets for the same region", async () => {
    const x = await deriveTenantId("secret-A", "asia-south1");
    const y = await deriveTenantId("secret-B", "asia-south1");
    expect(x).not.toBe(y);
  });
});

describe("IdentityPlatformSimDriver", () => {
  it("creates one tenant per region (idempotent)", async () => {
    const drv = new IdentityPlatformSimDriver({ secret: "S" });
    const a = await drv.getOrCreateTenant("asia-south1");
    const b = await drv.getOrCreateTenant("asia-south1");
    expect(a).toBe(b);
    const us = await drv.getOrCreateTenant("us-central1");
    expect(us).not.toBe(a);
  });

  it("mints + verifies a token under the right tenant", async () => {
    const drv = new IdentityPlatformSimDriver({ secret: "S" });
    const tenant = await drv.getOrCreateTenant("asia-south1");
    const tok = await drv.signInWithCustomToken("user-42", tenant);
    const v = await drv.verifyToken(tok, tenant);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.uid).toBe("user-42");
      expect(v.region).toBe("asia-south1");
      expect(v.tenantId).toBe(tenant);
    }
  });

  it("rejects a token presented at the wrong tenant", async () => {
    const drv = new IdentityPlatformSimDriver({ secret: "S" });
    const inT = await drv.getOrCreateTenant("asia-south1");
    const usT = await drv.getOrCreateTenant("us-central1");
    const tok = await drv.signInWithCustomToken("user-x", inT);
    const v = await drv.verifyToken(tok, usT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe("WRONG_TENANT");
  });

  it("rejects an unknown token", async () => {
    const drv = new IdentityPlatformSimDriver({ secret: "S" });
    const tenant = await drv.getOrCreateTenant("asia-south1");
    const v = await drv.verifyToken("sim.bogus.uid.0.deadbeef", tenant);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe("BAD_TOKEN");
  });

  it("expires tokens past the configured TTL", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const drv = new IdentityPlatformSimDriver({
      secret: "S",
      tokenTtlSeconds: 1,
      now: () => now,
    });
    const tenant = await drv.getOrCreateTenant("asia-south1");
    const tok = await drv.signInWithCustomToken("u", tenant);
    now = new Date(now.getTime() + 5_000);
    const v = await drv.verifyToken(tok, tenant);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe("EXPIRED");
  });
});

describe("IdentityPlatformLiveDriver", () => {
  it("creates a tenant via the SDK once and caches the result", async () => {
    const tenantsSeen: Array<{ displayName: string }> = [];
    const stub: FirebaseTenantClient = {
      async listTenants() {
        return [];
      },
      async createTenant(req) {
        tenantsSeen.push(req);
        return { tenantId: "vsbs-asia-south1" };
      },
      async verifyIdToken() {
        throw new Error("not used here");
      },
      async createCustomToken() {
        throw new Error("not used here");
      },
    };
    const drv = new IdentityPlatformLiveDriver(stub);
    const a = await drv.getOrCreateTenant("asia-south1");
    const b = await drv.getOrCreateTenant("asia-south1");
    expect(a).toBe(b);
    expect(tenantsSeen).toEqual([{ displayName: "vsbs-asia-south1" }]);
  });

  it("verifies a token whose firebase.tenant matches", async () => {
    const stub: FirebaseTenantClient = {
      async listTenants() {
        return [{ tenantId: "vsbs-asia-south1", displayName: "vsbs-asia-south1" }];
      },
      async createTenant() {
        throw new Error("should not be called");
      },
      async verifyIdToken(_token) {
        return {
          uid: "u",
          firebase: { tenant: "vsbs-asia-south1" },
          exp: Math.floor(Date.now() / 1000) + 60,
        };
      },
      async createCustomToken() {
        throw new Error("not used");
      },
    };
    const drv = new IdentityPlatformLiveDriver(stub);
    const tenant = await drv.getOrCreateTenant("asia-south1");
    const v = await drv.verifyToken("eyJhbGciOiJSUzI1NiJ9.signed", tenant);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.region).toBe("asia-south1");
  });

  it("rejects a token issued for a different tenant", async () => {
    const stub: FirebaseTenantClient = {
      async listTenants() {
        return [{ tenantId: "vsbs-asia-south1", displayName: "vsbs-asia-south1" }];
      },
      async createTenant() {
        throw new Error("should not be called");
      },
      async verifyIdToken() {
        return {
          uid: "u",
          firebase: { tenant: "vsbs-us-central1" },
          exp: Math.floor(Date.now() / 1000) + 60,
        };
      },
      async createCustomToken() {
        throw new Error("not used");
      },
    };
    const drv = new IdentityPlatformLiveDriver(stub);
    const tenant = await drv.getOrCreateTenant("asia-south1");
    const v = await drv.verifyToken("any.signed.token", tenant);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe("WRONG_TENANT");
  });
});
