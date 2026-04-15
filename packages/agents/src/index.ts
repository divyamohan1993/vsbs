// =============================================================================
// @vsbs/agents — public surface.
//
// One entry point, one job: `buildVsbsGraph({ llm, apiBase })` returns a
// handle with a `runTurn(state, userMessage)` method that yields an async
// iterable of AgentEvents. Everything else in this package is internal
// plumbing surfaced for tests and for consumers who want deeper hooks.
//
// References: docs/research/agentic.md §2–§5, docs/architecture.md "Agents".
// =============================================================================

import type { LlmMessage, LlmRegistry } from "@vsbs/llm";

import { createHttpClient, ToolRegistry, type VsbsHttpClient } from "./tools/registry.js";
import { registerVsbsTools } from "./tools/vsbs.js";
import { buildStateGraph } from "./graph.js";
import { runOneTurn } from "./conversation.js";
import type { AgentEvent, ConciergeTurnInput } from "./types.js";

export * from "./types.js";
export * from "./memory.js";
export { ToolRegistry, createHttpClient } from "./tools/registry.js";
export type { VsbsHttpClient, ToolDefinition, ToolHandler } from "./tools/registry.js";
export { registerVsbsTools } from "./tools/vsbs.js";
export { Verifier } from "./verifier.js";
export {
  VsbsStateAnnotation,
  buildStateGraph,
  MAX_STEPS,
  type VsbsState,
  type VsbsStateUpdate,
  type VsbsGraphDeps,
} from "./graph.js";
export { runOneTurn } from "./conversation.js";
export * from "./prompts/concierge.js";

export interface BuildVsbsGraphOptions {
  llm: LlmRegistry;
  apiBase: string;
  /** Optional pre-built HTTP client (tests). When omitted, one is created from apiBase. */
  http?: VsbsHttpClient;
  /** Optional pre-built registry (tests). When omitted, a fresh one is created and registerVsbsTools runs on it. */
  registry?: ToolRegistry;
  /** Optional default request headers (e.g. Authorization, X-Correlation-Id). */
  defaultHeaders?: Record<string, string>;
}

export interface VsbsGraphHandle {
  readonly registry: ToolRegistry;
  runTurn(
    state: { messages: LlmMessage[] },
    input: ConciergeTurnInput,
  ): AsyncIterable<AgentEvent>;
  /** The compiled LangGraph, for callers that want to drive it directly. */
  readonly graph: ReturnType<typeof buildStateGraph>;
}

/**
 * Construct a VSBS agent graph bound to a specific API base URL and LLM
 * registry. The caller owns the LlmRegistry lifetime; we keep a reference
 * but never mutate it.
 */
export function buildVsbsGraph(opts: BuildVsbsGraphOptions): VsbsGraphHandle {
  const http: VsbsHttpClient = opts.http ?? createHttpClient(opts.apiBase, opts.defaultHeaders ?? {});
  const registry: ToolRegistry = opts.registry ?? (() => {
    const r = new ToolRegistry(http);
    registerVsbsTools(r);
    return r;
  })();
  const graph = buildStateGraph({ llm: opts.llm, registry });

  return {
    registry,
    graph,
    runTurn(state, input) {
      return runOneTurn(state, input, { llm: opts.llm, registry });
    },
  };
}
