// =============================================================================
// Vertex AI — Anthropic Claude. First-party Claude models hosted inside
// GCP; authenticates with the same ADC used by vertex-gemini. No
// ANTHROPIC_API_KEY required.
//
// Endpoint:
//   POST https://{region}-aiplatform.googleapis.com/v1/projects/{project}
//        /locations/{region}/publishers/anthropic/models/{model}:rawPredict
// Reference:
//   https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
// =============================================================================

import type { Llm, LlmProviderId, LlmRequest, LlmResponse, LlmMessage, LlmToolCall, LlmTool } from "../types.js";
import { LlmError } from "../types.js";

export interface VertexClaudeConfig {
  project: string;
  location: string;
  model: string;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

export class VertexClaudeProvider implements Llm {
  readonly provider: LlmProviderId = "vertex-claude";
  readonly model: string;
  readonly #cfg: VertexClaudeConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: VertexClaudeConfig) {
    this.#cfg = cfg;
    this.model = cfg.model;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const token = await this.#token();
    const url =
      `https://${this.#cfg.location}-aiplatform.googleapis.com/v1/projects/${this.#cfg.project}` +
      `/locations/${this.#cfg.location}/publishers/anthropic/models/${encodeURIComponent(this.model)}:rawPredict`;
    const body = {
      anthropic_version: "vertex-2023-10-16",
      system: req.system,
      messages: toAnthropic(req.messages),
      max_tokens: req.maxOutputTokens ?? 2048,
      temperature: req.temperature ?? 0.2,
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t): { name: string; description: string; input_schema: Record<string, unknown> } => ({
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
      res = await this.#fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmError(this.provider, this.model, "network", String(err));
    }
    if (!res.ok) {
      throw new LlmError(this.provider, this.model, res.status, await res.text());
    }
    const data = (await res.json()) as {
      content?: Array<{ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      stop_reason?: string;
      model?: string;
    };
    let content = "";
    const toolCalls: LlmToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text") content += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
      }
    }
    return {
      content,
      toolCalls,
      model: data.model ?? this.model,
      provider: this.provider,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        ...(data.usage?.cache_read_input_tokens !== undefined
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

  async #token(): Promise<string> {
    if (this.#cfg.getAccessToken) return this.#cfg.getAccessToken();
    const res = await this.#fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!res.ok) throw new LlmError(this.provider, this.model, res.status, "ADC token fetch failed");
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }
}

function toAnthropic(messages: LlmMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content },
        ],
      });
      continue;
    }
    const content: Array<Record<string, unknown>> = [];
    if (m.content) content.push({ type: "text", text: m.content });
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
    }
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }
  return out;
}
