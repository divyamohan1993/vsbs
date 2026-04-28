// =============================================================================
// SLO + multi-window burn-rate alerting per the Google SRE workbook.
//
//   Page  fast burn  : 14.4× over 1 h    -> 2 % budget consumed in 1 h
//   Page  slow burn  : 6×    over 6 h    -> 5 % budget consumed in 6 h
//   Ticket          : 1×    over 3 d    -> 10 % budget consumed in 3 d
//
// An SLI is expressed as `good_events / total_events`; the SLO target is the
// minimum fraction we promise (e.g. 0.999 of requests succeed).  Burn rate is
// (1 - SLI) / (1 - target) per Google's "Implementing SLOs" Ch. 5.
// =============================================================================

export type SloWindow = "1h" | "6h" | "1d" | "3d" | "7d" | "30d";

const WINDOW_MILLIS: Record<SloWindow, number> = {
  "1h": 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
  "3d": 3 * 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export interface SliDefinition {
  /** Pretty name, e.g. "API success" or "p99 latency under 1s". */
  description: string;
  /**
   * Identifier of the metric or query used to compute this SLI in the live
   * system. The runtime evaluator does not resolve this; it is kept as
   * provenance for runbook and dashboard authoring.
   */
  query: string;
}

export interface SloDefinition {
  name: string;
  /** 0 < target ≤ 1, e.g. 0.999. */
  target: number;
  window: SloWindow;
  sli: SliDefinition;
}

export interface BurnRateThreshold {
  name: "fast-burn" | "slow-burn" | "ticket";
  /** Look-back window over which we compute the burn rate. */
  window: SloWindow;
  /** Burn-rate multiplier above which the alert fires. */
  multiplier: number;
  severity: "page" | "ticket";
}

/** Standard multi-window thresholds per the Google SRE workbook. */
export const STANDARD_THRESHOLDS: BurnRateThreshold[] = [
  { name: "fast-burn", window: "1h", multiplier: 14.4, severity: "page" },
  { name: "slow-burn", window: "6h", multiplier: 6, severity: "page" },
  { name: "ticket", window: "3d", multiplier: 1, severity: "ticket" },
];

export interface Observation {
  /** Number of "good" events (e.g. successful requests). */
  good: number;
  /** Total events. */
  total: number;
  /** Epoch ms of when this observation was taken. */
  ts: number;
}

export interface SloEvaluation {
  slo: string;
  target: number;
  window: SloWindow;
  /** SLI over the evaluation window. */
  currentSli: number;
  /** Fraction of error budget remaining (0..1). */
  errorBudgetRemaining: number;
  /** Observed burn rate (multiple of allowed). */
  burnRate: number;
  /** Whether any threshold fired. */
  alertFiring: boolean;
  /** Highest-severity firing alert, or null. */
  severity: "page" | "ticket" | null;
  /** Per-threshold detail. */
  thresholds: Array<BurnRateThreshold & { burnRate: number; firing: boolean }>;
}

export function defineSlo(input: SloDefinition): SloDefinition {
  if (!(input.target > 0 && input.target <= 1)) {
    throw new Error("SLO target must be in (0, 1]");
  }
  if (!input.name || !/^[a-z][a-z0-9-]+$/.test(input.name)) {
    throw new Error("SLO name must be lowercase-kebab");
  }
  return input;
}

/**
 * Evaluate an SLO against an array of `Observation`. Observations outside the
 * SLO window are ignored. Burn rates for the standard thresholds are computed
 * against the same dataset filtered to each threshold's smaller window.
 */
export function evaluate(
  slo: SloDefinition,
  observations: Observation[],
  thresholds: BurnRateThreshold[] = STANDARD_THRESHOLDS,
  now: number = Date.now(),
): SloEvaluation {
  const windowMs = WINDOW_MILLIS[slo.window];
  const windowed = observations.filter((o) => now - o.ts <= windowMs);
  const totals = sumWindow(windowed);
  const sli = totals.total === 0 ? 1 : totals.good / totals.total;
  const allowedErrorRate = 1 - slo.target;
  const observedErrorRate = 1 - sli;
  const burnRate = allowedErrorRate === 0 ? 0 : observedErrorRate / allowedErrorRate;
  const errorBudgetRemaining = totals.total === 0
    ? 1
    : Math.max(0, 1 - observedErrorRate / allowedErrorRate);

  const perThreshold = thresholds.map((t) => {
    const tWindow = WINDOW_MILLIS[t.window];
    const obs = observations.filter((o) => now - o.ts <= tWindow);
    const tot = sumWindow(obs);
    const tSli = tot.total === 0 ? 1 : tot.good / tot.total;
    const tBurn = allowedErrorRate === 0 ? 0 : (1 - tSli) / allowedErrorRate;
    return { ...t, burnRate: tBurn, firing: tBurn >= t.multiplier };
  });

  const firing = perThreshold.filter((t) => t.firing);
  const sev: "page" | "ticket" | null = firing.length === 0
    ? null
    : firing.some((t) => t.severity === "page")
      ? "page"
      : "ticket";

  return {
    slo: slo.name,
    target: slo.target,
    window: slo.window,
    currentSli: sli,
    errorBudgetRemaining,
    burnRate,
    alertFiring: firing.length > 0,
    severity: sev,
    thresholds: perThreshold,
  };
}

function sumWindow(obs: Observation[]): { good: number; total: number } {
  let good = 0;
  let total = 0;
  for (const o of obs) {
    good += o.good;
    total += o.total;
  }
  return { good, total };
}

// -----------------------------------------------------------------------------
// Canonical VSBS SLOs. Wired into infra/terraform/observability.tf so the
// alert policies match what the code evaluates.
// -----------------------------------------------------------------------------

export const VSBS_SLOS: readonly SloDefinition[] = Object.freeze([
  defineSlo({
    name: "api-availability",
    target: 0.999,
    window: "30d",
    sli: {
      description: "Successful HTTP 2xx/3xx responses over total responses",
      query: "vsbs_http_requests_total{status!~\"5..\"} / vsbs_http_requests_total",
    },
  }),
  defineSlo({
    name: "api-latency-p99",
    target: 0.99,
    window: "7d",
    sli: {
      description: "Requests under 1 s at p99",
      query: "histogram_quantile(0.99, vsbs_http_request_duration_seconds_bucket) <= 1",
    },
  }),
  defineSlo({
    name: "concierge-turn-success",
    target: 0.995,
    window: "7d",
    sli: {
      description: "Concierge turns that emit a final agent decision without error",
      query: "vsbs_concierge_turns_total{result=\"ok\"} / vsbs_concierge_turns_total",
    },
  }),
  defineSlo({
    name: "autonomy-handoff-success",
    target: 0.999,
    window: "30d",
    sli: {
      description: "Command-grant lifecycle accepted -> revoked without takeover failure",
      query: "vsbs_autonomy_handoff_total{result=\"ok\"} / vsbs_autonomy_handoff_total",
    },
  }),
]);
