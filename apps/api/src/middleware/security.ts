// =============================================================================
// Defense-in-depth middleware layer for the VSBS API.
//
// Layers (outer → inner):
//   1. requestId            — every request gets a traceable uuid
//   2. structuredLogger     — JSON log per request, PII-redacted path
//   3. bodySizeLimit        — reject anything larger than the configured cap
//   4. rateLimit            — per-IP sliding window, Valkey-compatible shape
//   5. errorEnvelope        — uniform `{error:{code,message,requestId}}` on
//                             every failure, including Zod validation errors
//
// These are not decorative. Each one closes a known attack / noise class
// documented in docs/research/security.md §6-8.
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";
import type { Logger } from "../log.js";

/** The typed variables we attach to every request context. */
export interface AppVariables {
  requestId: string;
}
export type AppEnv = { Variables: AppVariables };

export interface SecurityMiddlewareOptions {
  log: Logger;
  maxBodyBytes: number;
  rateLimit: { windowMs: number; max: number };
}

// -----------------------------------------------------------------------------
// Request id
// -----------------------------------------------------------------------------
export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const inbound = c.req.header("x-request-id");
  const id = inbound && /^[a-zA-Z0-9_-]{8,80}$/.test(inbound) ? inbound : crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

// -----------------------------------------------------------------------------
// Structured request logger — one line per request, PII-safe.
// -----------------------------------------------------------------------------
export const structuredLogger = (log: Logger): MiddlewareHandler<AppEnv> => async (c, next) => {
  const started = Date.now();
  const rid = c.get("requestId");
  await next();
  const durationMs = Date.now() - started;
  const status = c.res.status;
  log.info("http", {
    rid,
    method: c.req.method,
    path: redactPath(c.req.path),
    status,
    durationMs,
    ua: truncate(c.req.header("user-agent") ?? "", 120),
  });
};

/** Strips obvious PII (phone numbers, emails, VINs) from URL paths. */
export function redactPath(path: string): string {
  return path
    .replace(/\/\+?\d[\d\s-]{6,}/g, "/[redacted-phone]")
    .replace(/\/[\w.+-]+@[\w.-]+/g, "/[redacted-email]")
    .replace(/\/[A-HJ-NPR-Z0-9]{17}\b/g, "/[redacted-vin]");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

// -----------------------------------------------------------------------------
// Body size limit
// -----------------------------------------------------------------------------
export const bodySizeLimit = (maxBytes: number): MiddlewareHandler<AppEnv> => async (c, next) => {
  const len = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(len) && len > maxBytes) {
    return c.json(
      errBody("BODY_TOO_LARGE", `Body exceeds ${maxBytes} bytes`, c),
      413,
    );
  }
  await next();
};

// -----------------------------------------------------------------------------
// Sliding-window rate limit with an in-process store.
// Production swaps the store for Valkey — same interface.
// -----------------------------------------------------------------------------
export interface RateLimitStore {
  incr(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

class InProcessRateStore implements RateLimitStore {
  readonly #buckets = new Map<string, { count: number; resetMs: number }>();
  async incr(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    const now = Date.now();
    const cur = this.#buckets.get(key);
    if (!cur || cur.resetMs <= now) {
      const fresh = { count: 1, resetMs: now + windowMs };
      this.#buckets.set(key, fresh);
      return fresh;
    }
    cur.count += 1;
    return cur;
  }
}

export const rateLimit =
  (opts: { windowMs: number; max: number; store?: RateLimitStore }): MiddlewareHandler<AppEnv> => {
    const store = opts.store ?? new InProcessRateStore();
    return async (c, next) => {
      const ip = clientIp(c);
      const key = `rl:${ip}:${route(c)}`;
      const state = await store.incr(key, opts.windowMs);
      const remaining = Math.max(0, opts.max - state.count);
      c.header("ratelimit-limit", String(opts.max));
      c.header("ratelimit-remaining", String(remaining));
      c.header("ratelimit-reset", String(Math.ceil((state.resetMs - Date.now()) / 1000)));
      if (state.count > opts.max) {
        const retryAfterSec = Math.max(1, Math.ceil((state.resetMs - Date.now()) / 1000));
        c.header("retry-after", String(retryAfterSec));
        return c.json(errBody("RATE_LIMITED", "Too many requests", c), 429);
      }
      await next();
    };
  };

function clientIp(c: Context<AppEnv>): string {
  const xf = c.req.header("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() ?? "unknown";
  return c.req.header("x-real-ip") ?? "unknown";
}

function route(c: Context<AppEnv>): string {
  // Use the matched route template, not the full URL, so /users/123 and
  // /users/456 share a bucket.
  return (c as unknown as { routePath?: string }).routePath ?? c.req.path;
}

// -----------------------------------------------------------------------------
// Unified error envelope — wraps every error into the same shape.
// -----------------------------------------------------------------------------
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export function errBody(code: string, message: string, c: Context, details?: unknown): ErrorBody {
  const rid = c.get("requestId");
  return {
    error: {
      code,
      message,
      ...(rid !== undefined ? { requestId: rid } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/** Hono validator hook used by zValidator to produce the unified envelope. */
export function zodErrorHook(result: { success: boolean; error?: { flatten?: () => unknown } }, c: Context<AppEnv>) {
  if (!result.success) {
    return c.json(
      errBody(
        "VALIDATION_FAILED",
        "Request payload is invalid",
        c,
        result.error?.flatten ? result.error.flatten() : undefined,
      ),
      400,
    );
  }
  return undefined;
}
