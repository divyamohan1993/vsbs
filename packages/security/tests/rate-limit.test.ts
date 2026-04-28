import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { makeRateLimiter, MemoryStore, ValkeyStore, type ValkeyClient } from "../src/rate-limit.js";

describe("sliding-window rate limiter (MemoryStore)", () => {
  it("allows up to max within window then 429s, with Retry-After", async () => {
    const limiter = makeRateLimiter({ default: { windowMs: 60_000, max: 2, by: "ip" } });
    const app = new Hono();
    app.use("*", limiter.middleware());
    app.get("/p", (c) => c.text("ok"));
    const r1 = await app.request("/p", { headers: { "x-forwarded-for": "1.1.1.1" } });
    const r2 = await app.request("/p", { headers: { "x-forwarded-for": "1.1.1.1" } });
    const r3 = await app.request("/p", { headers: { "x-forwarded-for": "1.1.1.1" } });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get("retry-after")).toBeTruthy();
    expect(r3.headers.get("x-ratelimit-limit")).toBe("2");
  });

  it("isolates buckets by IP", async () => {
    const limiter = makeRateLimiter({ default: { windowMs: 60_000, max: 1, by: "ip" } });
    const app = new Hono();
    app.use("*", limiter.middleware());
    app.get("/p", (c) => c.text("ok"));
    const a = await app.request("/p", { headers: { "x-forwarded-for": "1.1.1.1" } });
    const b = await app.request("/p", { headers: { "x-forwarded-for": "2.2.2.2" } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("per-route override applies", async () => {
    const limiter = makeRateLimiter({
      default: { windowMs: 60_000, max: 100, by: "ip" },
      perRoute: { "/heavy": { windowMs: 60_000, max: 1, by: "ip" } },
    });
    const app = new Hono();
    app.use("*", limiter.middleware());
    app.get("/heavy", (c) => c.text("ok"));
    const a = await app.request("/heavy", { headers: { "x-forwarded-for": "9.9.9.9" } });
    const b = await app.request("/heavy", { headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(429);
  });

  it("MemoryStore approximates a sliding window across boundaries", async () => {
    const store = new MemoryStore();
    const now = Date.now();
    const a = await store.hit("k", 1000, now);
    const b = await store.hit("k", 1000, now + 500);
    expect(a.effective).toBeCloseTo(1, 5);
    expect(b.effective).toBeGreaterThan(1.5);
  });

  it("ValkeyStore plugs in via the adapter interface", async () => {
    const m = new Map<string, { count: number; ttlMs: number }>();
    const client: ValkeyClient = {
      async incrWithTtl(key, ttl) {
        const cur = m.get(key);
        const next = { count: (cur?.count ?? 0) + 1, ttlMs: ttl };
        m.set(key, next);
        return next;
      },
      async get(key) {
        return m.get(key) ?? null;
      },
    };
    const store = new ValkeyStore(client);
    const a = await store.hit("k", 1000, 100);
    const b = await store.hit("k", 1000, 200);
    expect(a.effective).toBeCloseTo(1, 5);
    expect(b.effective).toBeGreaterThanOrEqual(2);
  });
});
