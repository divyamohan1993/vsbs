// =============================================================================
// runOneTurn — drives a single concierge turn and yields AgentEvents as an
// async iterable. This is what the API's SSE route consumes.
//
// The implementation mirrors the LangGraph topology in graph.ts but runs the
// loop explicitly so every transition can emit a stream event (delta,
// tool-call, tool-result, verifier verdict, final message). LangGraph's
// streaming modes are an alternative; we keep the explicit loop for full
// control over what hits the wire, so the UI can show operational
// transparency (Buell & Norton 2011) — every tool call visible, every
// verifier verdict visible, no silent retries.
// =============================================================================

import {
  AgentRole,
  type LlmMessage,
  type LlmRegistry,
  type LlmToolCall,
} from "@vsbs/llm";

import { CONCIERGE_SUPERVISOR_PROMPT } from "./prompts/concierge.js";
import { ToolRegistry } from "./tools/registry.js";
import { Verifier } from "./verifier.js";
import { MAX_STEPS } from "./graph.js";
import type {
  AgentEvent,
  ConciergeTurnInput,
  ToolResult,
} from "./types.js";

export interface RunTurnDeps {
  llm: LlmRegistry;
  registry: ToolRegistry;
}

/**
 * Execute a single concierge turn. `state` is the running conversation
 * (most recent last). The returned async iterable emits AgentEvents until
 * the concierge stops asking for tool calls, a hard step limit fires, or
 * the verifier rejects every remaining call (in which case we emit an
 * `error` event and stop).
 */
export async function* runOneTurn(
  state: { messages: LlmMessage[] },
  input: ConciergeTurnInput,
  deps: RunTurnDeps,
): AsyncIterable<AgentEvent> {
  const { llm, registry } = deps;
  const verifier = new Verifier(llm);
  const client = llm.for(AgentRole.Concierge);

  // Append the user message to the running state.
  const messages: LlmMessage[] = [
    ...state.messages,
    { role: "user", content: input.userMessage },
  ];

  const tools = registry.llmTools();

  for (let step = 0; step < MAX_STEPS; step++) {
    let response;
    try {
      response = await client.complete({
        purpose: `concierge.turn.${input.conversationId}.step.${step}`,
        system: CONCIERGE_SUPERVISOR_PROMPT,
        messages,
        tools,
        toolChoice: { type: "auto" },
        temperature: 0.2,
        maxOutputTokens: 1024,
      });
    } catch (err) {
      yield {
        type: "error",
        code: "llm-error",
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    // Emit the assistant text as a single delta (the LLM layer does not
    // stream tokens yet; when it does, providers will yield multiple
    // deltas here. The interface is forward-compatible.)
    if (response.content.length > 0) {
      yield { type: "delta", role: "assistant", text: response.content };
    }

    const assistantMessage: LlmMessage = {
      role: "assistant",
      content: response.content,
      ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
    };
    messages.push(assistantMessage);

    // No tool calls → done.
    if (response.toolCalls.length === 0) {
      yield { type: "final", message: assistantMessage };
      return;
    }

    // Verifier gate on every tool call.
    const survivors: LlmToolCall[] = [];
    for (const call of response.toolCalls) {
      yield { type: "tool-call", call };
      const verdict = await verifier.check({ conversation: messages, call });
      yield { type: "verifier", call, verdict };
      if (verdict.grounded) {
        survivors.push(call);
      } else {
        // Feed the rejection back as a tool message so the next supervisor
        // step re-plans instead of silently retrying.
        const rejectionMessage: LlmMessage = {
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            ok: false,
            reason: "verifier-rejected",
            verdict: verdict.reason,
          }),
        };
        messages.push(rejectionMessage);
        const rejectionResult: ToolResult = {
          toolCallId: call.id,
          toolName: call.name,
          ok: false,
          reason: `verifier-rejected: ${verdict.reason}`,
          latencyMs: 0,
          verifier: verdict,
        };
        yield { type: "tool-result", result: rejectionResult };
      }
    }

    if (survivors.length === 0) {
      // Every call rejected — let the supervisor re-plan next iteration.
      continue;
    }

    // Execute the surviving tool calls and feed results back into messages.
    for (const call of survivors) {
      const result = await registry.run(call);
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(
          result.ok
            ? { ok: true, data: result.data }
            : { ok: false, reason: result.reason, issues: result.issues },
        ),
      });
      yield { type: "tool-result", result };
    }
  }

  // Step budget exhausted — fail closed with a user-visible message.
  const safetyMessage: LlmMessage = {
    role: "assistant",
    content:
      "I've hit the safe step limit for this turn. Let me pause here — please confirm or correct anything before we continue.",
  };
  messages.push(safetyMessage);
  yield { type: "final", message: safetyMessage };
}
