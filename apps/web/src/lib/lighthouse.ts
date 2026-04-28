"use client";

// Web Vitals reporter. We compute LCP, INP, and CLS using the
// PerformanceObserver API directly so the runtime cost is zero
// dependencies. The values are POSTed as keepalive sendBeacon-style
// payloads; a 100% sample rate in development and 10% in production
// keeps the volume manageable.

interface VitalSample {
  name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  value: number;
  id: string;
  navigationType: NavigationTimingType;
  rating: "good" | "needs-improvement" | "poor";
}

const THRESHOLDS: Record<VitalSample["name"], { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

function rate(name: VitalSample["name"], value: number): VitalSample["rating"] {
  const t = THRESHOLDS[name];
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

function navigationType(): NavigationTimingType {
  if (typeof performance === "undefined") return "navigate";
  const entries = performance.getEntriesByType("navigation");
  const first = entries[0] as PerformanceNavigationTiming | undefined;
  return first?.type ?? "navigate";
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function send(sample: VitalSample, endpoint: string): void {
  const payload = JSON.stringify({ ...sample });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon(endpoint, blob);
    return;
  }
  void fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  });
}

export interface ReporterOpts {
  endpoint?: string;
  /** Sample rate between 0 and 1. */
  sampleRate?: number;
  /** Optional console echo for development inspection. */
  echo?: boolean;
}

let installed = false;

export function installVitalsReporter(opts: ReporterOpts = {}): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  const endpoint = opts.endpoint ?? "/api/proxy/metrics/web-vitals";
  const sampleRate = opts.sampleRate ?? (process.env.NODE_ENV === "production" ? 0.1 : 1);
  if (Math.random() > sampleRate) return;

  // ---- LCP ----
  let lcpReported = false;
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length === 0) return;
      const last = entries[entries.length - 1] as LargestContentfulPaint;
      const value = last.renderTime || last.loadTime || 0;
      const sample: VitalSample = {
        name: "LCP",
        value,
        id: newId(),
        navigationType: navigationType(),
        rating: rate("LCP", value),
      };
      if (!lcpReported) {
        lcpReported = true;
        if (opts.echo) console.info("[vitals]", sample);
        send(sample, endpoint);
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") lcpObserver.takeRecords();
      },
      { once: true },
    );
  } catch {
    /* unsupported */
  }

  // ---- INP ----
  try {
    let worstInteractionDuration = 0;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEventTiming;
        if (typeof e.duration === "number" && e.duration > worstInteractionDuration) {
          worstInteractionDuration = e.duration;
          const sample: VitalSample = {
            name: "INP",
            value: worstInteractionDuration,
            id: newId(),
            navigationType: navigationType(),
            rating: rate("INP", worstInteractionDuration),
          };
          if (opts.echo) console.info("[vitals]", sample);
          send(sample, endpoint);
        }
      }
    });
    inpObserver.observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit & { durationThreshold?: number });
  } catch {
    /* unsupported */
  }

  // ---- CLS ----
  try {
    let clsValue = 0;
    let clsEntries: LayoutShiftEntry[] = [];
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as LayoutShiftEntry;
        if (!e.hadRecentInput) {
          const last = clsEntries[clsEntries.length - 1];
          if (last && e.startTime - last.startTime < 1000 && e.startTime - clsEntries[0]!.startTime < 5000) {
            clsValue += e.value;
            clsEntries.push(e);
          } else {
            clsValue = e.value;
            clsEntries = [e];
          }
          const sample: VitalSample = {
            name: "CLS",
            value: clsValue,
            id: newId(),
            navigationType: navigationType(),
            rating: rate("CLS", clsValue),
          };
          if (opts.echo) console.info("[vitals]", sample);
          send(sample, endpoint);
        }
      }
    });
    clsObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    /* unsupported */
  }
}

interface LargestContentfulPaint extends PerformanceEntry {
  renderTime: number;
  loadTime: number;
}
interface LayoutShiftEntry extends PerformanceEntry {
  hadRecentInput: boolean;
  value: number;
}
