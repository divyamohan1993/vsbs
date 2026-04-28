// =============================================================================
// Server-only OTel initialisation. Pulls in @opentelemetry/context-async-hooks
// (Node async_hooks) so MUST NOT be imported by browser bundles. Use
// "@vsbs/telemetry/otel-browser" from web client code instead.
// =============================================================================

import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  InMemorySpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  buildResource,
  buildSampler,
  stripTrailing,
  type OtelHandle,
  type OtelInitOptions,
} from "./otel-shared.js";

/**
 * Initialise OTel for a Node/Bun service. BasicTracerProvider + OTLP HTTP +
 * BatchSpanProcessor; falls back to an in-memory exporter when exporterUrl is
 * absent (sim / test profiles).
 */
export function initOtelServer(opts: OtelInitOptions): OtelHandle {
  const resource = buildResource(opts);
  const inMemory = opts.exporterUrl ? undefined : new InMemorySpanExporter();

  const processor: SpanProcessor = opts.exporterUrl
    ? new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${stripTrailing(opts.exporterUrl)}/v1/traces`,
          headers: opts.headers ?? {},
        }),
        {
          maxQueueSize: 2048,
          maxExportBatchSize: 512,
          scheduledDelayMillis: 1_000,
          exportTimeoutMillis: 30_000,
        },
      )
    : new BatchSpanProcessor(inMemory!, {
        scheduledDelayMillis: 100,
      });

  const sampler = buildSampler(opts.sampleRatio);

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [processor],
    sampler,
  });

  const cm = new AsyncLocalStorageContextManager();
  cm.enable();
  context.setGlobalContextManager(cm);
  trace.setGlobalTracerProvider(provider);

  const tracer = provider.getTracer(opts.serviceName, opts.version);

  const handle: OtelHandle = {
    tracer,
    ...(inMemory ? { inMemoryExporter: inMemory } : {}),
    flush: () => processor.forceFlush(),
    shutdown: async () => {
      await processor.shutdown();
      await provider.shutdown();
    },
  };

  registerSigtermShutdown(handle);
  return handle;
}

interface ProcLike {
  once: (signal: string, handler: (signal: string) => void) => void;
  exit: (code: number) => void;
}

function registerSigtermShutdown(handle: OtelHandle): void {
  const proc = (globalThis as unknown as { process?: ProcLike }).process;
  if (!proc || typeof proc.once !== "function") return;
  const flushAndExit = (signal: string) => {
    handle
      .shutdown()
      .catch(() => undefined)
      .finally(() => {
        proc.exit(signal === "SIGTERM" ? 0 : 130);
      });
  };
  proc.once("SIGTERM", flushAndExit);
  proc.once("SIGINT", flushAndExit);
}
