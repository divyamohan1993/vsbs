// =============================================================================
// Grant heartbeat — short-TTL liveness loop with auto-revoke.
//
// Why this file exists:
//   A CommandGrant is a *bounded* capability. Bounding it only by `notAfter`
//   lets a misbehaving service-centre keep driving for the full grant
//   lifetime even after a tier-1 safety signal flips. That is unacceptable
//   for an autonomous handover. The heartbeat closes the loop:
//
//     - The runner ticks at `intervalMs` (default 1 s).
//     - Each tick calls a caller-supplied safety evaluator.
//     - tier1Healthy === false fires an immediate revocation. No debounce.
//     - `maxMissedBeats` consecutive evaluator failures (throws / timeouts)
//       also fire a revocation: silence is not consent.
//     - Default grant TTL is 5 minutes — well below the maximum allowed
//       AUTONOMY_MAX_GRANT_SECONDS in `constants.ts`. Heartbeat policy
//       never extends the grant; it only shortens it.
//
// References:
//   docs/research/autonomy.md §5 — capability tokens must be revocable in
//     under one second on a tier-1 flip (UNECE R157 §5.1.5).
//   ISO 21448 (SOTIF) §7 — degraded operation requires explicit liveness.
//
// The runner exposes a deterministic test driver that lets tests advance a
// virtual clock without depending on real `setInterval`. This keeps unit
// tests millisecond-deterministic while preserving the live runtime path.
// =============================================================================

import { z } from "zod";

export const HeartbeatPolicySchema = z
  .object({
    /** Tick period in ms. */
    intervalMs: z.number().int().positive().max(60_000).default(1_000),
    /** Consecutive missed/throwing beats before auto-revoke. */
    maxMissedBeats: z.number().int().positive().max(60).default(3),
    /** Default TTL applied to grants under this policy. Capped at 5 minutes. */
    defaultGrantTtlMs: z
      .number()
      .int()
      .positive()
      .max(300_000)
      .default(300_000),
    /** Hard rule: a tier-1 flip immediately revokes. Never overridable. */
    tier1RevocationOnFlip: z.literal(true).default(true),
  })
  .strict();
export type HeartbeatPolicy = z.infer<typeof HeartbeatPolicySchema>;

export interface HeartbeatEvaluation {
  tier1Healthy: boolean;
  reasons: string[];
}

export type HeartbeatEvaluator = () => Promise<HeartbeatEvaluation>;

export interface HeartbeatRevocation {
  grantId: string;
  reason: string;
  reasons: string[];
  at: string;
}

export type HeartbeatRevocationHook = (rev: HeartbeatRevocation) => Promise<void> | void;

/**
 * Injectable clock — the live runner uses Date.now + setInterval; the
 * deterministic test driver swaps both. Both share the same loop.
 */
export interface HeartbeatClock {
  now(): number;
  setInterval(handler: () => void, ms: number): { stop(): void };
}

export const liveHeartbeatClock: HeartbeatClock = {
  now: () => Date.now(),
  setInterval(handler: () => void, ms: number) {
    const id = setInterval(handler, ms);
    return {
      stop(): void {
        clearInterval(id);
      },
    };
  },
};

/**
 * Deterministic clock for tests. `tick(ms)` advances the virtual clock and
 * fires every interval whose period has elapsed. Multiple intervals are
 * fired in registration order; ordering matters for the m-of-n flip tests.
 */
export class FakeHeartbeatClock implements HeartbeatClock {
  #now = 0;
  readonly #handlers: Array<{ id: number; handler: () => void; period: number; nextFireAt: number }> = [];
  #nextId = 1;

  now(): number {
    return this.#now;
  }

  setInterval(handler: () => void, ms: number): { stop(): void } {
    const id = this.#nextId++;
    this.#handlers.push({ id, handler, period: ms, nextFireAt: this.#now + ms });
    return {
      stop: () => {
        const idx = this.#handlers.findIndex((h) => h.id === id);
        if (idx >= 0) this.#handlers.splice(idx, 1);
      },
    };
  }

  /**
   * Advance virtual time by `ms`. Fires every interval whose period elapses
   * during the advance. If multiple intervals fire in the same step they
   * fire in registration order.
   */
  async tick(ms: number): Promise<void> {
    const target = this.#now + ms;
    while (true) {
      let earliest = Number.POSITIVE_INFINITY;
      for (const h of this.#handlers) {
        if (h.nextFireAt <= target && h.nextFireAt < earliest) earliest = h.nextFireAt;
      }
      if (earliest === Number.POSITIVE_INFINITY) break;
      this.#now = earliest;
      const due = this.#handlers.filter((h) => h.nextFireAt === earliest).slice();
      for (const h of due) {
        h.nextFireAt = earliest + h.period;
        h.handler();
      }
      await Promise.resolve();
    }
    this.#now = target;
  }
}

interface RunnerEntry {
  evaluator: HeartbeatEvaluator;
  policy: HeartbeatPolicy;
  missed: number;
  active: boolean;
  inFlight: Promise<void> | null;
  ticker: { stop(): void };
}

/**
 * HeartbeatRunner runs N grants concurrently. Each grant has its own ticker.
 * stop() is idempotent. The runner never re-issues a revocation: once a
 * grant flips to revoked the entry is detached and ignored.
 */
export class HeartbeatRunner {
  readonly #clock: HeartbeatClock;
  readonly #onRevoke: HeartbeatRevocationHook;
  readonly #entries = new Map<string, RunnerEntry>();

  constructor(opts: { clock?: HeartbeatClock; onRevoke: HeartbeatRevocationHook }) {
    this.#clock = opts.clock ?? liveHeartbeatClock;
    this.#onRevoke = opts.onRevoke;
  }

  start(grantId: string, policyInput: Partial<HeartbeatPolicy>, evaluator: HeartbeatEvaluator): void {
    if (this.#entries.has(grantId)) {
      throw new Error(`heartbeat already running for grant ${grantId}`);
    }
    const policy = HeartbeatPolicySchema.parse(policyInput);
    const entry: RunnerEntry = {
      evaluator,
      policy,
      missed: 0,
      active: true,
      inFlight: null,
      ticker: { stop(): void {} },
    };
    entry.ticker = this.#clock.setInterval(() => {
      if (!entry.active) return;
      if (entry.inFlight) return;
      entry.inFlight = this.#tickOnce(grantId, entry).finally(() => {
        entry.inFlight = null;
      });
    }, policy.intervalMs);
    this.#entries.set(grantId, entry);
  }

  stop(grantId: string): void {
    const entry = this.#entries.get(grantId);
    if (!entry) return;
    entry.active = false;
    entry.ticker.stop();
    this.#entries.delete(grantId);
  }

  isRunning(grantId: string): boolean {
    return this.#entries.has(grantId);
  }

  /**
   * Test-only hook. Awaits any in-flight evaluation so a test can read state
   * deterministically after `clock.tick(...)`.
   */
  async drain(): Promise<void> {
    const inflights = Array.from(this.#entries.values())
      .map((e) => e.inFlight)
      .filter((p): p is Promise<void> => p !== null);
    if (inflights.length > 0) await Promise.all(inflights);
  }

  async #tickOnce(grantId: string, entry: RunnerEntry): Promise<void> {
    let result: HeartbeatEvaluation | null = null;
    try {
      result = await entry.evaluator();
    } catch (err) {
      entry.missed += 1;
      if (entry.missed >= entry.policy.maxMissedBeats) {
        await this.#fireRevoke(grantId, entry, "missed-beats", [
          `evaluator failed ${entry.missed} times`,
          String(err),
        ]);
      }
      return;
    }
    if (!result.tier1Healthy) {
      await this.#fireRevoke(grantId, entry, "tier1-flip", result.reasons);
      return;
    }
    entry.missed = 0;
  }

  async #fireRevoke(
    grantId: string,
    entry: RunnerEntry,
    reason: string,
    reasons: string[],
  ): Promise<void> {
    if (!entry.active) return;
    entry.active = false;
    entry.ticker.stop();
    this.#entries.delete(grantId);
    await this.#onRevoke({
      grantId,
      reason,
      reasons,
      at: new Date(this.#clock.now()).toISOString(),
    });
  }
}
