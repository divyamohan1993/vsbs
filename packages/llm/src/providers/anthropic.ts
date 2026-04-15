// =============================================================================
// Anthropic direct API — optional escape hatch. Required only if the user
// wants the Managed Agents beta or Anthropic-direct billing. Not used by
// the demo or prod profiles by default.
//
// Endpoint: https://api.anthropic.com/v1/messages
// Reference: https://docs.anthropic.com/en/api/messages
// =============================================================================

import type { Llm, LlmProviderId, LlmRequest, LlmResponse, LlmMessage, LlmToolCall } from "../types.js";
import { LlmError } from "../types.js";

export class AnthropicProvider implements Llm {
  readonly provider: LlmProviderId = "anthropic";
  readonly model: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(cfg: { apiKey: string; model: string; fetchImpl?: typeof fetch }) {
    this.#apiKey = cfg.apiKey;
    this.model = cfg.model;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const body = {
      model: this.model,
      system: req.system,
      messages: toAnthropic(req.messages),
      max_tokens: req.maxOutputTokens ?? 2048,
      temperature: req.temperature ?? 0.2,
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
            ...(req.toolChoice
              ? {
                  tool_choice:
                    req.toolChoice.type === "auto"
                      ? { type: "auto" }
                      : req.toolChoice.type === "none"
                        ? { type: "none" }
                        : { type: "tool", name: req.toolChoice.name },
                }
              : {}),
          }
        : {}),
    };
    let res: Response;
    try {
      res = await this.#fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.#apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmError(this.provider, this.model, "network", String(err));
    }
    if (!res.ok) throw new LlmError(this.provider, this.model, res.status, await res.text());
    const data = (await res.json()) as {
      content: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
      stop_reason?: string;
      model: string;
    };
    let content = "";
    const toolCalls: LlmToolCall[] = [];
    for (const b of data.content) {
      if (b.type === "text") content += b.text;
      if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, arguments: b.input });
    }
    return {
      content,
      toolCalls,
      model: data.model,
      provider: this.provider,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        ...(data.usage.cache_read_input_tokens !== undefined
          ? { cachedInputTokens: data.usage.cache_read_input_tokens }
          : {}),
      },
      latencyMs: Date.now() - started,
      finishReason:
        data.stop_reason === "tool_use"
          ? "tool-use"
          : data.stop_reason === "max_tokens"
            ? "length"
            : "stop",
    };
  }
}

function toAnthropic(messages: LlmMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }],
      });
      continue;
    }
    const content: Array<Record<string, unknown>> = [];
    if (m.content) content.push({ type: "text", text: m.content });
    if (m.toolCalls) for (const tc of m.toolCalls) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }
  return out;
}
