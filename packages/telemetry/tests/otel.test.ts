import { describe, expect, it, afterEach } from "vitest";
import { trace } from "@opentelemetry/api";
import { initOtelServer } from "../src/otel-server.js";
import { withSpan, activeTraceIds, type OtelHandle } from "../src/otel-shared.js";

const handles: OtelHandle[] = [];

afterEach(async () => {
  for (const h of handles.splice(0)) await h.shutdown();
});

function init() {
  const h = initOtelServer({
    serviceName: "vsbs-test",
    version: "0.0.0",
    region: "asia-south1",
    environment: "test",
  });
  handles.push(h);
  return h;
}

describe("otel server init", () => {
  it("returns a tracer and exposes the in-memory exporter when no exporterUrl", () => {
    const h = init();
    expect(h.tracer).toBeDefined();
    expect(h.inMemoryExporter).toBeDefined();
  });

  it("registers itself as the global tracer provider", () => {
    init();
    const t = trace.getTracer("any-caller");
    expect(t).toBeDefined();
  });

  it("records spans into the in-memory exporter", async () => {
    const h = init();
    await withSpan(h.tracer, "unit-op", { component: "test" }, async () => {
      // empty body — span attrs only
    });
    await h.flush();
    const recorded = h.inMemoryExporter!.getFinishedSpans();
    expect(recorded.length).toBeGreaterThanOrEqual(1);
    const last = recorded[recorded.length - 1]!;
    expect(last.name).toBe("unit-op");
    expect(last.attributes.component).toBe("test");
  });

  it("records exceptions and marks span as errored", async () => {
    const h = init();
    await expect(
      withSpan(h.tracer, "boom", {}, async () => {
        throw new Error("synthetic");
      }),
    ).rejects.toThrow("synthetic");
    await h.flush();
    const recorded = h.inMemoryExporter!.getFinishedSpans();
    const errSpan = recorded.find((s) => s.name === "boom")!;
    expect(errSpan).toBeDefined();
    expect(errSpan.status.code).toBe(2);
    expect(errSpan.events.length).toBeGreaterThanOrEqual(1);
  });

  it("activeTraceIds returns the current span ids inside a span", async () => {
    const h = init();
    let inside: { traceId: string; spanId: string } = { traceId: "", spanId: "" };
    await withSpan(h.tracer, "ids", {}, async () => {
      inside = activeTraceIds();
    });
    expect(inside.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(inside.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("activeTraceIds returns empty strings outside a span", () => {
    init();
    const ids = activeTraceIds();
    expect(ids.traceId).toBe("");
    expect(ids.spanId).toBe("");
  });
});
