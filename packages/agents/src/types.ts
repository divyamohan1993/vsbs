// =============================================================================
// @vsbs/agents — core types for the LangGraph supervisor/specialist topology.
//
// Everything that flows through the graph — messages, tool calls, tool
// results, safety assessments, dispatch decisions, autonomy grants — has
// a concrete, schema-grounded type here. The graph state uses LangGraph's
// Annotation API (see graph.ts); the shapes below are what each channel
// carries.
// =============================================================================

import type {
  LlmMessage,
  LlmToolCall,
} from "@vsbs/llm";
import type {
  SafetyAssessment,
  DispatchDecision,
  CommandGrant,
  AutonomyCapability,
} from "@vsbs/shared";

/** A single completed tool invocation — result-side of a ToolCall. */
export interface ToolResult {
  /** Correlates with the LlmToolCall.id that produced this result. */
  toolCallId: string;
  toolName: string;
  ok: boolean;
  /** JSON-serialisable response payload. Absent on failure. */
  data?: unknown;
  /** Machine-readable failure reason for the model. */
  reason?: string;
  /** Zod issues when `reason === "invalid-args"`. */
  issues?: unknown;
  /** Wall-clock milliseconds. */
  latencyMs: number;
  /** Optional verifier verdict that gated this call. */
  verifier?: VerifierVerdict;
}

export interface VerifierVerdict {
  grounded: boolean;
  reason: string;
  /** Model id that produced the verdict (for drift tracking). */
  model: string;
}

/** Facts extracted by the Mem0-style memory layer. */
export interface MemoryFact {
  key: string;
  value: unknown;
  source: "user" | "tool" | "agent";
  /** ISO 8601 timestamp. */
  at: string;
}

/** What the API SSE route streams back to the browser. */
export type AgentEvent =
  | { type: "delta"; role: "assistant"; text: string }
  | { type: "tool-call"; call: LlmToolCall }
  | { type: "tool-result"; result: ToolResult }
  | { type: "verifier"; call: LlmToolCall; verdict: VerifierVerdict }
  | { type: "safety"; assessment: SafetyAssessment }
  | { type: "dispatch"; decision: DispatchDecision }
  | { type: "autonomy"; capability: AutonomyCapability; grant?: CommandGrant }
  | { type: "final"; message: LlmMessage }
  | { type: "error"; code: string; message: string };

/** Input to a single concierge turn. */
export interface ConciergeTurnInput {
  userMessage: string;
  /** Opaque conversation id for memory scoping. */
  conversationId: string;
  /** Optional vehicle id to scope memory retrieval. */
  vehicleId?: string;
}

/** Output of a single concierge turn — the final assistant message. */
export interface ConciergeTurnOutput {
  message: LlmMessage;
  toolCalls: LlmToolCall[];
  toolResults: ToolResult[];
}

/** The supervisor state as a plain interface (LangGraph shape mirrors this). */
export interface AgentState {
  messages: LlmMessage[];
  pendingToolCalls: LlmToolCall[];
  completedToolResults: ToolResult[];
  facts: Record<string, unknown>;
  safety?: SafetyAssessment | undefined;
  dispatch?: DispatchDecision | undefined;
  autonomy?: AutonomyCapability | undefined;
  grant?: CommandGrant | undefined;
  /** Name of the specialist node currently holding the ball, or "concierge". */
  activeRole: string;
  /** Strictly increasing step counter — used as a stop-gap against runaway loops. */
  step: number;
}
