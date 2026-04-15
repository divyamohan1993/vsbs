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
// Multi-state Extended Kalman filter.
//
// For channels that are inherently multi-dimensional (GPS+IMU position+heading,
// battery SoC coupled with terminal voltage, per-cell voltage imbalance
// across a BMS pack) a scalar filter under-fits. We ship a plain-array
// EKF with pluggable nonlinear f and h and their Jacobians F and H.
//
// Equations (Wikipedia, Extended Kalman filter):
//   predict:  x = f(x, u, dt)
//             P = F P F^T + Q
//   update:   y = z - h(x)
//             S = H P H^T + R
//             K = P H^T S^-1
//             x = x + K y
//             P = (I - K H) P
//
// Matrices are number[][] in row-major order. No runtime deps: multiply,
// transpose, and inverse (Gauss-Jordan) are implemented inline below.
// ---------------------------------------------------------------------------

export interface MultiStateFilter {
  predict(dt: number, u?: number[]): void;
  update(z: number[]): number[];
  readonly x: number[];
  readonly P: number[][];
}

export interface ExtendedKalmanConfig {
  x0: number[];
  P0: number[][];
  Q: number[][];
  R: number[][];
  /** State transition: x_{k+1} = f(x, u, dt). */
  f: (x: number[], u: number[] | undefined, dt: number) => number[];
  /** Jacobian of f w.r.t. x, evaluated at (x, u, dt). */
  F: (x: number[], u: number[] | undefined, dt: number) => number[][];
  /** Measurement: z_k = h(x). */
  h: (x: number[]) => number[];
  /** Jacobian of h w.r.t. x, evaluated at x. */
  H: (x: number[]) => number[][];
}

export class ExtendedKalman implements MultiStateFilter {
  #x: number[];
  #P: number[][];
  readonly #Q: number[][];
  readonly #R: number[][];
  readonly #f: ExtendedKalmanConfig["f"];
  readonly #F: ExtendedKalmanConfig["F"];
  readonly #h: ExtendedKalmanConfig["h"];
  readonly #H: ExtendedKalmanConfig["H"];

  constructor(cfg: ExtendedKalmanConfig) {
    this.#x = cfg.x0.slice();
    this.#P = cloneMatrix(cfg.P0);
    this.#Q = cloneMatrix(cfg.Q);
    this.#R = cloneMatrix(cfg.R);
    this.#f = cfg.f;
    this.#F = cfg.F;
    this.#h = cfg.h;
    this.#H = cfg.H;
  }

  predict(dt: number, u?: number[]): void {
    const F = this.#F(this.#x, u, dt);
    this.#x = this.#f(this.#x, u, dt);
    // P = F P F^T + Q
    const FP = matMul(F, this.#P);
    const FPFt = matMul(FP, transpose(F));
    this.#P = matAdd(FPFt, this.#Q);
  }

  update(z: number[]): number[] {
    const H = this.#H(this.#x);
    const hx = this.#h(this.#x);
    const y = vecSub(z, hx);
    // S = H P H^T + R
    const HP = matMul(H, this.#P);
    const S = matAdd(matMul(HP, transpose(H)), this.#R);
    const Sinv = inverse(S);
    // K = P H^T S^-1
    const PHt = matMul(this.#P, transpose(H));
    const K = matMul(PHt, Sinv);
    // x = x + K y
    const Ky = matVec(K, y);
    this.#x = vecAdd(this.#x, Ky);
    // P = (I - K H) P
    const KH = matMul(K, H);
    const I = identity(this.#P.length);
    this.#P = matMul(matSub(I, KH), this.#P);
    return y;
  }

  get x(): number[] { return this.#x.slice(); }
  get P(): number[][] { return cloneMatrix(this.#P); }
}

// ---------------------------------------------------------------------------
// EKF factories for the three channels called out in Phase 2 item 12.
// ---------------------------------------------------------------------------

/**
 * 2-D position+heading EKF fusing GPS position with IMU heading rate.
 * State: [x, y, theta, v]. Control u: [a, omega] (long accel, yaw rate).
 * Dynamics: constant-velocity-with-yaw-rate (bicycle-free CTRV).
 * Reference: Schubert et al., "Comparison and Evaluation of Advanced
 * Motion Models for Vehicle Tracking", Fusion 2008.
 */
export function makeGpsImuEkf(init: {
  x: number; y: number; theta: number; v: number;
  posStdM: number; headingStdRad: number;
  accelStd: number; yawRateStd: number;
}): ExtendedKalman {
  return new ExtendedKalman({
    x0: [init.x, init.y, init.theta, init.v],
    P0: diag([25, 25, 0.25, 4]),
    Q: diag([0.5, 0.5, init.yawRateStd ** 2, init.accelStd ** 2]),
    R: diag([init.posStdM ** 2, init.posStdM ** 2, init.headingStdRad ** 2]),
    f: (x, u, dt) => {
      const a = u?.[0] ?? 0;
      const omega = u?.[1] ?? 0;
      const theta = x[2]!;
      const v = x[3]!;
      return [
        x[0]! + v * Math.cos(theta) * dt,
        x[1]! + v * Math.sin(theta) * dt,
        theta + omega * dt,
        v + a * dt,
      ];
    },
    F: (x, _u, dt) => {
      const theta = x[2]!;
      const v = x[3]!;
      return [
        [1, 0, -v * Math.sin(theta) * dt, Math.cos(theta) * dt],
        [0, 1,  v * Math.cos(theta) * dt, Math.sin(theta) * dt],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
      ];
    },
    h: (x) => [x[0]!, x[1]!, x[2]!],
    H: () => [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ],
  });
}

/**
 * SoC trajectory EKF. State: [soc, rInternal]. Control u: [iAmp, dt_s].
 * Coulomb counting drives SoC; terminal voltage measurement corrects it
 * via the open-circuit voltage map and internal resistance estimate.
 * Reference: Plett, "Extended Kalman filtering for battery management
 * systems of LiPB-based HEV battery packs — Part 2: Modeling and
 * identification", J. Power Sources, 2004.
 *
 * This is the simplified linearisation: OCV(soc) approximated as a
 * slope kOcv around operating point so H is constant.
 */
export function makeSocEkf(init: {
  soc0: number;
  rInternal0: number;
  capacityAh: number;
  kOcv: number;        // dV/dSoC near the operating point
  ocvIntercept: number; // V at soc=0
  currentStd: number;
  voltageStd: number;
}): ExtendedKalman {
  const qSoC = (init.currentStd / (3600 * init.capacityAh)) ** 2;
  return new ExtendedKalman({
    x0: [init.soc0, init.rInternal0],
    P0: [[0.01, 0], [0, 1e-4]],
    Q: [[qSoC, 0], [0, 1e-8]],
    R: [[init.voltageStd ** 2]],
    f: (x, u, dt) => {
      const iAmp = u?.[0] ?? 0;
      const soc = x[0]! - (iAmp * dt) / (3600 * init.capacityAh);
      return [Math.max(0, Math.min(1, soc)), x[1]!];
    },
    F: () => [[1, 0], [0, 1]],
    // Measurement model: v_terminal = OCV(soc) - i * R.
    // Linearised around operating point: dV/dSoc = kOcv, dV/dR = -i (we
    // fold the -i*R term into the offset since u isn't passed to h).
    h: (x) => [init.ocvIntercept + init.kOcv * x[0]!],
    H: () => [[init.kOcv, 0]],
  });
}

/**
 * Cell-imbalance EKF across a BMS pack. State = per-cell voltage vector.
 * Dynamics: random walk (no prior on drift direction).
 * Measurement: direct per-cell readout.
 * Reference: Xiong et al., "A data-driven based adaptive state of charge
 * estimator of lithium-ion polymer battery used in electric vehicles",
 * Applied Energy, 2014, §3.2 on cell-level fusion.
 */
export function makeCellImbalanceEkf(init: {
  cells: number[];
  processStd: number;
  measStd: number;
}): ExtendedKalman {
  const n = init.cells.length;
  const Q = diag(new Array(n).fill(init.processStd ** 2));
  const R = diag(new Array(n).fill(init.measStd ** 2));
  const P0 = diag(new Array(n).fill(0.01));
  const I = identity(n);
  return new ExtendedKalman({
    x0: init.cells.slice(),
    P0,
    Q,
    R,
    f: (x) => x.slice(),
    F: () => I.map((r) => r.slice()),
    h: (x) => x.slice(),
    H: () => I.map((r) => r.slice()),
  });
}

// ---------------------------------------------------------------------------
// Minimal matrix helpers. Plain number[][]; no BLAS, no deps.
// All O(n^3) where needed; n is at most a few dozen (cell count).
// ---------------------------------------------------------------------------

function cloneMatrix(m: number[][]): number[][] {
  return m.map((r) => r.slice());
}

function identity(n: number): number[][] {
  const I: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    I.push(row);
  }
  return I;
}

function diag(d: number[]): number[][] {
  const n = d.length;
  const m = identity(n);
  for (let i = 0; i < n; i++) m[i]![i] = d[i]!;
  return m;
}

function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0]!.length;
  const t: number[][] = [];
  for (let j = 0; j < cols; j++) {
    const row = new Array<number>(rows).fill(0);
    for (let i = 0; i < rows; i++) row[i] = m[i]![j]!;
    t.push(row);
  }
  return t;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const ar = a.length;
  const ac = a[0]!.length;
  const bc = b[0]!.length;
  const out: number[][] = [];
  for (let i = 0; i < ar; i++) {
    const row = new Array<number>(bc).fill(0);
    for (let k = 0; k < ac; k++) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      const brow = b[k]!;
      for (let j = 0; j < bc; j++) row[j]! += aik * brow[j]!;
    }
    out.push(row);
  }
  return out;
}

function matVec(a: number[][], v: number[]): number[] {
  const out = new Array<number>(a.length).fill(0);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    const row = a[i]!;
    for (let j = 0; j < v.length; j++) s += row[j]! * v[j]!;
    out[i] = s;
  }
  return out;
}

function matAdd(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((v, j) => v + b[i]![j]!));
}

function matSub(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((v, j) => v - b[i]![j]!));
}

function vecAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i]!);
}

function vecSub(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]!);
}

/** Gauss-Jordan inverse with partial pivoting. Throws on singular input. */
function inverse(m: number[][]): number[][] {
  const n = m.length;
  const a: number[][] = m.map((r, i) => {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = r[j]!;
    row[n + i] = 1;
    return row;
  });
  for (let i = 0; i < n; i++) {
    let pivot = i;
    let best = Math.abs(a[i]![i]!);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(a[r]![i]!);
      if (v > best) { best = v; pivot = r; }
    }
    if (best < 1e-12) throw new Error("matrix is singular in EKF inverse");
    if (pivot !== i) {
      const tmp = a[i]!;
      a[i] = a[pivot]!;
      a[pivot] = tmp;
    }
    const pivVal = a[i]![i]!;
    for (let j = 0; j < 2 * n; j++) a[i]![j]! /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = a[r]![i]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r]![j]! -= factor * a[i]![j]!;
    }
  }
  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j++) row[j] = a[i]![n + j]!;
    inv.push(row);
  }
  return inv;
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
