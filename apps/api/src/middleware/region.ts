// =============================================================================
// Region pinning middleware.
//
// Reads, in order of precedence:
//   1. `x-vsbs-region` header (explicit override; only honoured for known ids).
//   2. The Cloud-Armor / Cloud-Run injected geo headers:
//        x-appengine-country (Cloud Run) / x-cloud-armor-country
//   3. Cloudflare's `cf-ipcountry` header for environments fronted by CF.
//   4. The `vsbs-region` cookie (sticky preference).
//   5. Falls back to APP_REGION_RUNTIME from env.
//
// Then it pins the request to a concrete VSBS region per residency policy:
//   IN  -> asia-south1
//   US  -> us-central1
//   EU  -> us-central1 today; if EU_BLOCK is enabled, returns 451 instead.
//   *   -> us-central1 (default)
//
// The decision is exposed on the context as `c.get('region')`, the response
// gets a `vsbs-region` cookie, and a `vary: x-vsbs-region, cookie` header is
// emitted so caches don't cross-contaminate.
//
// Schema-validated via Zod; unknown header values are rejected silently
// (treated as absent). The middleware is O(1).
// =============================================================================

import type { Context, MiddlewareHandler } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";

import { errBody, type AppEnv } from "./security.js";

export const KNOWN_REGIONS = ["asia-south1", "us-central1"] as const;
export type VsbsRegion = (typeof KNOWN_REGIONS)[number];

export const RegionSchema = z.enum(KNOWN_REGIONS);

/** ISO 3166-1 alpha-2 country codes we explicitly map. Everything else is "default". */
const COUNTRY_TO_REGION: Record<string, VsbsRegion> = {
  IN: "asia-south1",
  BT: "asia-south1",
  NP: "asia-south1",
  LK: "asia-south1",
  BD: "asia-south1",
  US: "us-central1",
  CA: "us-central1",
  MX: "us-central1",
};

/** Countries flagged as EU/EEA — used for the optional 451 path. */
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "GB",
]);

export interface RegionDecision {
  detected: VsbsRegion;
  pinned: VsbsRegion;
  reason: "explicit-header" | "cookie" | "geo" | "fallback";
  country?: string;
}

export interface RegionConfig {
  /** What region this Cloud Run instance is running in. */
  runtime: VsbsRegion;
  /** When true, return 451 to EU-detected requests instead of pinning to us-central1. */
  euBlock: boolean;
  /** Cookie name. */
  cookieName: string;
  /** Cookie max age (seconds). */
  cookieMaxAgeSec: number;
}

/** Same shape as the base AppEnv; the base already declares region + regionDecision. */
export type RegionAppEnv = AppEnv;

export const COOKIE_DEFAULT = "vsbs-region";

function readCountry(c: Context): string | undefined {
  // All three providers use ISO 3166-1 alpha-2 codes; we accept either case.
  const candidates = [
    c.req.header("x-appengine-country"),
    c.req.header("x-cloud-armor-country"),
    c.req.header("cf-ipcountry"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  }
  return undefined;
}

function readCookieRegion(c: Context, name: string): VsbsRegion | undefined {
  const raw = c.req.header("cookie") ?? "";
  if (!raw) return undefined;
  // O(1)-ish: split by `;` once and find the named cookie.
  const parts = raw.split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) !== name) continue;
    const candidate = decodeURIComponent(part.slice(eq + 1));
    const parsed = RegionSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    return undefined;
  }
  return undefined;
}

function readHeaderRegion(c: Context): VsbsRegion | undefined {
  const raw = c.req.header("x-vsbs-region");
  if (!raw) return undefined;
  const parsed = RegionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Pure decision function, exported so tests can call it without spinning Hono. */
export function decideRegion(input: {
  headerRegion?: VsbsRegion | undefined;
  cookieRegion?: VsbsRegion | undefined;
  country?: string | undefined;
  fallback: VsbsRegion;
}): RegionDecision {
  if (input.headerRegion) {
    return {
      detected: input.headerRegion,
      pinned: input.headerRegion,
      reason: "explicit-header",
      ...(input.country !== undefined ? { country: input.country } : {}),
    };
  }
  if (input.cookieRegion) {
    return {
      detected: input.cookieRegion,
      pinned: input.cookieRegion,
      reason: "cookie",
      ...(input.country !== undefined ? { country: input.country } : {}),
    };
  }
  if (input.country) {
    const mapped = COUNTRY_TO_REGION[input.country];
    if (mapped) {
      return { detected: mapped, pinned: mapped, reason: "geo", country: input.country };
    }
  }
  return {
    detected: input.fallback,
    pinned: input.fallback,
    reason: "fallback",
    ...(input.country !== undefined ? { country: input.country } : {}),
  };
}

export function regionMiddleware(cfg: RegionConfig): MiddlewareHandler<RegionAppEnv> {
  return async (c, next) => {
    const headerRegion = readHeaderRegion(c);
    const cookieRegion = readCookieRegion(c, cfg.cookieName);
    const country = readCountry(c);

    if (cfg.euBlock && country && EU_COUNTRIES.has(country) && !headerRegion && !cookieRegion) {
      // We have no EU region; explicitly refuse rather than silently routing
      // EU traffic to us-central1.
      return c.json(
        errBody(
          "REGION_UNAVAILABLE",
          "Service is not available in your region under current data-residency policy.",
          c,
          { country, reason: "eu-block" },
        ),
        451,
      );
    }

    const decision = decideRegion({
      headerRegion,
      cookieRegion,
      country,
      fallback: cfg.runtime,
    });

    c.set("region", decision.pinned);
    c.set("regionDecision", decision);

    // Sticky preference. SameSite=Lax is sufficient because the cookie is
    // metadata, not auth. Secure is forced on; HttpOnly is *not* — the web
    // shell needs to read this for the SSR locale negotiator.
    setCookie(c, cfg.cookieName, decision.pinned, {
      maxAge: cfg.cookieMaxAgeSec,
      sameSite: "Lax",
      secure: true,
      httpOnly: false,
      path: "/",
    });

    c.header("x-vsbs-region", decision.pinned);
    const existingVary = c.res.headers.get("vary");
    c.header("vary", existingVary ? `${existingVary}, x-vsbs-region, cookie` : "x-vsbs-region, cookie");

    await next();
  };
}

export const REGION_DEFAULT_CONFIG: Omit<RegionConfig, "runtime"> = {
  euBlock: false,
  cookieName: COOKIE_DEFAULT,
  cookieMaxAgeSec: 60 * 60 * 24 * 30, // 30 days
};
