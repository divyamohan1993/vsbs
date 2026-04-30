// =============================================================================
// Confidence propagation — every tool result carries a typed envelope so the
// supervisor can refuse to synthesise a recommendation when uncertainty is
// high. The envelope wraps the raw value with metadata; backward-compat is
// preserved through a `unwrapForLegacyCallers` helper.
//
// Rule: if ANY tool result returned during a turn has confidence below its
// declared floor, the supervisor's final user-facing recommendation is
// suppressed. The fence emits a "need more information" advisory and offers
// a human handoff. This is the load-bearing safety property — we do NOT
// allow the LLM to confabulate when the underlying engines are uncertain.
// =============================================================================

import { z } from "zod";

import type { ToolResult } from "./types.js";

// -----------------------------------------------------------------------------
// Envelope schema. `T` is the domain payload — we keep it generic so each
// tool can specify its real return shape while sharing the metadata layer.
// -----------------------------------------------------------------------------

export const ConfidenceFloor = 0.6 as const;

export const ToolResultEnvelopeMetadataSchema = z.object({
  /** [0, 1]. Some tools have inherent confidence (e.g. heuristics); others are 1 by definition (idempotent commits). */
  confidence: z.number().min(0).max(1),
  /** Floor below which the supervisor must NOT synthesise a recommendation. */
  confidenceFloor: z.number().min(0).max(1).default(ConfidenceFloor),
  /** Source of the confidence — e.g. "deterministic", "engine:safety", "static-rule". */
  source: z.string().min(1),
  /** ISO 8601 timestamp when the envelope was produced. */
  computedAt: z.string().datetime(),
  /** Optional one-line note when confidence is set as 1 by definition. */
  note: z.string().optional(),
});

export type ToolResultEnvelopeMetadata = z.infer<typeof ToolResultEnvelopeMetadataSchema>;

/**
 * Build a Zod schema for an envelope wrapping a specific value type. Used
 * by individual tool handlers to declare the shape of their wrapped result.
 */
export function ToolResultEnvelopeSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    confidence: z.number().min(0).max(1),
    confidenceFloor: z.number().min(0).max(1).default(ConfidenceFloor),
    source: z.string().min(1),
    computedAt: z.string().datetime(),
    note: z.string().optional(),
  });
}

export interface ToolResultEnvelope<T = unknown> {
  value: T;
  confidence: number;
  confidenceFloor: number;
  source: string;
  computedAt: string;
  note?: string;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Build an envelope around a value. Defaults: confidence=1 (idempotent / pure
 * tools), source="deterministic", floor=ConfidenceFloor. Use the explicit
 * overload at every uncertain call-site so reviewers can audit each one.
 */
export function envelope<T>(
  value: T,
  opts: {
    confidence?: number;
    confidenceFloor?: number;
    source?: string;
    note?: string;
    computedAt?: string;
  } = {},
): ToolResultEnvelope<T> {
  const conf = opts.confidence ?? 1;
  const floor = opts.confidenceFloor ?? ConfidenceFloor;
  const out: ToolResultEnvelope<T> = {
    value,
    confidence: conf,
    confidenceFloor: floor,
    source: opts.source ?? "deterministic",
    computedAt: opts.computedAt ?? new Date().toISOString(),
  };
  if (opts.note !== undefined) out.note = opts.note;
  return out;
}

/**
 * Detect whether a value already looks like an envelope. Used by the
 * legacy-callers shim and by the supervisor's confidence gate.
 */
export function isEnvelope(value: unknown): value is ToolResultEnvelope<unknown> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    "value" in v &&
    typeof v["confidence"] === "number" &&
    typeof v["confidenceFloor"] === "number" &&
    typeof v["source"] === "string" &&
    typeof v["computedAt"] === "string"
  );
}

/**
 * Backward-compat shim: accept either an envelope or the raw payload and
 * return the unwrapped value. Old callers that don't know about envelopes
 * see the underlying value as before.
 */
export function unwrapForLegacyCallers<T>(payload: T | ToolResultEnvelope<T>): T {
  if (isEnvelope(payload)) return payload.value as T;
  return payload as T;
}

// -----------------------------------------------------------------------------
// Confidence-gate: scan an array of ToolResults and report whether any
// envelope was below its declared floor. If yes, the supervisor MUST NOT
// emit a synthesised recommendation.
// -----------------------------------------------------------------------------

export interface ConfidenceGateVerdict {
  /** True when at least one tool result had confidence < confidenceFloor. */
  belowFloor: boolean;
  /** Per-tool breakdown (only for tools whose data is an envelope). */
  details: Array<{
    toolName: string;
    confidence: number;
    floor: number;
    source: string;
    belowFloor: boolean;
  }>;
}

/**
 * Run the gate over completed tool results. Tools whose `data` is not an
 * envelope are silently skipped — they participate via the legacy-shim path.
 * Failed tool calls are also skipped (they have no payload to inspect).
 */
export function runConfidenceGate(results: ToolResult[]): ConfidenceGateVerdict {
  const details: ConfidenceGateVerdict["details"] = [];
  let belowFloor = false;
  for (const r of results) {
    if (!r.ok || !isEnvelope(r.data)) continue;
    const env = r.data as ToolResultEnvelope<unknown>;
    const isBelow = env.confidence < env.confidenceFloor;
    if (isBelow) belowFloor = true;
    details.push({
      toolName: r.toolName,
      confidence: env.confidence,
      floor: env.confidenceFloor,
      source: env.source,
      belowFloor: isBelow,
    });
  }
  return { belowFloor, details };
}

// -----------------------------------------------------------------------------
// Canonical low-confidence advisory the fence emits when the gate fires.
// -----------------------------------------------------------------------------

export const CANONICAL_LOW_CONFIDENCE_ADVISORY =
  "I am not confident enough in what I have so far to make a recommendation. " +
  "I would like to connect you with a human service advisor who can ask a few more questions and confirm safely. " +
  "Tap the help button or reply with 'human' and I will hand you over.";
