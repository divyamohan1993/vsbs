// =============================================================================
// Shared LLM types. Every provider normalises to these.
// =============================================================================

export type LlmRole = "system" | "user" | "assistant" | "tool";

/** A chat message in the normalised format all providers accept. */
export interface LlmMessage {
  role: LlmRole;
  /** Plain text content. For assistant messages carrying tool calls only, may be empty. */
  content: string;
  /** When `role === "tool"`, the tool call id this message is a response to. */
  toolCallId?: string;
  /** When `role === "assistant"`, tool calls emitted by the model. */
  toolCalls?: LlmToolCall[];
}

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. Providers compile this into their own tool-use shape. */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Arguments object — provider has already parsed JSON. */
  arguments: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cached prompt tokens, if the provider supports prompt caching. */
  cachedInputTokens?: number;
}

export interface LlmRequest {
  /** Human-readable label for tracing. */
  purpose: string;
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  /** Force the model to use exactly one named tool. */
  toolChoice?: { type: "required"; name: string } | { type: "auto" } | { type: "none" };
  temperature?: number;
  maxOutputTokens?: number;
  /** Deterministic-seed knob if the provider supports it. */
  seed?: number;
}

export interface LlmResponse {
  /** Text content. May be empty if the model responded with tool calls only. */
  content: string;
  toolCalls: LlmToolCall[];
  /** Model id actually used (so a registry can log drift). */
  model: string;
  provider: LlmProviderId;
  usage: LlmUsage;
  /** Milliseconds wall clock. */
  latencyMs: number;
  finishReason: "stop" | "tool-use" | "length" | "safety" | "error";
}

export type LlmProviderId =
  | "google-ai-studio"
  | "vertex-gemini"
  | "vertex-claude"
  | "anthropic"
  | "openai"
  | "scripted";

/** The one interface every provider implements. */
export interface Llm {
  readonly provider: LlmProviderId;
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    readonly provider: LlmProviderId,
    readonly model: string,
    readonly status: number | "network" | "timeout" | "parse",
    message: string,
  ) {
    super(`[${provider}/${model}] ${status}: ${message}`);
  }
}
