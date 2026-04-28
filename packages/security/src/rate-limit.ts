// =============================================================================
// Sliding-window rate limiter — per-IP + per-user, per-route.
//
// References:
//   docs/research/security.md §5 (Cloud Armor + app-layer Valkey-backed)
//   docs/research/security.md §4 LLM10 (unbounded consumption)
//
// Algorithm: classic sliding-window log restricted to fixed-size counters
// at sub-second granularity. We keep two counters per key (current window
// + previous window) and weight the previous by `(1 - elapsed/window)`. The
// effective count is `cur + prev * weight`. This is the "approximate
// sliding window" used by Cloudflare and AWS API Gateway and is bounded
// memory per key. O(1) per request.
//
// Pluggable store with two real implementations:
//   MemoryStore — in-process Map; used for tests and per-pod limits.
//   ValkeyStore — adapter pattern; calls into a thin `ValkeyClient`
//                 interface so production can swap in Cloud Memorystore
//                 for Valkey without touching this module.
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

export const WindowSchema = z.object({
  startMs: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});
export type Window = z.infer<typeof WindowSchema>;

export interface RateLimitState {
  cur: Window;
  prev: Window;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, now: number): Promise<{ effective: number; resetMs: number }>;
}

// -----------------------------------------------------------------------------
// MemoryStore
// -----------------------------------------------------------------------------

export class MemoryStore implements RateLimitStore {
  readonly #m = new Map<string, RateLimitState>();
  async hit(key: string, windowMs: number, now: number): Promise<{ effective: number; resetMs: number }> {
    const cur = this.#m.get(key);
    if (!cur) {
      const fresh: RateLimitState = {
        cur: { startMs: now, count: 1 },
        prev: { startMs: now - windowMs, count: 0 },
      };
      this.#m.set(key, fresh);
      return { effective: 1, resetMs: now + windowMs };
    }
    if (now - cur.cur.startMs >= windowMs) {
      // Slide the window: previous becomes the old current, new current starts fresh.
      const slid: RateLimitState = {
        cur: { startMs: now, count: 1 },
        prev: cur.cur,
      };
      // If we slid by more than one window, drop the previous to zero.
      if (now - cur.cur.startMs >= 2 * windowMs) {
        slid.prev = { startMs: now - windowMs, count: 0 };
      }
      this.#m.set(key, slid);
      const elapsed = now - slid.cur.startMs;
      const weight = Math.max(0, Math.min(1, 1 - elapsed / windowMs));
      const eff = slid.cur.count + slid.prev.count * weight;
      return { effective: eff, resetMs: slid.cur.startMs + windowMs };
    }
    cur.cur.count += 1;
    const elapsed = now - cur.cur.startMs;
    const weight = Math.max(0, Math.min(1, 1 - elapsed / windowMs));
    const eff = cur.cur.count + cur.prev.count * weight;
    return { effective: eff, resetMs: cur.cur.startMs + windowMs };
  }
}

// -----------------------------------------------------------------------------
// ValkeyStore — adapter
// -----------------------------------------------------------------------------

export interface ValkeyClient {
  /** Atomic increment; returns post-increment value and TTL ms. */
  incrWithTtl(key: string, ttlMs: number): Promise<{ count: number; ttlMs: number }>;
  /** Get a counter value or null if absent. */
  get(key: string): Promise<{ count: number; ttlMs: number } | null>;
}

export class ValkeyStore implements RateLimitStore {
  readonly #client: ValkeyClient;
  constructor(client: ValkeyClient) {
    this.#client = client;
  }
  async hit(key: string, windowMs: number, now: number): Promise<{ effective: number; resetMs: number }> {
    const slot = Math.floor(now / windowMs);
    const curKey = `${key}:${slot}`;
    const prevKey = `${key}:${slot - 1}`;
    const cur = await this.#client.incrWithTtl(curKey, windowMs * 2);
    const prev = await this.#client.get(prevKey);
    const elapsed = now - slot * windowMs;
    const weight = Math.max(0, Math.min(1, 1 - elapsed / windowMs));
    const prevCount = prev?.count ?? 0;
    const effective = cur.count + prevCount * weight;
    const resetMs = (slot + 1) * windowMs;
    return { effective, resetMs };
  }
}

// -----------------------------------------------------------------------------
// Per-route configuration
// -----------------------------------------------------------------------------

export const RouteRateLimitSchema = z.object({
  windowMs: z.number().int().positive(),
  max: z.number().int().positive(),
  /** Identifier strategy: ip | user | ip+user | custom. */
  by: z.enum(["ip", "user", "ip+user"]),
});
export type RouteRateLimit = z.infer<typeof RouteRateLimitSchema>;

export interface RateLimiterOptions {
  store?: RateLimitStore;
  /** Default config when no per-route override matches. */
  default: RouteRateLimit;
  /** Per-route overrides keyed by exact route path or prefix `^/v1/foo/`. */
  perRoute?: Record<string, RouteRateLimit>;
  /**
   * Resolve the user identity for a context. Default reads the
   * `c.get("user")` payload set by upstream auth.
   */
  resolveUser?: (c: Context) => string | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  effective: number;
  max: number;
  resetMs: number;
  retryAfterSec?: number;
}

function clientIp(c: Context): string {
  const xf = c.req.header("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return c.req.header("x-real-ip") ?? "unknown";
}

function defaultUserResolver(c: Context): string | null {
  const u = (c as unknown as { get(name: string): unknown }).get("user");
  if (u && typeof u === "object" && "id" in u) {
    const id = (u as { id: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function pickRoute(path: string, perRoute: Record<string, RouteRateLimit> | undefined, fallback: RouteRateLimit): RouteRateLimit {
  if (!perRoute) return fallback;
  const exact = perRoute[path];
  if (exact) return exact;
  for (const [k, cfg] of Object.entries(perRoute)) {
    if (k.startsWith("^") && new RegExp(k).test(path)) return cfg;
  }
  return fallback;
}

function buildKey(by: RouteRateLimit["by"], ip: string, user: string | null, route: string): string {
  switch (by) {
    case "ip": return `rl:ip:${ip}:${route}`;
    case "user": return `rl:user:${user ?? "anon"}:${route}`;
    case "ip+user": return `rl:ipuser:${ip}|${user ?? "anon"}:${route}`;
  }
}

export interface RateLimiter {
  decide(c: Context): Promise<RateLimitDecision>;
  middleware(): MiddlewareHandler;
}

export function makeRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const store = opts.store ?? new MemoryStore();
  const resolveUser = opts.resolveUser ?? defaultUserResolver;
  return {
    async decide(c: Context): Promise<RateLimitDecision> {
      const path = c.req.path;
      const cfg = pickRoute(path, opts.perRoute, opts.default);
      const ip = clientIp(c);
      const user = resolveUser(c);
      const key = buildKey(cfg.by, ip, user, path);
      const now = Date.now();
      const { effective, resetMs } = await store.hit(key, cfg.windowMs, now);
      if (effective > cfg.max) {
        return {
          allowed: false,
          effective,
          max: cfg.max,
          resetMs,
          retryAfterSec: Math.max(1, Math.ceil((resetMs - now) / 1000)),
        };
      }
      return { allowed: true, effective, max: cfg.max, resetMs };
    },
    middleware(): MiddlewareHandler {
      const decideFn = async (c: Context): Promise<RateLimitDecision> => {
        const path = c.req.path;
        const cfg = pickRoute(path, opts.perRoute, opts.default);
        const ip = clientIp(c);
        const user = resolveUser(c);
        const key = buildKey(cfg.by, ip, user, path);
        const now = Date.now();
        const { effective, resetMs } = await store.hit(key, cfg.windowMs, now);
        if (effective > cfg.max) {
          return {
            allowed: false, effective, max: cfg.max, resetMs,
            retryAfterSec: Math.max(1, Math.ceil((resetMs - now) / 1000)),
          };
        }
        return { allowed: true, effective, max: cfg.max, resetMs };
      };
      return async (c: Context, next: () => Promise<void>) => {
        const decision = await decideFn(c);
        c.header("X-RateLimit-Limit", String(decision.max));
        c.header("X-RateLimit-Remaining", String(Math.max(0, Math.floor(decision.max - decision.effective))));
        c.header("X-RateLimit-Reset", String(Math.ceil((decision.resetMs - Date.now()) / 1000)));
        if (!decision.allowed) {
          c.header("Retry-After", String(decision.retryAfterSec ?? 1));
          return c.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429);
        }
        await next();
      };
    },
  };
}
