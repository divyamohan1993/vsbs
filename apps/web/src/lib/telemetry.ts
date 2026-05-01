// =============================================================================
// Browser-side telemetry. Captures Web Vitals (LCP / INP / CLS) from the
// PerformanceObserver API and forwards them to the API as a beacon. Spans for
// route changes flow through @vsbs/telemetry's WebTracerProvider when an
// OTLP collector is configured (NEXT_PUBLIC_OTLP_BROWSER_URL); otherwise they
// stay in memory.
//
// All exports are SSR-safe: the public surface is functions, not classes
// holding live providers, so importing this file at module top-level cannot
// break the server bundle.
// =============================================================================

export type VitalRating = "good" | "needs-improvement" | "poor";

export interface VitalSample {
  name: "LCP" | "INP" | "CLS" | "TTFB" | "FCP";
  value: number;
  rating: VitalRating;
  id: string;
  navigationType: "navigate" | "reload" | "back_forward" | "prerender";
}

let cachedNavType: VitalSample["navigationType"] | undefined;
function readNavigationType(): VitalSample["navigationType"] {
  if (cachedNavType) return cachedNavType;
  if (typeof performance === "undefined") return (cachedNavType = "navigate");
  const entries = performance.getEntriesByType("navigation");
  const nav = entries[0] as PerformanceNavigationTiming | undefined;
  const t = nav?.type as PerformanceNavigationTiming["type"] | undefined;
  switch (t) {
    case "reload":
      cachedNavType = "reload";
      break;
    case "back_forward":
      cachedNavType = "back_forward";
      break;
    case "prerender":
      cachedNavType = "prerender";
      break;
    default:
      cachedNavType = "navigate";
  }
  return cachedNavType;
}

function vitalId(name: VitalSample["name"]): string {
  return `${name}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

const VITAL_THRESHOLDS: Record<VitalSample["name"], { good: number; poor: number }> = {
  LCP: { good: 2_500, poor: 4_000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  TTFB: { good: 800, poor: 1_800 },
  FCP: { good: 1_800, poor: 3_000 },
};

function rate(name: VitalSample["name"], value: number): VitalRating {
  const t = VITAL_THRESHOLDS[name];
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

/** Hook the PerformanceObserver-based vitals and forward each sample. */
export function observeVitals(onSample: (s: VitalSample) => void): () => void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return () => undefined;
  }
  const observers: PerformanceObserver[] = [];
  const safeObserve = (entryType: string, cb: (entry: PerformanceEntry) => void) => {
    try {
      const o = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) cb(e);
      });
      o.observe({ type: entryType, buffered: true });
      observers.push(o);
    } catch {
      // Browser does not support this entry type - skip silently.
    }
  };

  const make = (name: VitalSample["name"], value: number): VitalSample => ({
    name,
    value,
    rating: rate(name, value),
    id: vitalId(name),
    navigationType: readNavigationType(),
  });

  // LCP - last paint of the largest content element.
  let lastLcp = 0;
  safeObserve("largest-contentful-paint", (e) => {
    const v = (e as PerformanceEntry & { renderTime?: number; startTime: number }).renderTime ?? e.startTime;
    if (v > lastLcp) {
      lastLcp = v;
      onSample(make("LCP", v));
    }
  });

  // CLS - cumulative layout shift; we sum unexpected shifts.
  let cls = 0;
  safeObserve("layout-shift", (e) => {
    const ls = e as PerformanceEntry & { value: number; hadRecentInput?: boolean };
    if (ls.hadRecentInput) return;
    cls += ls.value;
    onSample(make("CLS", cls));
  });

  // INP - approximated from event-timing entries' processing duration.
  safeObserve("event", (e) => {
    const ev = e as PerformanceEntry & { duration: number };
    if (ev.duration <= 0) return;
    onSample(make("INP", ev.duration));
  });

  // FCP + TTFB from navigation/paint timings.
  safeObserve("paint", (e) => {
    if (e.name === "first-contentful-paint") {
      onSample(make("FCP", e.startTime));
    }
  });
  safeObserve("navigation", (e) => {
    const nav = e as PerformanceNavigationTiming;
    if (nav.responseStart > 0) {
      onSample(make("TTFB", nav.responseStart));
    }
  });

  return () => {
    for (const o of observers) o.disconnect();
  };
}

/**
 * Forward a Web Vitals sample to the API as a JSON beacon. Uses
 * navigator.sendBeacon when available so the request survives page unload.
 */
export function sendVital(sample: VitalSample, endpoint = "/api/proxy/metrics/web-vitals"): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify(sample);
  if (navigator.sendBeacon) {
    try {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return;
    } catch {
      // Fall through to fetch.
    }
  }
  fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/** Convenience: start observing and forwarding everything. */
export function bootBrowserTelemetry(): () => void {
  return observeVitals((s) => sendVital(s));
}

// -----------------------------------------------------------------------------
// Span helpers - used by the route-change + error-boundary hooks. We avoid a
// hard dep on @opentelemetry/api in the browser bundle; the OTel SDK is
// loaded only when an OTLP collector URL is configured.
// -----------------------------------------------------------------------------

interface ServerSpanLike {
  setAttribute: (k: string, v: unknown) => void;
  end: () => void;
}

let webTracer: { startSpan: (name: string, attrs?: Record<string, unknown>) => ServerSpanLike } | null = null;

export function recordRouteChange(toPath: string): void {
  webTracer?.startSpan("route.change", { "next.route": toPath }).end();
}

export function recordErrorBoundary(error: Error, info: { componentStack?: string | null }): void {
  webTracer?.startSpan("react.error_boundary", {
    "error.name": error.name,
    "error.message": error.message,
    "error.stack": error.stack ?? "",
    "react.component_stack": info.componentStack ?? "",
  }).end();
}

/**
 * Initialise the OTel browser tracer when given an OTLP collector URL.
 * Loaded with a dynamic import so the SDK never enters the SSR bundle.
 */
export async function initBrowserOtel(opts: {
  serviceName: string;
  region: string;
  version: string;
  exporterUrl: string;
}): Promise<void> {
  if (typeof window === "undefined") return;
  const { initOtelBrowser } = await import("@vsbs/telemetry/otel-browser");
  const handle = initOtelBrowser({
    serviceName: opts.serviceName,
    region: opts.region,
    version: opts.version,
    environment: "production",
    exporterUrl: opts.exporterUrl,
  });
  webTracer = {
    startSpan: (name, attrs) => {
      const span = handle.tracer.startSpan(name, {
        attributes: (attrs ?? {}) as Record<string, string | number | boolean>,
      });
      return {
        setAttribute: (k, v) => span.setAttribute(k, v as string | number | boolean),
        end: () => span.end(),
      };
    },
  };
}
