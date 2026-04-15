// =============================================================================
// Google AI Studio (generativelanguage.googleapis.com) — free tier, cheapest
// path for the demo profile. Uses an API key, not GCP credentials, so it is
// the zero-setup option for local development.
//
// Endpoint:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}
// Reference:
//   https://ai.google.dev/gemini-api/docs
//   https://ai.google.dev/gemini-api/docs/function-calling
// =============================================================================

import type { Llm, LlmProviderId, LlmRequest, LlmResponse, LlmTool, LlmToolCall, LlmMessage } from "../types.js";
import { LlmError } from "../types.js";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { name: string; content: unknown } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: "STOP" | "MAX_TOKENS" | "SAFETY" | "RECITATION" | "TOOL_USE" | "OTHER";
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  modelVersion?: string;
  error?: { code: number; message: string };
}

export class GoogleAiStudioProvider implements Llm {
  readonly provider: LlmProviderId = "google-ai-studio";
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
      systemInstruction: { parts: [{ text: req.system }] },
      contents: this.#toContents(req.messages),
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
      },
      ...(req.tools && req.tools.length > 0
        ? {
            tools: [{ functionDeclarations: req.tools.map(toGeminiTool) }],
            toolConfig: this.#toolConfig(req),
          }
        : {}),
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${this.#apiKey}`;
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmError(this.provider, this.model, "network", String(err));
    }
    if (!res.ok) {
      const text = await res.text();
      throw new LlmError(this.provider, this.model, res.status, text);
    }
    const data = (await res.json()) as GeminiGenerateResponse;
    if (data.error) throw new LlmError(this.provider, this.model, data.error.code, data.error.message);
    const cand = data.candidates?.[0];
    if (!cand) throw new LlmError(this.provider, this.model, "parse", "no candidates");
    const parts = cand.content?.parts ?? [];
    let content = "";
    const toolCalls: LlmToolCall[] = [];
    for (const p of parts) {
      if (p.text) content += p.text;
      if (p.functionCall) {
        toolCalls.push({
          id: `gai_${toolCalls.length}_${Date.now()}`,
          name: p.functionCall.name,
          arguments: p.functionCall.args ?? {},
        });
      }
    }
    const finishReason = mapFinish(cand.finishReason);
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
      finishReason,
    };
  }

  #toContents(messages: LlmMessage[]): GeminiContent[] {
    const out: GeminiContent[] = [];
    for (const m of messages) {
      if (m.role === "system") continue; // handled via systemInstruction
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
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
      }
      out.push({ role: m.role === "assistant" ? "model" : "user", parts });
    }
    return out;
  }

  #toolConfig(req: LlmRequest) {
    if (!req.toolChoice || req.toolChoice.type === "auto") {
      return { functionCallingConfig: { mode: "AUTO" } };
    }
    if (req.toolChoice.type === "none") {
      return { functionCallingConfig: { mode: "NONE" } };
    }
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [req.toolChoice.name],
      },
    };
  }
}

function toGeminiTool(t: LlmTool) {
  return { name: t.name, description: t.description, parameters: t.inputSchema };
}

function mapFinish(r: string | undefined): LlmResponse["finishReason"] {
  switch (r) {
    case "STOP": return "stop";
    case "MAX_TOKENS": return "length";
    case "SAFETY": return "safety";
    case "TOOL_USE": return "tool-use";
    default: return "stop";
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
