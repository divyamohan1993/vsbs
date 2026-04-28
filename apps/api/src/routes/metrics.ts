// =============================================================================
// /metrics - Prometheus exposition endpoint.
//
// In sim/dev profiles we render directly from the in-memory exporter held by
// @vsbs/telemetry's MetricsHandle. In production we still expose this route
// for local Cloud Run scrape lanes; the OTLP push exporter pushes the same
// data to Cloud Monitoring out of band.
// =============================================================================

import { Hono } from "hono";
import { z } from "zod";
import type { MetricsHandle } from "@vsbs/telemetry";
import { collectInMemoryProm } from "@vsbs/telemetry";
import type { AppEnv } from "../middleware/security.js";
import { zv } from "../middleware/zv.js";
import type { Logger } from "../log.js";

export interface MetricsRouterDeps {
  metrics: MetricsHandle;
  log?: Logger;
}

const WebVitalSchema = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().finite().nonnegative(),
  id: z.string().min(1).max(120),
  navigationType: z.enum(["navigate", "reload", "back_forward", "prerender"]),
  rating: z.enum(["good", "needs-improvement", "poor"]),
});

export function buildMetricsRouter(deps: MetricsRouterDeps) {
  const app = new Hono<AppEnv>();

  app.get("/metrics", async (c) => {
    if (deps.metrics.inMemoryExporter) {
      const { contentType, body } = await collectInMemoryProm(deps.metrics);
      return new Response(body, {
        status: 200,
        headers: { "content-type": contentType, "cache-control": "no-store" },
      });
    }
    // Live mode pushes via OTLP. We still answer with a tiny stub so health
    // probes scraping /metrics see a stable response.
    return new Response(
      "# VSBS metrics are pushed via OTLP; in-memory render is unavailable in this profile.\n",
      {
        status: 200,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  });

  // POST /metrics/web-vitals - accept Web Vitals samples from the
  // browser. We log structurally so the same record can be correlated
  // by request id with the originating page navigation. Sampling is
  // enforced client-side; we just validate and record here.
  app.post("/web-vitals", zv("json", WebVitalSchema), (c) => {
    const v = c.req.valid("json");
    deps.log?.info("web_vital", {
      name: v.name,
      value: Math.round(v.value * 100) / 100,
      rating: v.rating,
      navigationType: v.navigationType,
      id: v.id,
      requestId: c.get("requestId"),
    });
    return c.json({ ok: true }, 202);
  });

  return app;
}
