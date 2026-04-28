// =============================================================================
// Prometheus-style VSBS metrics over the official OTel JS Metrics SDK.
//
// Counters    - vsbs_http_requests_total{method,route,status}
//               vsbs_safety_overrides_total
//               vsbs_dispatch_mode_total{mode}
//               vsbs_consent_changes_total{purpose,action}
// Histograms  - vsbs_http_request_duration_seconds{route} (.005..30 buckets)
//               vsbs_wellbeing_score
// Gauges      - vsbs_active_bookings, vsbs_pending_grants
//
// Sim mode keeps observations in memory; live mode pushes via OTLP HTTP to
// the Cloud Monitoring / OTel collector endpoint configured in env.
// =============================================================================

import { metrics, type Counter, type Histogram, type ObservableGauge } from "@opentelemetry/api";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
  DataPointType,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

// HTTP duration buckets (seconds). Standard Prometheus client_golang shape
// extended with a 30-second tail for slow concierge SSE turns.
export const HTTP_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
];

export interface MetricsInitOptions {
  serviceName: string;
  serviceNamespace?: string;
  region: string;
  version: string;
  environment: "development" | "staging" | "production" | "test";
  /** OTLP collector base URL. If absent, uses InMemoryMetricExporter. */
  exporterUrl?: string;
  /** Bearer/API headers added to every OTLP push. */
  headers?: Record<string, string>;
  /** How often to push. Default 15 s. */
  exportIntervalMillis?: number;
}

export interface VsbsMeters {
  httpRequestsTotal: Counter;
  httpRequestDurationSeconds: Histogram;
  safetyOverridesTotal: Counter;
  dispatchModeTotal: Counter;
  consentChangesTotal: Counter;
  wellbeingScore: Histogram;
  activeBookings: ObservableGauge;
  pendingGrants: ObservableGauge;
}

export interface MetricsHandle {
  meters: VsbsMeters;
  /** When using the in-memory fallback this is the recording exporter. */
  inMemoryExporter?: InMemoryMetricExporter;
  setActiveBookings: (n: number) => void;
  setPendingGrants: (n: number) => void;
  shutdown: () => Promise<void>;
  flush: () => Promise<void>;
}

export function initMetrics(opts: MetricsInitOptions): MetricsHandle {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.version,
    "service.namespace": opts.serviceNamespace ?? "vsbs",
    "service.region": opts.region,
    "deployment.environment": opts.environment,
  });

  const inMemory = opts.exporterUrl ? undefined : new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

  const exporter: PushMetricExporter = opts.exporterUrl
    ? new OTLPMetricExporter({
        url: `${stripTrailing(opts.exporterUrl)}/v1/metrics`,
        headers: opts.headers ?? {},
      })
    : inMemory!;

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: opts.exportIntervalMillis ?? 15_000,
  });

  const provider = new MeterProvider({
    resource,
    readers: [reader],
  });
  metrics.setGlobalMeterProvider(provider);

  const meter = provider.getMeter(opts.serviceName, opts.version);

  const httpRequestsTotal = meter.createCounter("vsbs_http_requests_total", {
    description: "Total HTTP requests handled, partitioned by method, route and status.",
    unit: "1",
  });

  const httpRequestDurationSeconds = meter.createHistogram("vsbs_http_request_duration_seconds", {
    description: "HTTP request duration in seconds, partitioned by route.",
    unit: "s",
    advice: { explicitBucketBoundaries: HTTP_DURATION_BUCKETS },
  });

  const safetyOverridesTotal = meter.createCounter("vsbs_safety_overrides_total", {
    description: "Times the hard-coded safety floor was overridden by an operator.",
    unit: "1",
  });

  const dispatchModeTotal = meter.createCounter("vsbs_dispatch_mode_total", {
    description: "Dispatch decisions, partitioned by mode (drive-in/mobile/pickup/tow).",
    unit: "1",
  });

  const consentChangesTotal = meter.createCounter("vsbs_consent_changes_total", {
    description: "Consent grant or revocation events, partitioned by purpose and action.",
    unit: "1",
  });

  const wellbeingScore = meter.createHistogram("vsbs_wellbeing_score", {
    description: "Distribution of wellbeing scores produced by the scorer.",
    unit: "1",
    advice: { explicitBucketBoundaries: [0, 0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  });

  const activeBookings = meter.createObservableGauge("vsbs_active_bookings", {
    description: "Bookings currently in any non-terminal state.",
    unit: "1",
  });
  const pendingGrants = meter.createObservableGauge("vsbs_pending_grants", {
    description: "Command grants awaiting authority-chain settlement.",
    unit: "1",
  });

  let activeBookingsValue = 0;
  let pendingGrantsValue = 0;

  activeBookings.addCallback((result) => {
    result.observe(activeBookingsValue);
  });
  pendingGrants.addCallback((result) => {
    result.observe(pendingGrantsValue);
  });

  const handle: MetricsHandle = {
    meters: {
      httpRequestsTotal,
      httpRequestDurationSeconds,
      safetyOverridesTotal,
      dispatchModeTotal,
      consentChangesTotal,
      wellbeingScore,
      activeBookings,
      pendingGrants,
    },
    ...(inMemory ? { inMemoryExporter: inMemory } : {}),
    setActiveBookings: (n) => {
      activeBookingsValue = n;
    },
    setPendingGrants: (n) => {
      pendingGrantsValue = n;
    },
    flush: async () => {
      await reader.forceFlush();
    },
    shutdown: async () => {
      await reader.shutdown();
      await provider.shutdown();
    },
  };
  return handle;
}

function stripTrailing(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// -----------------------------------------------------------------------------
// Prometheus exposition formatter - sufficient for /metrics scraping in
// regions where we still rely on Prom rather than full OTLP.
// We keep it small: counters + the in-memory metric reader are enough for the
// current Cloud Run scrape lane.
// -----------------------------------------------------------------------------

export interface PromExposition {
  contentType: "text/plain; version=0.0.4; charset=utf-8";
  body: string;
}

interface FlatSnapshot {
  name: string;
  type: "counter" | "gauge" | "histogram";
  description: string;
  unit?: string;
  values: Array<{ labels: Record<string, string>; value: number }>;
  histograms?: Array<{
    labels: Record<string, string>;
    buckets: Array<{ le: number | "+Inf"; count: number }>;
    sum: number;
    count: number;
  }>;
}

/**
 * Render an in-memory metrics snapshot to Prometheus text format. Live
 * deployments push OTLP directly; this is for /metrics scraping in dev and
 * the SIEM admin pane which subscribes via SSE.
 */
export function renderProm(snapshots: FlatSnapshot[]): PromExposition {
  const lines: string[] = [];
  for (const m of snapshots) {
    lines.push(`# HELP ${m.name} ${m.description.replace(/\n/g, " ")}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    if (m.type === "histogram" && m.histograms) {
      for (const h of m.histograms) {
        for (const b of h.buckets) {
          lines.push(
            `${m.name}_bucket{${labelsToProm({ ...h.labels, le: String(b.le) })}} ${b.count}`,
          );
        }
        lines.push(`${m.name}_sum{${labelsToProm(h.labels)}} ${h.sum}`);
        lines.push(`${m.name}_count{${labelsToProm(h.labels)}} ${h.count}`);
      }
    } else {
      for (const v of m.values) {
        lines.push(`${m.name}{${labelsToProm(v.labels)}} ${v.value}`);
      }
    }
  }
  return {
    contentType: "text/plain; version=0.0.4; charset=utf-8",
    body: lines.join("\n") + "\n",
  };
}

function labelsToProm(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(",");
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// -----------------------------------------------------------------------------
// Helper: collect a snapshot from the in-memory metric exporter shape.
// The OTel SDK exposes ResourceMetrics; we flatten just the fields we render.
// -----------------------------------------------------------------------------

export async function collectInMemoryProm(handle: MetricsHandle): Promise<PromExposition> {
  if (!handle.inMemoryExporter) {
    return { contentType: "text/plain; version=0.0.4; charset=utf-8", body: "" };
  }
  await handle.flush();
  const all = handle.inMemoryExporter.getMetrics();
  const snapshots: FlatSnapshot[] = [];
  for (const rm of all) {
    for (const sm of rm.scopeMetrics) {
      for (const md of sm.metrics) {
        const name = md.descriptor.name;
        const description = md.descriptor.description ?? "";
        const unit = md.descriptor.unit;
        if (md.dataPointType === DataPointType.HISTOGRAM) {
          const histograms = md.dataPoints.map((dp) => {
            const v = dp.value as {
              buckets: { boundaries: number[]; counts: number[] };
              sum: number;
              count: number;
            };
            const buckets: Array<{ le: number | "+Inf"; count: number }> = [];
            let cum = 0;
            for (let i = 0; i < v.buckets.boundaries.length; i++) {
              const upper = v.buckets.boundaries[i] ?? Number.POSITIVE_INFINITY;
              cum += v.buckets.counts[i] ?? 0;
              buckets.push({ le: upper, count: cum });
            }
            cum += v.buckets.counts[v.buckets.counts.length - 1] ?? 0;
            buckets.push({ le: "+Inf", count: cum });
            return {
              labels: stringifyAttrs(dp.attributes),
              buckets,
              sum: v.sum,
              count: v.count,
            };
          });
          snapshots.push({
            name,
            type: "histogram",
            description,
            ...(unit ? { unit } : {}),
            values: [],
            histograms,
          });
        } else if (md.dataPointType === DataPointType.SUM) {
          snapshots.push({
            name,
            type: "counter",
            description,
            ...(unit ? { unit } : {}),
            values: md.dataPoints.map((dp) => ({
              labels: stringifyAttrs(dp.attributes),
              value: dp.value as number,
            })),
          });
        } else if (md.dataPointType === DataPointType.GAUGE) {
          snapshots.push({
            name,
            type: "gauge",
            description,
            ...(unit ? { unit } : {}),
            values: md.dataPoints.map((dp) => ({
              labels: stringifyAttrs(dp.attributes),
              value: dp.value as number,
            })),
          });
        }
      }
    }
  }
  return renderProm(snapshots);
}

function stringifyAttrs(a: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    out[k] = v === undefined || v === null ? "" : String(v);
  }
  return out;
}
