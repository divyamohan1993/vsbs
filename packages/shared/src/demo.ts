// =============================================================================
// Demo / sim / live mode primitives, shared across packages.
// See docs/simulation-policy.md for the invariant this enforces.
// =============================================================================

export const DriverMode = {
  SIM: "sim",
  LIVE: "live",
  MIXED: "mixed",
} as const;
export type DriverMode = (typeof DriverMode)[keyof typeof DriverMode];

export function parseDriverMode(raw: string | undefined, fallback: DriverMode): DriverMode {
  if (raw === "sim" || raw === "live" || raw === "mixed") return raw;
  return fallback;
}

/**
 * Every simulated artefact the system emits carries this envelope so
 * downstream code can never confuse a simulated event with a real one.
 * The `chain` field links an event to the upstream simulation that
 * caused it, for reproducibility.
 */
export interface SimEnvelope<T> {
  origin: "sim" | "live";
  env: "demo" | "staging" | "production";
  ts: string;
  vendor: string;
  operation: string;
  chainId: string;
  body: T;
}

/**
 * Deterministic seeded RNG — Mulberry32.
 * Simulators MUST draw randomness from this generator, seeded per
 * test / per session, so failures are replayable.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a plausible latency in ms from a log-normal distribution. */
export function simLatency(rng: () => number, medianMs: number, sigma: number): number {
  // Box-Muller on a seeded RNG.
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(medianMs * Math.exp(sigma * z));
}
