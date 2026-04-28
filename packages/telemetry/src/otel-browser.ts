// =============================================================================
// Browser-only OTel initialisation. WebTracerProvider + OTLP-HTTP exporter,
// no async_hooks dependency, no Node-only imports. Safe for client-component
// bundles. Server callers must use "@vsbs/telemetry/otel-server" instead.
// =============================================================================

import { trace } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  buildResource,
  buildSampler,
  stripTrailing,
  type OtelHandle,
  type OtelInitOptions,
} from "./otel-shared.js";

export function initOtelBrowser(opts: OtelInitOptions): OtelHandle {
  const resource = buildResource(opts);
  const inMemory = opts.exporterUrl ? undefined : new InMemorySpanExporter();

  const processor = opts.exporterUrl
    ? new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${stripTrailing(opts.exporterUrl)}/v1/traces`,
          headers: opts.headers ?? {},
        }),
        {
          maxQueueSize: 1024,
          maxExportBatchSize: 256,
          scheduledDelayMillis: 2_000,
        },
      )
    : new BatchSpanProcessor(inMemory!, { scheduledDelayMillis: 100 });

  const sampler = buildSampler(opts.sampleRatio);

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [processor],
    sampler,
  });

  trace.setGlobalTracerProvider(provider);

  const tracer = provider.getTracer(opts.serviceName, opts.version);

  return {
    tracer,
    ...(inMemory ? { inMemoryExporter: inMemory } : {}),
    flush: async () => {
      await processor.forceFlush();
    },
    shutdown: async () => {
      await provider.shutdown();
    },
  };
}
