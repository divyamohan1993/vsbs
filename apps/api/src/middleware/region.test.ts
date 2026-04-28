import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  regionMiddleware,
  decideRegion,
  REGION_DEFAULT_CONFIG,
  type RegionAppEnv,
} from "./region.js";
import { requestId } from "./security.js";

function makeApp(opts?: Partial<{ runtime: "asia-south1" | "us-central1"; euBlock: boolean }>) {
  const app = new Hono<RegionAppEnv>();
  app.use("*", requestId());
  app.use(
    "*",
    regionMiddleware({
      ...REGION_DEFAULT_CONFIG,
      runtime: opts?.runtime ?? "us-central1",
      euBlock: opts?.euBlock ?? false,
    }),
  );
  app.get("/where", (c) => c.json({ region: c.get("region"), decision: c.get("regionDecision") }));
  return app;
}

describe("decideRegion", () => {
  it("honours an explicit valid x-vsbs-region", () => {
    const d = decideRegion({ headerRegion: "asia-south1", fallback: "us-central1" });
    expect(d.pinned).toBe("asia-south1");
    expect(d.reason).toBe("explicit-header");
  });

  it("uses the cookie when no header is present", () => {
    const d = decideRegion({ cookieRegion: "asia-south1", fallback: "us-central1" });
    expect(d.pinned).toBe("asia-south1");
    expect(d.reason).toBe("cookie");
  });

  it("uses the country mapping when header + cookie absent", () => {
    const d = decideRegion({ country: "IN", fallback: "us-central1" });
    expect(d.pinned).toBe("asia-south1");
    expect(d.reason).toBe("geo");
    expect(d.country).toBe("IN");
  });

  it("falls back to the runtime region for unknown countries", () => {
    const d = decideRegion({ country: "JP", fallback: "us-central1" });
    expect(d.pinned).toBe("us-central1");
    expect(d.reason).toBe("fallback");
  });

  it("falls back even with no signals at all", () => {
    const d = decideRegion({ fallback: "asia-south1" });
    expect(d.pinned).toBe("asia-south1");
    expect(d.reason).toBe("fallback");
  });
});

describe("regionMiddleware", () => {
  it("respects an explicit x-vsbs-region header", async () => {
    const app = makeApp({ runtime: "us-central1" });
    const res = await app.request("/where", { headers: { "x-vsbs-region": "asia-south1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.region).toBe("asia-south1");
    expect(body.decision.reason).toBe("explicit-header");
    expect(res.headers.get("x-vsbs-region")).toBe("asia-south1");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/vsbs-region=asia-south1/);
  });

  it("rejects a malformed header silently and falls back to runtime", async () => {
    const app = makeApp({ runtime: "us-central1" });
    const res = await app.request("/where", { headers: { "x-vsbs-region": "eu-west1" } });
    const body = await res.json();
    expect(body.region).toBe("us-central1");
    expect(body.decision.reason).toBe("fallback");
  });

  it("uses x-appengine-country to pick India for an Indian user", async () => {
    const app = makeApp({ runtime: "us-central1" });
    const res = await app.request("/where", { headers: { "x-appengine-country": "IN" } });
    const body = await res.json();
    expect(body.region).toBe("asia-south1");
    expect(body.decision.country).toBe("IN");
  });

  it("uses cf-ipcountry as a fallback when GCP geo headers are missing", async () => {
    const app = makeApp({ runtime: "us-central1" });
    const res = await app.request("/where", { headers: { "cf-ipcountry": "in" } });
    const body = await res.json();
    expect(body.region).toBe("asia-south1");
    expect(body.decision.country).toBe("IN");
  });

  it("returns 451 for EU traffic when euBlock is on", async () => {
    const app = makeApp({ runtime: "us-central1", euBlock: true });
    const res = await app.request("/where", { headers: { "x-appengine-country": "DE" } });
    expect(res.status).toBe(451);
    const body = await res.json();
    expect(body.error.code).toBe("REGION_UNAVAILABLE");
  });

  it("does not 451 EU traffic when an explicit region header is present", async () => {
    const app = makeApp({ runtime: "us-central1", euBlock: true });
    const res = await app.request("/where", {
      headers: { "x-appengine-country": "DE", "x-vsbs-region": "us-central1" },
    });
    expect(res.status).toBe(200);
  });

  it("emits vary headers so downstream caches don't cross-contaminate", async () => {
    const app = makeApp({ runtime: "us-central1" });
    const res = await app.request("/where", { headers: { "x-appengine-country": "IN" } });
    const vary = res.headers.get("vary") ?? "";
    expect(vary).toContain("x-vsbs-region");
    expect(vary).toContain("cookie");
  });

  it("honours a sticky cookie even when no geo header is present", async () => {
    const app = makeApp({ runtime: "us-central1" });
    const res = await app.request("/where", {
      headers: { cookie: "vsbs-region=asia-south1" },
    });
    const body = await res.json();
    expect(body.region).toBe("asia-south1");
    expect(body.decision.reason).toBe("cookie");
  });
});
