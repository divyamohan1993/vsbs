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
//
// Defence-in-depth on every `final` emission:
//   1. Confidence gate — if any tool returned confidence < floor, the LLM
//      cannot synthesise a recommendation; replace with the canonical
//      low-confidence advisory.
//   2. SafetyFence — non-overridable; re-runs the deterministic safety
//      assessor and rewrites unsafe LLM output to the canonical advisory.
//   3. screenFinalOutput — PII scrub + forbidden-claim guard + sentinel
//      leak detection.
// All three run on every code path that emits `final`. Fail-closed on error.
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
import {
  screenIncomingMessage,
  screenOutgoingText,
  screenToolCall,
  type SecurityContext,
} from "./red-team-defenses.js";
import {
  CANONICAL_RED_FLAG_ADVISORY,
  SafetyFence,
  type SafetyFenceContext,
} from "./llm-safety-fence.js";
import { screenFinalOutput } from "./output-filter.js";
import {
  CANONICAL_LOW_CONFIDENCE_ADVISORY,
  runConfidenceGate,
  unwrapForLegacyCallers,
} from "./confidence.js";
import type {
  AgentEvent,
  ConciergeTurnInput,
  ToolResult,
} from "./types.js";

export interface RunTurnDeps {
  llm: LlmRegistry;
  registry: ToolRegistry;
  /** Optional security context — when supplied, defenses get session ownership info. */
  security?: SecurityContext;
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
  const security = deps.security;
  const fence = new SafetyFence();
  // Track every tool result observed during this turn so the safety fence
  // and the confidence gate see the full turn-state when the LLM finalises.
  const observedResults: ToolResult[] = [];

  // Apply the three-layer defence to a candidate final message and return a
  // safe-to-emit assistant message. Fail-closed on any internal error.
  const finalize = (candidate: LlmMessage): LlmMessage => {
    try {
      const fenceCtx: SafetyFenceContext = {
        userMessage: input.userMessage,
        toolResults: observedResults,
      };
      const gate = runConfidenceGate(observedResults);
      let working: LlmMessage = candidate;
      if (gate.belowFloor) {
        working = { role: "assistant", content: CANONICAL_LOW_CONFIDENCE_ADVISORY };
      }
      const fenced = fence.apply(working, fenceCtx).message;
      const filtered = screenFinalOutput(fenced.content).text;
      return { role: "assistant", content: filtered };
    } catch {
      return { role: "assistant", content: CANONICAL_RED_FLAG_ADVISORY };
    }
  };

  // INPUT GUARDRAIL: prompt-injection / jailbreak detector.
  const incoming = screenIncomingMessage(input.userMessage);
  if (!incoming.ok) {
    const refusal: LlmMessage = {
      role: "assistant",
      content:
        "I cannot follow that request. If you have a legitimate vehicle issue please describe what is happening with your car.",
    };
    const safe = finalize(refusal);
    yield { type: "delta", role: "assistant", text: safe.content };
    yield { type: "final", message: safe };
    return;
  }

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
      // Fail-closed final on LLM error — surface a safe-by-fence message
      // so the user never sees a raw error frame as their final answer.
      const errMessage = err instanceof Error ? err.message : String(err);
      yield {
        type: "error",
        code: "llm-error",
        message: errMessage,
      };
      const safe = finalize({ role: "assistant", content: "" });
      yield { type: "final", message: safe };
      return;
    }

    // OUTPUT GUARDRAIL: scrub PII / prompt-leakage from any assistant text.
    const screened = screenOutgoingText(response.content);
    const scrubbedContent = screened.value ?? response.content;

    // Emit the assistant text as a single delta (the LLM layer does not
    // stream tokens yet; when it does, providers will yield multiple
    // deltas here. The interface is forward-compatible.)
    if (scrubbedContent.length > 0) {
      yield { type: "delta", role: "assistant", text: scrubbedContent };
    }

    const assistantMessage: LlmMessage = {
      role: "assistant",
      content: scrubbedContent,
      ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
    };
    messages.push(assistantMessage);

    // No tool calls → done. Apply the three-layer defence before emitting.
    if (response.toolCalls.length === 0) {
      const safe = finalize(assistantMessage);
      yield { type: "final", message: safe };
      return;
    }

    // Verifier gate on every tool call. Red-team defense gate runs first —
    // any denylist hit means the call is dropped before the verifier even sees it.
    const survivors: LlmToolCall[] = [];
    for (const call of response.toolCalls) {
      yield { type: "tool-call", call };
      const denyCheck = screenToolCall(call, security);
      if (!denyCheck.ok) {
        const denyResult: ToolResult = {
          toolCallId: call.id,
          toolName: call.name,
          ok: false,
          reason: `red-team-deny: ${(denyCheck.triggered ?? []).join(",")}`,
          latencyMs: 0,
        };
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({ ok: false, reason: denyResult.reason }),
        });
        observedResults.push(denyResult);
        yield { type: "tool-result", result: denyResult };
        continue;
      }
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
        observedResults.push(rejectionResult);
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
      // The LLM continues to see the unwrapped value so prompts and tools
      // remain unchanged. Confidence and provenance live on the ToolResult
      // and are consumed by the supervisor's safety + confidence layers.
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(
          result.ok
            ? { ok: true, data: unwrapForLegacyCallers(result.data) }
            : { ok: false, reason: result.reason, issues: result.issues },
        ),
      });
      observedResults.push(result);
      yield { type: "tool-result", result };
    }
  }

  // Step budget exhausted — fail closed with a user-visible message.
  const safetyMessage: LlmMessage = {
    role: "assistant",
    content:
      "I've hit the safe step limit for this turn. Let me pause here and confirm anything before we continue.",
  };
  messages.push(safetyMessage);
  const safe = finalize(safetyMessage);
  yield { type: "final", message: safe };
}
