import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cloudArmor } from "./cloud-armor.js";
import { requestId, type AppEnv } from "./security.js";

function buildApp(opts?: { requireHeader?: boolean }) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.use("*", cloudArmor(opts));
  app.get("/p", (c) => c.text("ok"));
  return app;
}

describe("cloudArmor middleware", () => {
  it("allows traffic when verdict is allow", async () => {
    const app = buildApp();
    const r = await app.request("/p", { headers: { "x-cloud-armor-action": "allow" } });
    expect(r.status).toBe(200);
  });

  it("blocks with 403 when verdict is block", async () => {
    const app = buildApp();
    const r = await app.request("/p", {
      headers: { "x-cloud-armor-action": "block", "x-cloud-armor-rule": "owasp-crs-942" },
    });
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe("EDGE_BLOCKED");
  });

  it("returns 401 with EDGE_CHALLENGE_REQUIRED on challenge", async () => {
    const app = buildApp();
    const r = await app.request("/p", { headers: { "x-cloud-armor-action": "challenge" } });
    expect(r.status).toBe(401);
  });

  it("stamps x-edge-throttle on throttle but lets through", async () => {
    const app = buildApp();
    const r = await app.request("/p", { headers: { "x-cloud-armor-action": "throttle" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-edge-throttle")).toBe("1");
  });

  it("rejects malformed verdict header with 400", async () => {
    const app = buildApp();
    const r = await app.request("/p", { headers: { "x-cloud-armor-action": "wat" } });
    expect(r.status).toBe(400);
  });

  it("fails closed when requireHeader=true and header is missing", async () => {
    const app = buildApp({ requireHeader: true });
    const r = await app.request("/p");
    expect(r.status).toBe(403);
  });

  it("default mode lets header-less traffic through", async () => {
    const app = buildApp();
    const r = await app.request("/p");
    expect(r.status).toBe(200);
  });
});
