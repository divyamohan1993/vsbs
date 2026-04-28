// =============================================================================
// HealthChecker registry. Aggregates per-dependency liveness/readiness probes
// into a single status that backs `/readyz` and `/healthz/details`.
//
// Built-in checks (sim drivers always available, live drivers gated by env):
//   - alloydb-ping
//   - firestore-ping
//   - secret-manager-list
//   - llm-provider-ping
//
// Each check returns latency in ms, status, and an optional message. Results
// are cached for `cacheTtlMs` (default 5_000 ms) so a hot probe loop does not
// hammer dependencies.
// =============================================================================

export type CheckStatus = "healthy" | "degraded" | "unhealthy";

export interface CheckResult {
  status: CheckStatus;
  latency_ms: number;
  message?: string;
  /** ISO timestamp of the most recent successful run. */
  lastSuccess?: string;
}

export interface HealthReport {
  status: CheckStatus;
  checks: Record<string, CheckResult>;
  /** Overall ISO timestamp at which the report was assembled. */
  ts: string;
}

export type CheckFn = () => Promise<Omit<CheckResult, "lastSuccess">>;

interface CachedEntry {
  result: CheckResult;
  expiresAt: number;
}

export interface HealthCheckerOptions {
  /** TTL for cached results, in ms. Default 5000. */
  cacheTtlMs?: number;
  /** Per-check timeout, in ms. Default 2000. */
  timeoutMs?: number;
  /** Optional clock injection for tests. */
  now?: () => number;
}

export class HealthChecker {
  readonly #fns = new Map<string, CheckFn>();
  readonly #cache = new Map<string, CachedEntry>();
  readonly #lastSuccess = new Map<string, string>();
  readonly #ttl: number;
  readonly #timeout: number;
  readonly #now: () => number;

  constructor(opts: HealthCheckerOptions = {}) {
    this.#ttl = opts.cacheTtlMs ?? 5_000;
    this.#timeout = opts.timeoutMs ?? 2_000;
    this.#now = opts.now ?? Date.now;
  }

  register(name: string, fn: CheckFn): this {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) {
      throw new Error(`Invalid health check name: ${name}`);
    }
    this.#fns.set(name, fn);
    return this;
  }

  unregister(name: string): boolean {
    this.#cache.delete(name);
    return this.#fns.delete(name);
  }

  list(): string[] {
    return [...this.#fns.keys()];
  }

  /** Run all registered checks in parallel with a cache + timeout per check. */
  async runAll(): Promise<HealthReport> {
    const names = [...this.#fns.keys()];
    const results = await Promise.all(names.map((n) => this.runOne(n)));
    const checks: Record<string, CheckResult> = {};
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      const r = results[i];
      if (n === undefined || r === undefined) continue;
      checks[n] = r;
    }
    const status = aggregate(Object.values(checks));
    return { status, checks, ts: new Date(this.#now()).toISOString() };
  }

  async runOne(name: string): Promise<CheckResult> {
    const fn = this.#fns.get(name);
    if (!fn) {
      return {
        status: "unhealthy",
        latency_ms: 0,
        message: `unknown check: ${name}`,
      };
    }
    const cached = this.#cache.get(name);
    const now = this.#now();
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }
    const started = now;
    let result: CheckResult;
    try {
      const r = await withTimeout(fn(), this.#timeout);
      const latency = this.#now() - started;
      result = { ...r, latency_ms: r.latency_ms ?? latency };
      if (result.status === "healthy") {
        const ts = new Date(this.#now()).toISOString();
        this.#lastSuccess.set(name, ts);
        result = { ...result, lastSuccess: ts };
      } else {
        const last = this.#lastSuccess.get(name);
        if (last !== undefined) result = { ...result, lastSuccess: last };
      }
    } catch (err) {
      const latency = this.#now() - started;
      result = {
        status: "unhealthy",
        latency_ms: latency,
        message: err instanceof Error ? err.message : String(err),
      };
      const last = this.#lastSuccess.get(name);
      if (last !== undefined) result = { ...result, lastSuccess: last };
    }
    this.#cache.set(name, { result, expiresAt: this.#now() + this.#ttl });
    return result;
  }

  /** Drop cached entries - used by tests and admin "force re-check" buttons. */
  invalidate(name?: string): void {
    if (name === undefined) {
      this.#cache.clear();
      return;
    }
    this.#cache.delete(name);
  }
}

function aggregate(results: CheckResult[]): CheckStatus {
  if (results.length === 0) return "healthy";
  let degraded = false;
  for (const r of results) {
    if (r.status === "unhealthy") return "unhealthy";
    if (r.status === "degraded") degraded = true;
  }
  return degraded ? "degraded" : "healthy";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

// -----------------------------------------------------------------------------
// Built-in check factories. Each accepts a sim/live mode and a tiny config
// surface; the live driver makes a *real* call (or a thin TCP/HTTP probe);
// the sim driver returns a deterministic healthy-with-jitter result.
// -----------------------------------------------------------------------------

export interface SimOpts {
  jitterMs?: number;
}

function simLatency(j = 5): number {
  return Math.floor(Math.random() * j) + 1;
}

export function makeAlloyDbPing(opts: { mode: "sim" | "live"; ping?: () => Promise<void> } & SimOpts): CheckFn {
  return async () => {
    if (opts.mode === "sim") {
      return { status: "healthy", latency_ms: simLatency(opts.jitterMs) };
    }
    if (!opts.ping) {
      return { status: "unhealthy", latency_ms: 0, message: "live mode without ping fn" };
    }
    const t = Date.now();
    await opts.ping();
    return { status: "healthy", latency_ms: Date.now() - t };
  };
}

export function makeFirestorePing(opts: { mode: "sim" | "live"; ping?: () => Promise<void> } & SimOpts): CheckFn {
  return async () => {
    if (opts.mode === "sim") {
      return { status: "healthy", latency_ms: simLatency(opts.jitterMs) };
    }
    if (!opts.ping) {
      return { status: "unhealthy", latency_ms: 0, message: "live mode without ping fn" };
    }
    const t = Date.now();
    await opts.ping();
    return { status: "healthy", latency_ms: Date.now() - t };
  };
}

export function makeSecretManagerList(opts: { mode: "sim" | "live"; list?: () => Promise<string[]> } & SimOpts): CheckFn {
  return async () => {
    if (opts.mode === "sim") {
      return { status: "healthy", latency_ms: simLatency(opts.jitterMs), message: "sim: 0 secrets visible" };
    }
    if (!opts.list) {
      return { status: "unhealthy", latency_ms: 0, message: "live mode without list fn" };
    }
    const t = Date.now();
    const names = await opts.list();
    return {
      status: "healthy",
      latency_ms: Date.now() - t,
      message: `${names.length} secrets visible`,
    };
  };
}

export function makeLlmProviderPing(opts: { mode: "sim" | "live"; ping?: () => Promise<void> } & SimOpts): CheckFn {
  return async () => {
    if (opts.mode === "sim") {
      return { status: "healthy", latency_ms: simLatency(opts.jitterMs) };
    }
    if (!opts.ping) {
      return { status: "unhealthy", latency_ms: 0, message: "live mode without ping fn" };
    }
    const t = Date.now();
    await opts.ping();
    return { status: "healthy", latency_ms: Date.now() - t };
  };
}
