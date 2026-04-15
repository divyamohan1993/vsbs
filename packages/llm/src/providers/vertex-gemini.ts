// =============================================================================
// Vertex AI Gemini — production path on GCP. Authenticates via ADC /
// Workload Identity inside the `lmsforshantithakur` project; no API key.
//
// Endpoint:
//   POST https://{region}-aiplatform.googleapis.com/v1/projects/{project}
//        /locations/{region}/publishers/google/models/{model}:generateContent
//   Bearer token from Google ADC.
// Reference:
//   https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini
// =============================================================================

import type { Llm, LlmProviderId, LlmRequest, LlmResponse, LlmMessage, LlmToolCall, LlmTool } from "../types.js";
import { LlmError } from "../types.js";

export interface VertexGeminiConfig {
  project: string;
  location: string;
  model: string;
  /** Async function that returns a fresh OAuth 2.0 bearer token. */
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

export class VertexGeminiProvider implements Llm {
  readonly provider: LlmProviderId = "vertex-gemini";
  readonly model: string;
  readonly #cfg: VertexGeminiConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: VertexGeminiConfig) {
    this.#cfg = cfg;
    this.model = cfg.model;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const token = await this.#token();
    const url =
      `https://${this.#cfg.location}-aiplatform.googleapis.com/v1/projects/${this.#cfg.project}` +
      `/locations/${this.#cfg.location}/publishers/google/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toContents(req.messages),
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
      ...(req.tools && req.tools.length > 0
        ? {
            tools: [{ functionDeclarations: req.tools.map(toGeminiTool) }],
            toolConfig:
              !req.toolChoice || req.toolChoice.type === "auto"
                ? { functionCallingConfig: { mode: "AUTO" } }
                : req.toolChoice.type === "none"
                  ? { functionCallingConfig: { mode: "NONE" } }
                  : {
                      functionCallingConfig: { mode: "ANY", allowedFunctionNames: [req.toolChoice.name] },
                    },
          }
        : {}),
    };
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmError(this.provider, this.model, "network", String(err));
    }
    if (!res.ok) {
      throw new LlmError(this.provider, this.model, res.status, await res.text());
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
      modelVersion?: string;
    };
    const cand = data.candidates?.[0];
    if (!cand) throw new LlmError(this.provider, this.model, "parse", "no candidates");
    const parts = cand.content?.parts ?? [];
    let content = "";
    const toolCalls: LlmToolCall[] = [];
    for (const p of parts) {
      if (p.text) content += p.text;
      if (p.functionCall) {
        toolCalls.push({
          id: `vgm_${toolCalls.length}_${Date.now()}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args ?? {},
        });
      }
    }
    return {
      content,
      toolCalls,
      model: data.modelVersion ?? this.model,
      provider: this.provider,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        ...(data.usageMetadata?.cachedContentTokenCount !== undefined
          ? { cachedInputTokens: data.usageMetadata.cachedContentTokenCount }
          : {}),
      },
      latencyMs: Date.now() - started,
      finishReason:
        cand.finishReason === "MAX_TOKENS"
          ? "length"
          : cand.finishReason === "SAFETY"
            ? "safety"
            : toolCalls.length > 0
              ? "tool-use"
              : "stop",
    };
  }

  async #token(): Promise<string> {
    if (this.#cfg.getAccessToken) return this.#cfg.getAccessToken();
    // Metadata server path — works on Cloud Run, GKE, GCE.
    const res = await this.#fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!res.ok) {
      throw new LlmError(this.provider, this.model, res.status, "ADC token fetch failed");
    }
    const body = (await res.json()) as { access_token: string };
    return body.access_token;
  }
}

function toGeminiTool(t: LlmTool) {
  return { name: t.name, description: t.description, parameters: t.inputSchema };
}

function toContents(messages: LlmMessage[]) {
  const out: Array<{ role: "user" | "model"; parts: Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.toolCallId ?? "tool",
              response: { name: m.toolCallId ?? "tool", content: safeJson(m.content) },
            },
          },
        ],
      });
      continue;
    }
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ text: m.content });
    if (m.toolCalls) for (const tc of m.toolCalls) parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
    out.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return out;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
