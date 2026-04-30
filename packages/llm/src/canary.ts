// =============================================================================
// Canary router — deterministic hash-based traffic split between the pinned
// model and a candidate canary model. The split is per-conversation (so a
// single conversation's experience is consistent), uses a stable hash of
// the conversationId, and records pinned-vs-canary verdicts so a downstream
// regression-eval can compute drift.
//
// Default canary percent is 0 (i.e. canary disabled). Routing is purely a
// function of (conversationId, canaryPercent) — never a stochastic call.
// This means a single conversation always lands on the same arm regardless
// of process restarts.
//
// The eval-gate hook is an interface only; the actual eval batch is in
// @vsbs/agents (it depends on agent state). Recording is sync, append-only.
// =============================================================================

import { createHash } from "node:crypto";
import { z } from "zod";

import type { AgentRole } from "./roles.js";
import type { ModelPin } from "./version-pin.js";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

export const CanaryRouterSchema = z.object({
  /** Per-role canary candidates. Roles missing from this map have canary disabled. */
  candidates: z.record(z.string(), z.lazy(() => CanaryCandidateSchema)),
  /** [0, 100]. Percent of conversations to send to the candidate. Default 0. */
  canaryPercent: z.number().min(0).max(100).default(0),
  /** Optional salt mixed into the hash so we can re-shuffle without rotating model ids. */
  routingSalt: z.string().default(""),
});

export const CanaryCandidateSchema: z.ZodType<{
  provider: string;
  modelId: string;
  version: string;
  reason: string;
}> = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
  version: z.string().min(1),
  /** Free-form reason this canary is being evaluated. */
  reason: z.string().min(1),
});

export type CanaryCandidate = z.infer<typeof CanaryCandidateSchema>;
export type CanaryRouterConfig = z.infer<typeof CanaryRouterSchema>;

// -----------------------------------------------------------------------------
// Routing decision
// -----------------------------------------------------------------------------

export type CanaryArm = "pinned" | "canary";

export interface CanaryRoutingDecision {
  arm: CanaryArm;
  role: AgentRole;
  conversationId: string;
  pinned: { provider: string; modelId: string; version: string };
  canary?:
    | { provider: string; modelId: string; version: string; reason: string }
    | undefined;
  /** [0, 100]. The deterministic hash bucket the conversation landed in. */
  bucket: number;
  /** [0, 100]. The threshold below which the conversation routes to the canary. */
  threshold: number;
}

// -----------------------------------------------------------------------------
// Recording — append-only audit log of every routing decision plus the
// pinned-vs-canary verdict pair so a downstream eval can compute drift.
// -----------------------------------------------------------------------------

export interface CanaryCallRecord {
  at: string;
  role: AgentRole;
  conversationId: string;
  arm: CanaryArm;
  pinnedModel: string;
  canaryModel?: string | undefined;
  /** Optional verdict from the active arm — opaque payload. */
  verdict?: unknown;
  /** Optional shadow verdict from the OTHER arm (used for drift compute). */
  shadowVerdict?: unknown;
}

export interface CanaryRecorder {
  recordRoute(decision: CanaryRoutingDecision): void;
  recordCall(record: CanaryCallRecord): void;
  records(): readonly CanaryCallRecord[];
  routes(): readonly CanaryRoutingDecision[];
}

export class InMemoryCanaryRecorder implements CanaryRecorder {
  readonly #routes: CanaryRoutingDecision[] = [];
  readonly #records: CanaryCallRecord[] = [];

  recordRoute(decision: CanaryRoutingDecision): void {
    this.#routes.push(decision);
  }

  recordCall(record: CanaryCallRecord): void {
    this.#records.push(record);
  }

  records(): readonly CanaryCallRecord[] {
    return this.#records;
  }

  routes(): readonly CanaryRoutingDecision[] {
    return this.#routes;
  }
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export class CanaryRouter {
  readonly #config: CanaryRouterConfig;
  readonly #recorder: CanaryRecorder;

  constructor(config: CanaryRouterConfig, recorder?: CanaryRecorder) {
    this.#config = CanaryRouterSchema.parse(config);
    this.#recorder = recorder ?? new InMemoryCanaryRecorder();
  }

  get recorder(): CanaryRecorder {
    return this.#recorder;
  }

  get canaryPercent(): number {
    return this.#config.canaryPercent;
  }

  /**
   * Route a single (role, conversationId) to either the pinned model or the
   * canary candidate, deterministically. Records the decision.
   */
  route(role: AgentRole, conversationId: string, pinned: ModelPin): CanaryRoutingDecision {
    const candidate = this.#config.candidates[role];
    const bucket = bucketFor(conversationId, this.#config.routingSalt);
    const threshold = candidate ? this.#config.canaryPercent : 0;
    const arm: CanaryArm = bucket < threshold ? "canary" : "pinned";
    const decision: CanaryRoutingDecision = {
      arm,
      role,
      conversationId,
      pinned: { provider: pinned.provider, modelId: pinned.modelId, version: pinned.version },
      ...(candidate
        ? {
            canary: {
              provider: candidate.provider,
              modelId: candidate.modelId,
              version: candidate.version,
              reason: candidate.reason,
            },
          }
        : {}),
      bucket,
      threshold,
    };
    this.#recorder.recordRoute(decision);
    return decision;
  }

  /**
   * Append a call record (typically with the active arm's verdict). The eval
   * harness in @vsbs/agents reads these via `recorder.records()`.
   */
  recordCall(record: Omit<CanaryCallRecord, "at"> & { at?: string }): void {
    this.#recorder.recordCall({ ...record, at: record.at ?? new Date().toISOString() });
  }
}

// -----------------------------------------------------------------------------
// Bucketing — stable, deterministic, sha256-based 0..99 bucket.
// -----------------------------------------------------------------------------

export function bucketFor(conversationId: string, salt: string = ""): number {
  const h = createHash("sha256").update(`${salt}${conversationId}`).digest();
  // Big-endian unsigned 32-bit. Multiplying instead of shifting on the top
  // byte avoids the JS sign-extension trap where (h[0] << 24) goes negative
  // when h[0] >= 0x80, which would skew bucket 0..49 for half of all inputs.
  const n =
    h[0]! * 0x01000000 +
    h[1]! * 0x00010000 +
    h[2]! * 0x00000100 +
    h[3]!;
  return n % 100;
}

// -----------------------------------------------------------------------------
// Regression-eval gate hook — interface only. The agents package implements
// the actual evaluator; the contract is small so it can be wired in either
// direction.
// -----------------------------------------------------------------------------

export interface RegressionEvalGate {
  /** Compute a drift score over recent canary call records. Returns [0, 1]. */
  compute(records: readonly CanaryCallRecord[]): Promise<number>;
  /** Return true iff the drift is acceptable. False blocks promotion of the canary. */
  isAcceptable(score: number): boolean;
}
