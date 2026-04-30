// =============================================================================
// Online distribution anomaly monitor.
//
// Per-(vehicle, channel) running KL-divergence vs. a fleet baseline. Memory
// is constant: two fixed-bin histograms (default 16 bins) plus a small
// counter. Histograms are updated with exponential decay (alpha = 0.01) so
// they track recent behaviour without unbounded growth.
//
// When KL(P || Q) > threshold (default 0.5 nats) for `consecutiveTrigger`
// (default 5) consecutive samples, the monitor emits an "anomaly" verdict.
// The fusion arbitration consumes that verdict and surfaces a synthetic
// `sensor-failure` statement so the existing PHM pipeline (PhmReading
// `suspectedSensorFailure: true`) can refuse autonomy on tier-1 channels.
//
// Why KL-divergence?
//   - Cheap (O(bins) per sample).
//   - Sensitive to mean shifts and variance changes simultaneously.
//   - Bounded interpretation: 0 = identical distributions; > 0.5 nats is a
//     well-established "noticeable shift" threshold in process-control
//     literature (Kullback 1951; ISO 22514-7 §6.4 monitoring example).
//
// Bin count default 16: a reasonable compromise between resolution and
// estimator variance for the kinds of single-channel scalars VSBS observes
// (pressure in bar, voltage in V, temperature in C). The fleet baseline is
// supplied by the caller; the monitor never invents one.
// =============================================================================

import type { SensorChannel } from "@vsbs/shared";

/**
 * Structural mirror of `AnomalyVerdict` in `@vsbs/shared/sensors-integrity`.
 * Defined here to avoid an import cycle through shared's main barrel; the
 * Zod schema in shared is the boundary validator. The two definitions are
 * intentionally identical — any change to one must change the other.
 */
export interface AnomalyVerdict {
  vehicleId: string;
  channel: SensorChannel;
  state: "ok" | "suspected" | "anomaly";
  klNats: number;
  threshold: number;
  consecutive: number;
  consecutiveTrigger: number;
  observedAt: string;
}

export interface AnomalyMonitorConfig {
  /** Inclusive lower bound for the histogram domain. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Number of bins. Default 16. */
  bins?: number;
  /** Exponential-decay coefficient for the running histogram. Default 0.01. */
  alpha?: number;
  /** KL-divergence threshold in nats. Default 0.5. */
  thresholdNats?: number;
  /** Consecutive over-threshold samples required to fire. Default 5. */
  consecutiveTrigger?: number;
  /** Optional fleet baseline distribution. If omitted, a uniform prior is
   *  used (equivalent to "no prior knowledge"). Length must equal `bins`. */
  baseline?: number[];
}

const DEFAULT_BINS = 16;
const DEFAULT_ALPHA = 0.01;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_CONSEC = 5;

/** Internal state for one (vehicle, channel) pair. */
interface State {
  vehicleId: string;
  channel: SensorChannel;
  bins: number[]; // observed running pmf, sums to 1.
  baseline: number[]; // fleet baseline pmf, sums to 1.
  consecutive: number;
  klLast: number;
  observedAt: string;
}

/**
 * The monitor — one instance covers a fleet. Lookup by (vehicleId, channel)
 * is O(1) via a Map. State per pair is O(bins) memory.
 */
export class AnomalyMonitor {
  readonly #cfg: Required<Omit<AnomalyMonitorConfig, "baseline">>;
  readonly #defaultBaseline: number[];
  readonly #explicitBaseline: number[] | undefined;
  readonly #state = new Map<string, State>();

  constructor(cfg: AnomalyMonitorConfig) {
    if (!Number.isFinite(cfg.min) || !Number.isFinite(cfg.max) || cfg.max <= cfg.min) {
      throw new Error("AnomalyMonitor: invalid [min,max] domain");
    }
    const bins = cfg.bins ?? DEFAULT_BINS;
    if (bins < 2 || bins > 1024) {
      throw new Error("AnomalyMonitor: bins out of sensible range");
    }
    if (cfg.baseline && cfg.baseline.length !== bins) {
      throw new Error("AnomalyMonitor: baseline length must equal bins");
    }
    this.#cfg = {
      min: cfg.min,
      max: cfg.max,
      bins,
      alpha: cfg.alpha ?? DEFAULT_ALPHA,
      thresholdNats: cfg.thresholdNats ?? DEFAULT_THRESHOLD,
      consecutiveTrigger: cfg.consecutiveTrigger ?? DEFAULT_CONSEC,
    };
    this.#defaultBaseline = uniformPmf(bins);
    this.#explicitBaseline = cfg.baseline ? normalisePmf(cfg.baseline) : undefined;
  }

  /**
   * Ingest a single observation. Returns the current verdict.
   * O(bins) per call; bins is constant, so O(1) per call effectively.
   */
  observe(
    vehicleId: string,
    channel: SensorChannel,
    value: number,
    nowIso: string = new Date().toISOString(),
  ): AnomalyVerdict {
    if (!Number.isFinite(value)) {
      // Non-finite values cannot enter the histogram. Treat as a missing
      // sample for distribution-tracking purposes, but bump `consecutive`
      // so a sustained dropout still escalates.
      const st = this.#getOrCreate(vehicleId, channel);
      st.consecutive = Math.min(st.consecutive + 1, this.#cfg.consecutiveTrigger);
      st.klLast = Number.POSITIVE_INFINITY;
      st.observedAt = nowIso;
      return this.#verdict(st);
    }
    const st = this.#getOrCreate(vehicleId, channel);
    const bin = bucket(value, this.#cfg.min, this.#cfg.max, this.#cfg.bins);
    decayUpdate(st.bins, bin, this.#cfg.alpha);
    const kl = klDivergence(st.bins, st.baseline);
    st.klLast = kl;
    st.observedAt = nowIso;
    if (kl > this.#cfg.thresholdNats) {
      st.consecutive = Math.min(st.consecutive + 1, this.#cfg.consecutiveTrigger);
    } else {
      st.consecutive = 0;
    }
    return this.#verdict(st);
  }

  /** Reset state for a (vehicle, channel) pair. */
  reset(vehicleId: string, channel: SensorChannel): void {
    this.#state.delete(this.#key(vehicleId, channel));
  }

  /** Read-only snapshot for debugging / tests. */
  snapshot(vehicleId: string, channel: SensorChannel): {
    bins: number[];
    baseline: number[];
    klLast: number;
    consecutive: number;
  } | undefined {
    const st = this.#state.get(this.#key(vehicleId, channel));
    if (!st) return undefined;
    return {
      bins: st.bins.slice(),
      baseline: st.baseline.slice(),
      klLast: st.klLast,
      consecutive: st.consecutive,
    };
  }

  #key(vehicleId: string, channel: SensorChannel): string {
    return `${vehicleId}::${channel}`;
  }

  #getOrCreate(vehicleId: string, channel: SensorChannel): State {
    const key = this.#key(vehicleId, channel);
    let st = this.#state.get(key);
    if (st) return st;
    const baseline =
      (this.#explicitBaseline ?? this.#defaultBaseline).slice();
    st = {
      vehicleId,
      channel,
      bins: baseline.slice(),
      baseline,
      consecutive: 0,
      klLast: 0,
      observedAt: new Date(0).toISOString(),
    };
    this.#state.set(key, st);
    return st;
  }

  #verdict(st: State): AnomalyVerdict {
    const trig = this.#cfg.consecutiveTrigger;
    const state: AnomalyVerdict["state"] =
      st.consecutive >= trig
        ? "anomaly"
        : st.consecutive > 0
          ? "suspected"
          : "ok";
    return {
      vehicleId: st.vehicleId,
      channel: st.channel,
      state,
      klNats: Number.isFinite(st.klLast) ? st.klLast : 1e9,
      threshold: this.#cfg.thresholdNats,
      consecutive: st.consecutive,
      consecutiveTrigger: trig,
      observedAt: st.observedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// Fusion integration: synthesise a "sensor-failure" Statement when a
// channel is in the "anomaly" state. Returned objects use the existing
// fusion.Statement shape so callers can splice the result into their list.
// ---------------------------------------------------------------------------

import type { Statement } from "./fusion.js";

export function anomalyStatement(verdict: AnomalyVerdict): Statement | undefined {
  if (verdict.state !== "anomaly") return undefined;
  return {
    claim: `anomaly:${verdict.channel}`,
    evidence: [
      // The verdict is treated as a *contradiction* with trust 1 so the
      // existing arbitration logic resolves it to `sensor-failure` (no
      // independent supports, contradiction dominates).
      {
        channel: verdict.channel,
        agrees: false,
        trust: 1,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (KL, histograms, bucketing).
// ---------------------------------------------------------------------------

export function uniformPmf(n: number): number[] {
  const v = 1 / n;
  const out = new Array<number>(n).fill(v);
  return out;
}

export function normalisePmf(p: number[]): number[] {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i]! < 0 || !Number.isFinite(p[i]!)) {
      throw new Error("normalisePmf: invalid value");
    }
    sum += p[i]!;
  }
  if (sum <= 0) throw new Error("normalisePmf: zero-sum input");
  return p.map((v) => v / sum);
}

/** Map a scalar to a bin index in [0, bins). Out-of-domain → clamped. */
export function bucket(value: number, min: number, max: number, bins: number): number {
  const t = (value - min) / (max - min);
  if (t <= 0) return 0;
  if (t >= 1) return bins - 1;
  return Math.min(bins - 1, Math.floor(t * bins));
}

/**
 * In-place exponential-decay update. Each bin shrinks by (1 - alpha) and
 * the observed bin gains alpha. Result remains a valid pmf provided the
 * input was a valid pmf.
 */
export function decayUpdate(p: number[], bin: number, alpha: number): void {
  for (let i = 0; i < p.length; i++) {
    p[i] = (1 - alpha) * p[i]!;
  }
  p[bin] = p[bin]! + alpha;
}

/**
 * KL(P || Q) in nats. Both inputs must be pmfs of equal length. Bins where
 * P > 0 but Q = 0 yield +infinity, which we cap to 1e9 to keep the metric
 * usable for thresholding.
 */
export function klDivergence(p: number[], q: number[]): number {
  if (p.length !== q.length) {
    throw new Error("klDivergence: length mismatch");
  }
  let kl = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i]!;
    if (pi <= 0) continue;
    const qi = q[i]!;
    if (qi <= 0) return 1e9;
    kl += pi * Math.log(pi / qi);
  }
  return Math.max(0, kl);
}
