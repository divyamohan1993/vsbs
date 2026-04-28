// =============================================================================
// Runtime-agnostic OTel surface. Types, span helpers, and resource/sampler
// builders that pull only from packages safe for both Node/Bun and the
// browser. The actual provider initialisation lives in otel-server.ts (Node)
// and otel-browser.ts (browser) so the wrong runtime never gets bundled.
// =============================================================================

import { context, trace, type Span, type Tracer } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
  AlwaysOnSampler,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export interface OtelInitOptions {
  serviceName: string;
  serviceNamespace?: string;
  region: string;
  version: string;
  environment: "development" | "staging" | "production" | "test";
  exporterUrl?: string;
  headers?: Record<string, string>;
  sampleRatio?: number;
}

export interface OtelHandle {
  tracer: Tracer;
  inMemoryExporter?: InMemorySpanExporter;
  shutdown: () => Promise<void>;
  flush: () => Promise<void>;
}

export const DEFAULT_NAMESPACE = "vsbs";

export function buildResource(opts: OtelInitOptions) {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.version,
    "service.namespace": opts.serviceNamespace ?? DEFAULT_NAMESPACE,
    "service.region": opts.region,
    "deployment.environment": opts.environment,
  });
}

export function buildSampler(ratio: number | undefined) {
  if (ratio === undefined || ratio >= 1) {
    return new ParentBasedSampler({ root: new AlwaysOnSampler() });
  }
  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(Math.max(0, ratio)),
  });
}

export function stripTrailing(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/** Returns `{traceId, spanId}` of the active span, or empty strings. */
export function activeTraceIds(): { traceId: string; spanId: string } {
  const span = trace.getSpan(context.active());
  if (!span) return { traceId: "", spanId: "" };
  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/** Run an async fn inside a new span; record exceptions and end the span. */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2, message: String(err) });
      span.end();
      throw err;
    }
  });
}
