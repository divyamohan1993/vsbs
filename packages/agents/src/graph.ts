// =============================================================================
// LangGraph StateGraph — the supervisor-with-specialists topology from
// docs/research/agentic.md §2, wired to the tool registry and verifier.
//
// Nodes:
//   supervisor → one LLM step as the Concierge; emits tool calls + assistant
//                text. Routes to `verify` if there are pending tool calls,
//                else to `end`.
//   verify     → runs the Verifier on each pending tool call. Drops any
//                ungrounded calls from `pendingToolCalls` and records the
//                verdict. Always routes to `tools`.
//   tools      → executes every surviving pending tool call via the
//                ToolRegistry, appends `tool` messages to `messages`, and
//                routes back to `supervisor` for the next planning step.
//
// We cap loop iterations at MAX_STEPS to fail closed on runaway loops.
//
// State schema uses LangGraph's Annotation API. The TS type of the state is
// derived from the Annotation root, so nodes get strong typing for free.
// =============================================================================

import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import {
  AgentRole,
  type LlmMessage,
  type LlmRegistry,
  type LlmToolCall,
} from "@vsbs/llm";

import { CONCIERGE_SUPERVISOR_PROMPT } from "./prompts/concierge.js";
import { ToolRegistry } from "./tools/registry.js";
import { Verifier } from "./verifier.js";
import type { ToolResult, VerifierVerdict } from "./types.js";

export const MAX_STEPS = 12;

// -----------------------------------------------------------------------------
// State channels. Each channel has an explicit reducer so concurrent node
// updates compose predictably. `messages` is append-only; `pendingToolCalls`
// is replace-semantics so the verifier can prune; `completedToolResults` is
// append-only; scalar channels use LastValue (default).
// -----------------------------------------------------------------------------

function appendArray<T>(left: T[], right: T[] | T): T[] {
  if (Array.isArray(right)) return left.concat(right);
  return left.concat([right]);
}

export const VsbsStateAnnotation = Annotation.Root({
  messages: Annotation<LlmMessage[]>({
    reducer: appendArray<LlmMessage>,
    default: () => [],
  }),
  pendingToolCalls: Annotation<LlmToolCall[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  completedToolResults: Annotation<ToolResult[]>({
    reducer: appendArray<ToolResult>,
    default: () => [],
  }),
  verifierVerdicts: Annotation<VerifierVerdict[]>({
    reducer: appendArray<VerifierVerdict>,
    default: () => [],
  }),
  activeRole: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "concierge",
  }),
  step: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  finished: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
});

export type VsbsState = typeof VsbsStateAnnotation.State;
export type VsbsStateUpdate = typeof VsbsStateAnnotation.Update;

// -----------------------------------------------------------------------------
// Builder
// -----------------------------------------------------------------------------

export interface VsbsGraphDeps {
  llm: LlmRegistry;
  registry: ToolRegistry;
}

export function buildStateGraph(deps: VsbsGraphDeps): ReturnType<
  ReturnType<typeof createBuilder>["compile"]
> {
  return createBuilder(deps).compile();
}

function createBuilder(deps: VsbsGraphDeps) {
  const { llm, registry } = deps;
  const verifier = new Verifier(llm);

  // ---- supervisor node ------------------------------------------------------
  const supervisorNode = async (state: VsbsState): Promise<VsbsStateUpdate> => {
    if (state.step >= MAX_STEPS) {
      return {
        finished: true,
        messages: [
          {
            role: "assistant",
            content:
              "I've hit the safe step limit for this turn. Let me stop here and summarise — please confirm or correct anything before we continue.",
          },
        ],
      };
    }
    const client = llm.for(AgentRole.Concierge);
    const tools = registry.llmTools();
    const res = await client.complete({
      purpose: "concierge.supervisor.step",
      system: CONCIERGE_SUPERVISOR_PROMPT,
      messages: state.messages,
      tools,
      toolChoice: { type: "auto" },
      temperature: 0.2,
      maxOutputTokens: 1024,
    });
    const assistantMessage: LlmMessage = {
      role: "assistant",
      content: res.content,
      ...(res.toolCalls.length > 0 ? { toolCalls: res.toolCalls } : {}),
    };
    const noMoreWork = res.toolCalls.length === 0;
    return {
      messages: [assistantMessage],
      pendingToolCalls: res.toolCalls,
      step: state.step + 1,
      finished: noMoreWork,
      activeRole: "concierge",
    };
  };

  // ---- verify node ----------------------------------------------------------
  const verifyNode = async (state: VsbsState): Promise<VsbsStateUpdate> => {
    const survivors: LlmToolCall[] = [];
    const verdicts: VerifierVerdict[] = [];
    const rejectionMessages: LlmMessage[] = [];
    for (const call of state.pendingToolCalls) {
      const verdict = await verifier.check({
        conversation: state.messages,
        call,
      });
      verdicts.push(verdict);
      if (verdict.grounded) {
        survivors.push(call);
      } else {
        // Surface rejection as a tool-result message so the model re-plans
        // instead of silently retrying. Mirrors docs/research/agentic.md §3.
        rejectionMessages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            reason: "verifier-rejected",
            verdict: verdict.reason,
          }),
        });
      }
    }
    return {
      pendingToolCalls: survivors,
      verifierVerdicts: verdicts,
      messages: rejectionMessages,
    };
  };

  // ---- tools node -----------------------------------------------------------
  const toolsNode = async (state: VsbsState): Promise<VsbsStateUpdate> => {
    const newMessages: LlmMessage[] = [];
    const results: ToolResult[] = [];
    for (const call of state.pendingToolCalls) {
      const result = await registry.run(call);
      results.push(result);
      newMessages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(
          result.ok
            ? { ok: true, data: result.data }
            : { ok: false, reason: result.reason, issues: result.issues },
        ),
      });
    }
    return {
      messages: newMessages,
      completedToolResults: results,
      pendingToolCalls: [],
    };
  };

  // ---- routing --------------------------------------------------------------
  const routeFromSupervisor = (state: VsbsState): "verify" | typeof END => {
    if (state.finished) return END;
    if (state.pendingToolCalls.length === 0) return END;
    return "verify";
  };

  const routeFromVerify = (state: VsbsState): "tools" | "supervisor" => {
    // If the verifier rejected every call, go back to supervisor so it can re-plan.
    if (state.pendingToolCalls.length === 0) return "supervisor";
    return "tools";
  };

  const builder = new StateGraph(VsbsStateAnnotation)
    .addNode("supervisor", supervisorNode)
    .addNode("verify", verifyNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", routeFromSupervisor, {
      verify: "verify",
      [END]: END,
    })
    .addConditionalEdges("verify", routeFromVerify, {
      tools: "tools",
      supervisor: "supervisor",
    })
    .addEdge("tools", "supervisor");

  return builder;
}
