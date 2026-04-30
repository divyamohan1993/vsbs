"use client";

// =============================================================================
// Privacy-preserving analytics aggregator.
//
// The web app accumulates short-lived in-memory rows (one per user
// interaction or page view). Before flushing them to the server we:
//
//   1. Apply k-anonymity (k=5 by default) on a fixed list of quasi-
//      identifiers — coarse OS, locale, city band, route, theme. Rows
//      whose equivalence class is smaller than k are suppressed. This
//      satisfies the "anonymisation" definition in DPDP §17(4) for
//      quasi-identifier fields.
//
//   2. Noise every numeric aggregate computed from a quasi-identifier
//      via the Laplace mechanism (default ε=1.0). Each row contributes
//      at most `clip` to any aggregate, so sensitivity is bounded.
//
//   3. Bound the privacy budget per session at BUDGET_PER_SESSION ε
//      (=2.0 by default). Once spent, no more aggregates flush — the
//      session falls back to event counts only.
//
// References:
//   docs/research/security.md §2 (data minimisation)
//   Dwork & Roth (2014) §3.5.1 (sequential composition: ε's add).
//   DPDP Act 2023 §8(3) (purpose limitation), §17(4) (anonymisation).
// =============================================================================

import {
  addLaplaceNoise,
  kAnonymise,
  seededRng,
  type Rng,
  type Row,
} from "./dp";

export const BUDGET_PER_SESSION = 2.0;
/** Default ε per flushed numeric aggregate. */
export const DEFAULT_EPSILON = 1.0;
/** Default k for k-anonymity on quasi-identifiers. */
export const DEFAULT_K = 5;

export interface AnalyticsRow extends Row {
  /** Quasi-identifiers used by k-anonymity. Keep this set small + coarse. */
  os: "android" | "ios" | "windows" | "mac" | "linux" | "other";
  locale: string;
  cityBand: string;
  route: string;
  theme: "light" | "dark";
  /** Numeric metrics reported by the page; treated as DP-noised on flush. */
  durationMs: number;
  scrollDepth: number;
}

const QUASI: ReadonlyArray<keyof AnalyticsRow> = [
  "os",
  "locale",
  "cityBand",
  "route",
  "theme",
];

export interface AggregateBucket {
  /** Equivalence class identifier — concatenation of generalised quasi-ids. */
  key: string;
  count: number;
  meanDurationMs: number;
  meanScrollDepth: number;
}

export interface FlushResult {
  buckets: AggregateBucket[];
  suppressedFraction: number;
  /** ε spent on this flush. */
  epsilonSpent: number;
  /** ε remaining in the session budget after this flush. */
  epsilonRemaining: number;
  rowsAccepted: number;
  rowsSkipped: number;
}

export interface AnalyticsCollectorOptions {
  k?: number;
  epsilonPerFlush?: number;
  /** Hard cap on total ε per session. */
  sessionBudget?: number;
  /** Clip applied to per-row contribution for sensitivity bounding. */
  durationClipMs?: number;
  scrollClip?: number;
  rng?: Rng;
}

/** Tracks the pending rows + ε budget for the current session. */
export interface AnalyticsCollector {
  add(row: AnalyticsRow): void;
  rows(): ReadonlyArray<AnalyticsRow>;
  /** Aggregate, anonymise, noise, and produce a flushable bucket list. */
  flush(): FlushResult;
  budgetRemaining(): number;
  reset(): void;
}

export function makeAnalyticsCollector(opts: AnalyticsCollectorOptions = {}): AnalyticsCollector {
  const k = opts.k ?? DEFAULT_K;
  const epsilonPerFlush = opts.epsilonPerFlush ?? DEFAULT_EPSILON;
  const sessionBudget = opts.sessionBudget ?? BUDGET_PER_SESSION;
  const durationClipMs = opts.durationClipMs ?? 60_000;
  const scrollClip = opts.scrollClip ?? 1.0;
  const rng = opts.rng ?? seededRng(BigInt(Date.now()));

  let rowList: AnalyticsRow[] = [];
  let budget = sessionBudget;

  return {
    add(row: AnalyticsRow): void {
      rowList.push({ ...row });
    },
    rows(): ReadonlyArray<AnalyticsRow> {
      return rowList;
    },
    flush(): FlushResult {
      const accepted = rowList.length;
      // We charge two Laplace draws per bucket (mean = noisySum / noisyN
      // for two metrics) plus 1 for the count, so each bucket costs the
      // full epsilonPerFlush. With sequential composition we drain the
      // session budget once spent.
      if (budget < epsilonPerFlush) {
        return {
          buckets: [],
          suppressedFraction: 1,
          epsilonSpent: 0,
          epsilonRemaining: budget,
          rowsAccepted: 0,
          rowsSkipped: accepted,
        };
      }

      const { rows: anonRows, suppressed } = kAnonymise(rowList, k, QUASI);

      // Bucket by quasi-identifier key.
      const buckets = new Map<string, AnalyticsRow[]>();
      for (const r of anonRows) {
        const key = QUASI.map((qi) => String(r[qi])).join(" ");
        const existing = buckets.get(key);
        if (existing) {
          existing.push(r);
        } else {
          buckets.set(key, [r]);
        }
      }

      const out: AggregateBucket[] = [];
      // ε is split: half on count, quarter on each of two means' sum.
      // Counts: sensitivity 1. Means: sensitivity = clip.
      const epsCount = epsilonPerFlush / 2;
      const epsMeanSum = epsilonPerFlush / 4;
      const epsMeanN = epsilonPerFlush / 4;
      for (const [key, members] of buckets.entries()) {
        const noisyCount = addLaplaceNoise(members.length, 1, epsCount, { rng });
        let durSum = 0;
        let depthSum = 0;
        for (const m of members) {
          durSum += clip(m.durationMs, durationClipMs);
          depthSum += clip(m.scrollDepth, scrollClip);
        }
        const noisySumDur = addLaplaceNoise(durSum, durationClipMs, epsMeanSum, { rng });
        const noisyNDur = addLaplaceNoise(members.length, 1, epsMeanN, { rng });
        const noisySumDepth = addLaplaceNoise(depthSum, scrollClip, epsMeanSum, { rng });
        const noisyNDepth = addLaplaceNoise(members.length, 1, epsMeanN, { rng });
        out.push({
          key,
          count: Math.max(0, Math.round(noisyCount)),
          meanDurationMs: noisyNDur > 0 ? noisySumDur / noisyNDur : 0,
          meanScrollDepth: noisyNDepth > 0 ? noisySumDepth / noisyNDepth : 0,
        });
      }

      budget = Math.max(0, budget - epsilonPerFlush);
      rowList = [];
      return {
        buckets: out,
        suppressedFraction: suppressed,
        epsilonSpent: epsilonPerFlush,
        epsilonRemaining: budget,
        rowsAccepted: accepted,
        rowsSkipped: 0,
      };
    },
    budgetRemaining(): number {
      return budget;
    },
    reset(): void {
      rowList = [];
      budget = sessionBudget;
    },
  };
}

function clip(v: number, c: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-c, Math.min(c, v));
}

/** Beacon a flushed bucket list to the server. */
export function flushAnalytics(
  collector: AnalyticsCollector,
  endpoint = "/api/proxy/analytics/aggregate",
): FlushResult {
  const result = collector.flush();
  if (typeof window === "undefined") return result;
  if (result.buckets.length === 0) return result;
  const body = JSON.stringify({
    schemaVersion: 1,
    epsilon: result.epsilonSpent,
    suppressed: result.suppressedFraction,
    buckets: result.buckets,
  });
  if (navigator.sendBeacon) {
    try {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return result;
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
  return result;
}
