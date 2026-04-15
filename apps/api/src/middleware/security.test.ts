import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  redactPath,
  bodySizeLimit,
  rateLimit,
  requestId,
  type AppEnv,
  type RateLimitStore,
} from "./security.js";

describe("redactPath", () => {
  it("strips phone numbers", () => {
    expect(redactPath("/users/+919876543210/profile")).toContain("[redacted-phone]");
  });

  it("strips emails", () => {
    expect(redactPath("/users/alice@example.com")).toContain("[redacted-email]");
  });

  it("strips VINs", () => {
    expect(redactPath("/vehicles/1HGCM82633A004352")).toContain("[redacted-vin]");
  });

  it("leaves safe paths untouched", () => {
    expect(redactPath("/bookings/list")).toBe("/bookings/list");
  });
});

describe("bodySizeLimit", () => {
  it("rejects bodies above the max with 413", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    app.use("*", bodySizeLimit(100));
    app.post("/echo", (c) => c.json({ ok: true }));

    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-length": "500", "content-type": "application/json" },
      body: JSON.stringify({ x: "y" }),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("BODY_TOO_LARGE");
  });

  it("allows bodies at or below the max", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    app.use("*", bodySizeLimit(10_000));
    app.post("/echo", (c) => c.json({ ok: true }));
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "content-length": "10", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
});

describe("rateLimit (InProcessRateStore via default)", () => {
  it("increments within the window, responds 429 past max", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    app.use("*", rateLimit({ windowMs: 60_000, max: 2 }));
    app.get("/ping", (c) => c.text("ok"));

    const r1 = await app.request("/ping", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const r2 = await app.request("/ping", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const r3 = await app.request("/ping", { headers: { "x-forwarded-for": "1.2.3.4" } });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get("retry-after")).toBeTruthy();
    expect(r1.headers.get("ratelimit-remaining")).toBe("1");
    expect(r2.headers.get("ratelimit-remaining")).toBe("0");
  });

  it("a custom store is honoured", async () => {
    const calls: string[] = [];
    const store: RateLimitStore = {
      async incr(key: string) {
        calls.push(key);
        return { count: 1, resetMs: Date.now() + 60_000 };
      },
    };
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    app.use("*", rateLimit({ windowMs: 60_000, max: 5, store }));
    app.get("/ping", (c) => c.text("ok"));
    const res = await app.request("/ping", { headers: { "x-forwarded-for": "5.6.7.8" } });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/^rl:5\.6\.7\.8:/);
  });

  it("resets past the window (fresh bucket after expiry)", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    // A 1-ms window effectively resets on every request.
    app.use("*", rateLimit({ windowMs: 1, max: 1 }));
    app.get("/ping", (c) => c.text("ok"));

    const r1 = await app.request("/ping", { headers: { "x-forwarded-for": "9.9.9.9" } });
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await app.request("/ping", { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

describe("requestId", () => {
  it("echoes a valid incoming x-request-id", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    app.get("/ping", (c) => c.text(c.get("requestId")));
    const res = await app.request("/ping", { headers: { "x-request-id": "abcd1234efgh" } });
    expect(res.headers.get("x-request-id")).toBe("abcd1234efgh");
  });

  it("generates a uuid when none supplied", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", requestId());
    app.get("/ping", (c) => c.text(c.get("requestId")));
    const res = await app.request("/ping");
    const id = res.headers.get("x-request-id") ?? "";
    expect(id).toMatch(/[0-9a-f-]{36}/i);
  });
});
