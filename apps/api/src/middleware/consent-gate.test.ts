import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { InMemoryConsentManager, DEFAULT_PURPOSE_REGISTRY, buildEvidenceHash } from "@vsbs/compliance";

import { requireConsent } from "./consent-gate.js";
import { requestId, type AppEnv } from "./security.js";

function buildApp(manager: InMemoryConsentManager) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.use("/protected/*", requireConsent("diagnostic-telemetry", { manager }));
  app.get("/protected/ok", (c) => c.json({ ok: true }));
  app.get("/open", (c) => c.json({ ok: true }));
  return app;
}

describe("requireConsent middleware", () => {
  it("returns 409 consent-required when the user has no record", async () => {
    const m = new InMemoryConsentManager();
    const app = buildApp(m);
    const res = await app.request("/protected/ok", {
      headers: { "x-vsbs-owner": "user-no-consent" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; purpose: string; currentVersion: string } };
    expect(body.error.code).toBe("consent-required");
    expect(body.error.purpose).toBe("diagnostic-telemetry");
    expect(body.error.currentVersion).toBe("1.0.0");
  });

  it("allows the request when consent is recorded with the latest version", async () => {
    const m = new InMemoryConsentManager();
    const ev = await buildEvidenceHash(
      DEFAULT_PURPOSE_REGISTRY["diagnostic-telemetry"],
      "en",
      "We collect telemetry to diagnose faults.",
    );
    await m.record({
      userId: "user-with-consent",
      purpose: "diagnostic-telemetry",
      version: "1.0.0",
      evidenceHash: ev,
      source: "web",
    });
    const app = buildApp(m);
    const res = await app.request("/protected/ok", {
      headers: { "x-vsbs-owner": "user-with-consent" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 409 consent-stale when consent version is older than the notice", async () => {
    const m = new InMemoryConsentManager();
    const ev = await buildEvidenceHash(
      DEFAULT_PURPOSE_REGISTRY["diagnostic-telemetry"],
      "en",
      "Older notice.",
    );
    await m.record({
      userId: "user-stale",
      purpose: "diagnostic-telemetry",
      version: "0.9.0",
      evidenceHash: ev,
      source: "web",
    });
    const app = buildApp(m);
    const res = await app.request("/protected/ok", {
      headers: { "x-vsbs-owner": "user-stale" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("consent-stale");
  });

  it("does not gate routes outside its scope", async () => {
    const m = new InMemoryConsentManager();
    const app = buildApp(m);
    const res = await app.request("/open");
    expect(res.status).toBe(200);
  });
});
