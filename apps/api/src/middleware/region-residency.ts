// =============================================================================
// Region residency enforcement.
//
// Once `regionMiddleware` has decided which region the user belongs to, this
// middleware asserts that the request landed on the *right* Cloud Run instance.
// If the user is pinned to asia-south1 but the runtime is us-central1, we
// 308-redirect them to the regional FQDN. This is what keeps DPDP residency
// honest end-to-end: India users' bookings can never accidentally land on a
// US Firestore database, even if a global LB rule misroutes them.
//
// The redirect target is constructed by `regionRouterAdapter` so tests can
// inject a stub.
// =============================================================================

import type { MiddlewareHandler } from "hono";
import { errBody } from "./security.js";
import type { RegionAppEnv, VsbsRegion } from "./region.js";
import type { RegionRouter } from "../adapters/region-router.js";

export interface RegionResidencyConfig {
  /** What region this Cloud Run instance is running in. */
  runtime: VsbsRegion;
  /** Adapter that knows the API/web FQDN for any region. */
  router: RegionRouter;
  /** Skip the residency assertion on these path prefixes (e.g. /healthz). */
  passthroughPrefixes: string[];
  /** Tier of redirect — 308 is correct for non-idempotent methods (POST, PUT). */
  redirectStatus?: 307 | 308;
}

export function regionResidencyMiddleware(cfg: RegionResidencyConfig): MiddlewareHandler<RegionAppEnv> {
  const passthrough = cfg.passthroughPrefixes;
  const status = cfg.redirectStatus ?? 308;
  return async (c, next) => {
    // Always allow health / readiness probes.
    const path = c.req.path;
    for (const prefix of passthrough) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        await next();
        return;
      }
    }

    const pinned = c.get("region");
    if (!pinned) {
      // regionMiddleware was not mounted; refuse rather than serve cross-region.
      return c.json(errBody("REGION_NOT_DECIDED", "Region middleware was not configured", c), 500);
    }

    if (pinned === cfg.runtime) {
      await next();
      return;
    }

    // Cross-region: 308 to the right base url + same path + query.
    const baseUrl = cfg.router.apiBaseUrl(pinned);
    if (!baseUrl) {
      // Single-region deployment: no peer URL configured. Treat the local
      // runtime as authoritative and pass through; this is the demo / dev
      // path. In production both region URLs are set so we never land here.
      if (cfg.router.knownRegions().length <= 1) {
        await next();
        return;
      }
      return c.json(
        errBody(
          "REGION_UNAVAILABLE",
          `No API base URL configured for region ${pinned}`,
          c,
          { pinned, runtime: cfg.runtime },
        ),
        503,
      );
    }
    const url = new URL(c.req.url);
    const target = `${baseUrl.replace(/\/$/, "")}${url.pathname}${url.search}`;
    return c.redirect(target, status);
  };
}
