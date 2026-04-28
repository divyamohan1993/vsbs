import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  regionMiddleware,
  REGION_DEFAULT_CONFIG,
  type RegionAppEnv,
} from "./region.js";
import { regionResidencyMiddleware } from "./region-residency.js";
import { makeRegionRouter } from "../adapters/region-router.js";
import { requestId } from "./security.js";

function makeApp(runtime: "asia-south1" | "us-central1") {
  const app = new Hono<RegionAppEnv>();
  app.use("*", requestId());
  app.use("*", regionMiddleware({ ...REGION_DEFAULT_CONFIG, runtime }));
  app.use(
    "*",
    regionResidencyMiddleware({
      runtime,
      router: makeRegionRouter({
        "asia-south1": "https://api-in.dmj.one",
        "us-central1": "https://api-us.dmj.one",
      }),
      passthroughPrefixes: ["/healthz", "/readyz"],
    }),
  );
  app.get("/v1/secret", (c) => c.json({ ok: true, runtime }));
  app.get("/healthz", (c) => c.json({ ok: true }));
  return app;
}

describe("regionResidencyMiddleware", () => {
  it("passes the request through when runtime matches the pinned region", async () => {
    const app = makeApp("asia-south1");
    const res = await app.request("/v1/secret", { headers: { "x-vsbs-region": "asia-south1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtime).toBe("asia-south1");
  });

  it("308-redirects to the correct regional FQDN on mismatch", async () => {
    const app = makeApp("us-central1");
    const res = await app.request("/v1/secret?x=1", {
      headers: { "x-vsbs-region": "asia-south1" },
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://api-in.dmj.one/v1/secret?x=1");
  });

  it("passes through health probes regardless of region", async () => {
    const app = makeApp("us-central1");
    const res = await app.request("/healthz", { headers: { "x-vsbs-region": "asia-south1" } });
    expect(res.status).toBe(200);
  });
});
