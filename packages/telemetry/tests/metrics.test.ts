import { describe, expect, it, afterEach } from "vitest";
import {
  initMetrics,
  collectInMemoryProm,
  renderProm,
  HTTP_DURATION_BUCKETS,
  type MetricsHandle,
} from "../src/metrics.js";

const handles: MetricsHandle[] = [];

afterEach(async () => {
  for (const h of handles.splice(0)) await h.shutdown();
});

function init() {
  const h = initMetrics({
    serviceName: "vsbs-test",
    version: "0.0.0",
    region: "asia-south1",
    environment: "test",
    exportIntervalMillis: 100,
  });
  handles.push(h);
  return h;
}

describe("initMetrics", () => {
  it("creates the canonical VSBS meters", () => {
    const h = init();
    expect(h.meters.httpRequestsTotal).toBeDefined();
    expect(h.meters.httpRequestDurationSeconds).toBeDefined();
    expect(h.meters.safetyOverridesTotal).toBeDefined();
    expect(h.meters.dispatchModeTotal).toBeDefined();
    expect(h.meters.consentChangesTotal).toBeDefined();
    expect(h.meters.wellbeingScore).toBeDefined();
    expect(h.meters.activeBookings).toBeDefined();
    expect(h.meters.pendingGrants).toBeDefined();
    expect(h.inMemoryExporter).toBeDefined();
  });

  it("records counter increments and exposes them via prom render", async () => {
    const h = init();
    h.meters.httpRequestsTotal.add(1, { method: "GET", route: "/v1/health", status: "200" });
    h.meters.httpRequestsTotal.add(2, { method: "GET", route: "/v1/health", status: "200" });
    const prom = await collectInMemoryProm(h);
    expect(prom.body).toContain("vsbs_http_requests_total");
    expect(prom.body).toContain('method="GET"');
    expect(prom.body).toContain('route="/v1/health"');
    expect(prom.body).toContain('status="200"');
  });

  it("records histogram buckets for http duration", async () => {
    const h = init();
    h.meters.httpRequestDurationSeconds.record(0.001, { route: "/x" });
    h.meters.httpRequestDurationSeconds.record(0.4, { route: "/x" });
    h.meters.httpRequestDurationSeconds.record(2, { route: "/x" });
    const prom = await collectInMemoryProm(h);
    expect(prom.body).toContain("vsbs_http_request_duration_seconds_bucket");
    expect(prom.body).toContain("vsbs_http_request_duration_seconds_count");
    expect(prom.body).toContain("vsbs_http_request_duration_seconds_sum");
  });

  it("setActiveBookings updates the gauge value", async () => {
    const h = init();
    h.setActiveBookings(7);
    h.setPendingGrants(3);
    const prom = await collectInMemoryProm(h);
    expect(prom.body).toContain("vsbs_active_bookings");
    expect(prom.body).toContain("vsbs_pending_grants");
  });

  it("HTTP_DURATION_BUCKETS is monotonic and within Prom standard", () => {
    let prev = -1;
    for (const b of HTTP_DURATION_BUCKETS) {
      expect(b).toBeGreaterThan(prev);
      prev = b;
    }
    expect(HTTP_DURATION_BUCKETS[0]).toBe(0.005);
    expect(HTTP_DURATION_BUCKETS[HTTP_DURATION_BUCKETS.length - 1]).toBe(30);
  });
});

describe("renderProm", () => {
  it("emits HELP and TYPE lines per metric", () => {
    const out = renderProm([
      {
        name: "x_total",
        type: "counter",
        description: "Test",
        values: [{ labels: { kind: "a" }, value: 5 }],
      },
    ]);
    expect(out.body).toContain("# HELP x_total Test");
    expect(out.body).toContain("# TYPE x_total counter");
    expect(out.body).toContain('x_total{kind="a"} 5');
    expect(out.contentType).toBe("text/plain; version=0.0.4; charset=utf-8");
  });

  it("escapes quotes and newlines in label values", () => {
    const out = renderProm([
      {
        name: "x",
        type: "gauge",
        description: "x",
        values: [{ labels: { v: 'a"b\nc' }, value: 1 }],
      },
    ]);
    expect(out.body).toContain('v="a\\"b\\nc"');
  });
});
