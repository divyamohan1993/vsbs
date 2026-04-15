// =============================================================================
// OpenAI — user choice. Uses the Chat Completions API because it is
// universally supported; the Responses API can be swapped in later for
// streaming / agentic features without changing the Llm interface.
//
// Endpoint: https://api.openai.com/v1/chat/completions
// Reference: https://platform.openai.com/docs/api-reference/chat
// =============================================================================

import type { Llm, LlmProviderId, LlmRequest, LlmResponse, LlmMessage, LlmToolCall } from "../types.js";
import { LlmError } from "../types.js";

export class OpenAiProvider implements Llm {
  readonly provider: LlmProviderId = "openai";
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
      messages: [
        { role: "system", content: req.system },
        ...toOpenAi(req.messages),
      ],
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxOutputTokens ?? 2048,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              },
            })),
            ...(req.toolChoice
              ? {
                  tool_choice:
                    req.toolChoice.type === "auto"
                      ? "auto"
                      : req.toolChoice.type === "none"
                        ? "none"
                        : { type: "function", function: { name: req.toolChoice.name } },
                }
              : {}),
          }
        : {}),
    };
    let res: Response;
    try {
      res = await this.#fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmError(this.provider, this.model, "network", String(err));
    }
    if (!res.ok) throw new LlmError(this.provider, this.model, res.status, await res.text());
    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      model: string;
    };
    const choice = data.choices[0];
    if (!choice) throw new LlmError(this.provider, this.model, "parse", "no choices");
    const toolCalls: LlmToolCall[] =
      choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJson(tc.function.arguments) as Record<string, unknown>,
      })) ?? [];
    return {
      content: choice.message.content ?? "",
      toolCalls,
      model: data.model,
      provider: this.provider,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        ...(data.usage?.prompt_tokens_details?.cached_tokens !== undefined
          ? { cachedInputTokens: data.usage.prompt_tokens_details.cached_tokens }
          : {}),
      },
      latencyMs: Date.now() - started,
      finishReason:
        choice.finish_reason === "tool_calls"
          ? "tool-use"
          : choice.finish_reason === "length"
            ? "length"
            : choice.finish_reason === "content_filter"
              ? "safety"
              : "stop",
    };
  }
}

function toOpenAi(messages: LlmMessage[]) {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      });
      continue;
    }
    out.push({ role: "user", content: m.content });
  }
  return out;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
