import { describe, expect, it } from "vitest";
import {
  HealthChecker,
  makeAlloyDbPing,
  makeFirestorePing,
  makeSecretManagerList,
  makeLlmProviderPing,
  initMetrics,
} from "@vsbs/telemetry";
import { buildHealthRouter } from "./health.js";
import { buildMetricsRouter } from "./metrics.js";

function checkerWithSimDeps() {
  const c = new HealthChecker({ cacheTtlMs: 100, timeoutMs: 1_000 });
  c.register("alloydb-ping", makeAlloyDbPing({ mode: "sim" }));
  c.register("firestore-ping", makeFirestorePing({ mode: "sim" }));
  c.register("secret-manager-list", makeSecretManagerList({ mode: "sim" }));
  c.register("llm-provider-ping", makeLlmProviderPing({ mode: "sim" }));
  return c;
}

describe("health router", () => {
  it("/healthz returns ok with service+region+version", async () => {
    const app = buildHealthRouter({
      checker: checkerWithSimDeps(),
      serviceName: "vsbs-api",
      region: "asia-south1",
      version: "0.1.0",
      modes: { auth: "sim" },
      appEnv: "test",
      adminAuthMode: "sim",
    });
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, service: "vsbs-api", region: "asia-south1", version: "0.1.0" });
  });

  it("/readyz aggregates checks and returns 200 healthy", async () => {
    const app = buildHealthRouter({
      checker: checkerWithSimDeps(),
      serviceName: "vsbs-api",
      region: "asia-south1",
      version: "0.1.0",
      modes: {},
      appEnv: "test",
      adminAuthMode: "sim",
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { status: string; checks: Record<string, unknown> };
    expect(j.status).toBe("healthy");
    expect(Object.keys(j.checks)).toContain("alloydb-ping");
  });

  it("/readyz returns 503 when a check is unhealthy", async () => {
    const c = new HealthChecker();
    c.register("broken", async () => ({ status: "unhealthy", latency_ms: 1, message: "down" }));
    const app = buildHealthRouter({
      checker: c,
      serviceName: "vsbs-api",
      region: "asia-south1",
      version: "0.1.0",
      modes: {},
      appEnv: "test",
      adminAuthMode: "sim",
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
  });

  it("/healthz/details requires admin auth", async () => {
    const app = buildHealthRouter({
      checker: checkerWithSimDeps(),
      serviceName: "vsbs-api",
      region: "asia-south1",
      version: "0.1.0",
      modes: {},
      appEnv: "test",
      adminAuthMode: "sim",
    });
    const res = await app.request("/healthz/details");
    expect([401, 403]).toContain(res.status);
  });
});

describe("metrics router", () => {
  it("/metrics returns text/plain Prom exposition", async () => {
    const m = initMetrics({
      serviceName: "vsbs-test",
      region: "asia-south1",
      version: "0.0.0",
      environment: "test",
      exportIntervalMillis: 50,
    });
    m.meters.httpRequestsTotal.add(1, { method: "GET", route: "/x", status: "200" });
    const app = buildMetricsRouter({ metrics: m });
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("vsbs_http_requests_total");
    await m.shutdown();
  });
});
