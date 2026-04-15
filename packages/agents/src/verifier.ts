// =============================================================================
// Verifier chain — groundedness gate for every tool call.
//
// Pattern: a small, cheap model (AgentRole.Verifier) is asked a single
// question: "Is this tool call grounded in the conversation so far?" It
// returns a strict JSON verdict. We parse defensively — a malformed verdict
// is treated as { grounded: false } so ambiguous cases fail closed. Failed
// verifications DO NOT become silent retries; the supervisor is expected
// to re-plan (see docs/research/agentic.md §3).
// =============================================================================

import { AgentRole, type LlmMessage, type LlmRegistry, type LlmToolCall } from "@vsbs/llm";
import { VERIFIER_PROMPT } from "./prompts/concierge.js";
import type { VerifierVerdict } from "./types.js";

export interface VerifierInput {
  conversation: LlmMessage[];
  call: LlmToolCall;
  /** Optional short description of what just happened, to help the verifier. */
  context?: string;
}

export class Verifier {
  readonly #llm: LlmRegistry;
  constructor(llm: LlmRegistry) {
    this.#llm = llm;
  }

  async check(input: VerifierInput): Promise<VerifierVerdict> {
    const client = this.#llm.for(AgentRole.Verifier);
    const user =
      `Tool call candidate:\n` +
      `  name: ${input.call.name}\n` +
      `  arguments: ${safeStringify(input.call.arguments)}\n\n` +
      `Conversation so far (most recent last):\n${renderTranscript(input.conversation)}\n\n` +
      (input.context ? `Context: ${input.context}\n\n` : "") +
      `Answer ONLY with a single JSON object: {"grounded": true|false, "reason": "<one short sentence>"}. No prose.`;

    try {
      const res = await client.complete({
        purpose: "verifier.tool-call",
        system: VERIFIER_PROMPT,
        messages: [{ role: "user", content: user }],
        temperature: 0,
        maxOutputTokens: 200,
        toolChoice: { type: "none" },
      });
      return parseVerdict(res.content, client.model);
    } catch (err) {
      return {
        grounded: false,
        reason: `verifier-error: ${err instanceof Error ? err.message : String(err)}`,
        model: client.model,
      };
    }
  }
}

function parseVerdict(raw: string, model: string): VerifierVerdict {
  const trimmed = raw.trim();
  // Extract the first JSON object — models sometimes wrap with prose despite instructions.
  const match = trimmed.match(/\{[\s\S]*\}/u);
  const candidate = match ? match[0] : trimmed;
  try {
    const parsed = JSON.parse(candidate) as { grounded?: unknown; reason?: unknown };
    const grounded = parsed.grounded === true;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "no-reason-given";
    return { grounded, reason, model };
  } catch {
    return { grounded: false, reason: "verifier-malformed-response", model };
  }
}

function renderTranscript(messages: LlmMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const tag = m.role.toUpperCase();
    const content = m.content.length > 600 ? `${m.content.slice(0, 600)}...` : m.content;
    lines.push(`[${tag}] ${content}`);
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const tc of m.toolCalls) {
        lines.push(`  → tool-call ${tc.name}(${safeStringify(tc.arguments)})`);
      }
    }
  }
  return lines.join("\n");
}

function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 400 ? `${s.slice(0, 400)}...` : s;
  } catch {
    return "<unserialisable>";
  }
}
