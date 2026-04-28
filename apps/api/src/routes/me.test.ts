import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { InMemoryConsentManager, buildSimErasureCoordinator } from "@vsbs/compliance";

import { buildMeRouter } from "./me.js";
import { requestId, type AppEnv } from "../middleware/security.js";

function buildApp() {
  const consent = new InMemoryConsentManager();
  const erasure = buildSimErasureCoordinator().coordinator;
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.route("/v1/me", buildMeRouter({ consent, erasure }));
  return { app, consent, erasure };
}

describe("/v1/me routes", () => {
  it("GET /consent returns the latest versions and current items", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/me/consent", {
      headers: { "x-vsbs-owner": "u1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { ownerId: string; latestVersions: Record<string, string>; items: unknown[] };
    };
    expect(body.data.ownerId).toBe("u1");
    expect(body.data.latestVersions["diagnostic-telemetry"]).toBe("1.0.0");
  });

  it("POST /consent/grant records a row and the next GET shows it granted", async () => {
    const { app } = buildApp();
    const post = await app.request("/v1/me/consent/grant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vsbs-owner": "u2" },
      body: JSON.stringify({
        purpose: "marketing",
        version: "1.0.0",
        source: "web",
      }),
    });
    expect(post.status).toBe(201);
    const get = await app.request("/v1/me/consent", {
      headers: { "x-vsbs-owner": "u2" },
    });
    const body = (await get.json()) as {
      data: { items: Array<{ purpose: string; granted: boolean }> };
    };
    const m = body.data.items.find((x) => x.purpose === "marketing");
    expect(m?.granted).toBe(true);
  });

  it("POST /consent/grant rejects a stale version with 409", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/me/consent/grant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vsbs-owner": "u3" },
      body: JSON.stringify({ purpose: "marketing", version: "0.9.0", source: "web" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONSENT_VERSION_MISMATCH");
  });

  it("POST /consent/revoke refuses non-revocable purposes", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/me/consent/revoke", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vsbs-owner": "u4" },
      body: JSON.stringify({ purpose: "service-fulfilment", reason: "no" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONSENT_NOT_REVOCABLE");
  });

  it("POST /erasure with Idempotency-Key returns the same tombstone twice", async () => {
    const { app } = buildApp();
    const headers = {
      "content-type": "application/json",
      "x-vsbs-owner": "u5",
      "idempotency-key": "test-key-1",
    };
    const a = await app.request("/v1/me/erasure", {
      method: "POST",
      headers,
      body: JSON.stringify({ scope: "all" }),
    });
    const b = await app.request("/v1/me/erasure", {
      method: "POST",
      headers,
      body: JSON.stringify({ scope: "all" }),
    });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const aj = (await a.json()) as { data: { tombstoneId: string } };
    const bj = (await b.json()) as { data: { tombstoneId: string } };
    expect(aj.data.tombstoneId).toBe(bj.data.tombstoneId);
  });

  it("GET /data-export bundles consents and erasure receipts", async () => {
    const { app } = buildApp();
    await app.request("/v1/me/consent/grant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vsbs-owner": "u6" },
      body: JSON.stringify({ purpose: "marketing", version: "1.0.0", source: "web" }),
    });
    const res = await app.request("/v1/me/data-export", {
      headers: { "x-vsbs-owner": "u6" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { ownerId: string; consents: Array<{ purpose: string }>; legalBasis: string };
    };
    expect(body.data.ownerId).toBe("u6");
    expect(body.data.consents.some((r) => r.purpose === "marketing")).toBe(true);
    expect(body.data.legalBasis).toContain("DPDP");
  });
});
