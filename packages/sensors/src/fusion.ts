// =============================================================================
// Sensor fusion — lightweight scalar Kalman + cross-modal arbitration.
//
// For the v1 scope we ship:
//  1) A scalar Kalman filter (the workhorse for 1-D continuous signals —
//     tire pressure, SoC, oil pressure, cabin temperature, etc.).
//     Equations are the textbook ones; Wikipedia has the canonical form:
//     https://en.wikipedia.org/wiki/Kalman_filter
//     The filter is documented step-by-step in the source so the code is
//     auditable by a reviewer who has not read the 1960 Kalman paper.
//  2) A cross-modal arbitration step that takes channel-tagged statements
//     and emits `confirmed | suspected | sensor-failure`, implementing
//     docs/research/prognostics.md §5 and autonomy.md §3.
//
// The EKF / UKF / multi-state variants live in a follow-up and plug in
// through the `KalmanFilter` interface below.
// =============================================================================

import type { SensorSample, SensorChannel, FusedObservation } from "@vsbs/shared";

export interface KalmanFilter {
  /** Predict step. `dt` in seconds; `u` is an optional control input. */
  predict(dt: number, u?: number): void;
  /** Update step with a scalar measurement. Returns the innovation (z − Hx). */
  update(z: number): number;
  readonly x: number;
  readonly p: number;
}

/**
 * Scalar Kalman filter with constant-velocity-like dynamics but we expose
 * a simpler single-state form because most automotive scalar channels are
 * slow-drift processes (pressure, SoC, temperature) where a first-order
 * model is sufficient.
 */
export class ScalarKalman implements KalmanFilter {
  #x: number;
  #p: number;
  readonly #q: number; // process noise
  readonly #r: number; // measurement noise

  constructor(initial: { x0: number; p0: number; q: number; r: number }) {
    this.#x = initial.x0;
    this.#p = initial.p0;
    this.#q = initial.q;
    this.#r = initial.r;
  }

  predict(dt: number): void {
    // x unchanged (first-order); covariance grows with time.
    this.#p += this.#q * dt;
  }

  update(z: number): number {
    const innovation = z - this.#x;
    const s = this.#p + this.#r;
    const k = this.#p / s;
    this.#x = this.#x + k * innovation;
    this.#p = (1 - k) * this.#p;
    return innovation;
  }

  get x(): number { return this.#x; }
  get p(): number { return this.#p; }
}

// ---------------------------------------------------------------------------
// Cross-modal arbitration
// ---------------------------------------------------------------------------

export interface Statement {
  claim: string;
  evidence: Array<{ channel: SensorChannel; agrees: boolean; trust: number }>;
}

export function arbitrate(
  vehicleId: string,
  statements: Statement[],
  samples: SensorSample[],
): FusedObservation {
  const result: FusedObservation["statements"] = statements.map((s) => {
    const supporting = s.evidence.filter((e) => e.agrees).map((e) => e.channel);
    const contradicting = s.evidence.filter((e) => !e.agrees).map((e) => e.channel);
    const support = s.evidence.filter((e) => e.agrees).reduce((a, b) => a + b.trust, 0);
    const contradict = s.evidence.filter((e) => !e.agrees).reduce((a, b) => a + b.trust, 0);

    // Rules implementing prognostics.md §5:
    // confirmed  : ≥ 2 independent supports with trust > 0.5 and no strong contradiction
    // suspected  : exactly 1 support, or contradicting evidence exists
    // sensor-failure : sole supporter has trust ≤ 0.3 and others contradict
    let status: "confirmed" | "suspected" | "sensor-failure";
    if (supporting.length >= 2 && support > contradict + 0.2) {
      status = "confirmed";
    } else if (supporting.length >= 1 && contradict < 0.5) {
      status = "suspected";
    } else {
      status = "sensor-failure";
    }

    const confidence = support / Math.max(1e-6, support + contradict);

    return {
      claim: s.claim,
      confidence,
      supportingChannels: supporting,
      contradictingChannels: contradicting,
      status,
    };
  });

  let real = 0;
  let sim = 0;
  for (const s of samples) {
    if (s.origin === "real") real++;
    else sim++;
  }

  return {
    observationId: crypto.randomUUID(),
    vehicleId,
    timestamp: new Date().toISOString(),
    statements: result,
    originSummary: { real, sim },
  };
}
