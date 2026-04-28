import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  regionMiddleware,
  REGION_DEFAULT_CONFIG,
  type RegionAppEnv,
} from "../middleware/region.js";
import { requestId } from "../middleware/security.js";
import { makeRegionRouter } from "../adapters/region-router.js";
import { buildRegionRouter, MemoryPendingBookings } from "./region.js";

function buildApp(opts?: { pending?: MemoryPendingBookings; runtime?: "asia-south1" | "us-central1" }) {
  const app = new Hono<RegionAppEnv>();
  app.use("*", requestId());
  app.use(
    "*",
    regionMiddleware({ ...REGION_DEFAULT_CONFIG, runtime: opts?.runtime ?? "us-central1" }),
  );
  const pending = opts?.pending ?? new MemoryPendingBookings();
  const router = makeRegionRouter({
    "asia-south1": "https://api-in.dmj.one",
    "us-central1": "https://api-us.dmj.one",
  });
  app.route(
    "/v1/region",
    buildRegionRouter({ router, pending }),
  );
  return { app, pending };
}

describe("GET /v1/region/me", () => {
  it("returns detected + pinned + allowedSwitch=true when no pending bookings", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/region/me", {
      headers: { "x-appengine-country": "IN" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.detected).toBe("asia-south1");
    expect(body.data.pinned).toBe("asia-south1");
    expect(body.data.allowedSwitch).toBe(true);
    expect(body.data.country).toBe("IN");
    expect(body.data.knownRegions).toContain("asia-south1");
    expect(body.data.knownRegions).toContain("us-central1");
  });

  it("flags allowedSwitch=false when the owner has pending bookings", async () => {
    const pending = new MemoryPendingBookings();
    pending.setPending("alice", 2);
    const { app } = buildApp({ pending });
    const res = await app.request("/v1/region/me", {
      headers: { "x-vsbs-owner": "alice" },
    });
    const body = await res.json();
    expect(body.data.allowedSwitch).toBe(false);
    expect(body.data.pendingBookings).toBe(2);
  });
});

describe("POST /v1/region/switch", () => {
  it("switches the pinned region, sets the cookie, returns the new base URL", async () => {
    const { app } = buildApp({ runtime: "us-central1" });
    const res = await app.request("/v1/region/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "asia-south1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changed).toBe(true);
    expect(body.data.pinned).toBe("asia-south1");
    expect(body.data.apiBaseUrl).toBe("https://api-in.dmj.one");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/vsbs-region=asia-south1/);
  });

  it("returns 409 when there are pending bookings", async () => {
    const pending = new MemoryPendingBookings();
    pending.setPending("alice", 1);
    const { app } = buildApp({ pending });
    const res = await app.request("/v1/region/switch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vsbs-owner": "alice" },
      body: JSON.stringify({ to: "asia-south1" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("REGION_SWITCH_BLOCKED");
    expect(body.error.details.pending).toBe(1);
  });

  it("rejects an invalid target region with 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/v1/region/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "eu-west1" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("treats a same-region switch as a no-op but still refreshes the cookie", async () => {
    const { app } = buildApp({ runtime: "us-central1" });
    const res = await app.request("/v1/region/switch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-appengine-country": "US",
      },
      body: JSON.stringify({ to: "us-central1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changed).toBe(false);
    expect(body.data.pinned).toBe("us-central1");
    expect(res.headers.get("set-cookie") ?? "").toMatch(/vsbs-region=us-central1/);
  });
});
