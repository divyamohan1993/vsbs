// =============================================================================
// /healthz, /readyz, /healthz/details - telemetry-aware health surface.
//
// /healthz         -> pure liveness ({ ok: true }). Used by Cloud Run for
//                     the liveness probe; never blocks on dependencies.
// /readyz          -> readiness aggregated from the HealthChecker registry.
//                     Returns 503 if any check is unhealthy.
// /healthz/details -> per-check breakdown. Admin-only.
// =============================================================================

import { Hono } from "hono";
import type { HealthChecker } from "@vsbs/telemetry";
import { adminOnly, type AdminAppEnv } from "../middleware/admin.js";
import { errBody, type AppEnv } from "../middleware/security.js";

export interface HealthRouterDeps {
  checker: HealthChecker;
  serviceName: string;
  region: string;
  version: string;
  /** Surface-level mode summary baked into /readyz. */
  modes: Record<string, string | boolean>;
  appEnv: "development" | "test" | "production";
  adminAuthMode: "sim" | "live";
}

export function buildHealthRouter(deps: HealthRouterDeps) {
  const app = new Hono<AppEnv>();

  // Liveness - always cheap, never blocks on dependencies.
  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      service: deps.serviceName,
      region: deps.region,
      version: deps.version,
      ts: new Date().toISOString(),
    }),
  );

  // Readiness - aggregated dep status. 503 on unhealthy.
  app.get("/readyz", async (c) => {
    const report = await deps.checker.runAll();
    const status =
      report.status === "unhealthy"
        ? 503
        : report.status === "degraded"
          ? 200
          : 200;
    return c.json(
      {
        ok: report.status !== "unhealthy",
        status: report.status,
        region: deps.region,
        version: deps.version,
        ts: report.ts,
        modes: deps.modes,
        // Public summary only - names + statuses, no message bodies.
        checks: Object.fromEntries(
          Object.entries(report.checks).map(([name, r]) => [
            name,
            { status: r.status, latency_ms: r.latency_ms },
          ]),
        ),
      },
      status,
    );
  });

  // Per-check breakdown - admin-gated; surfaces messages and lastSuccess.
  const detailApp = new Hono<AdminAppEnv>();
  detailApp.use(
    "*",
    adminOnly({ mode: deps.adminAuthMode, appEnv: deps.appEnv }),
  );
  detailApp.get("/", async (c) => {
    const report = await deps.checker.runAll();
    return c.json({ data: report });
  });

  app.route("/healthz/details", detailApp);

  // Catch-all: unknown nested paths get a uniform error envelope.
  app.notFound((c) =>
    c.json(errBody("HEALTH_NOT_FOUND", "Health route not found", c), 404),
  );

  return app;
}
