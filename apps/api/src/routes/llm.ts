// =============================================================================
// /v1/llm/* — diagnostic routes for the provider-agnostic LLM layer.
//
// These let you verify end-to-end that a given role resolves to a working
// (provider, model) binding and that tool-use plumbing actually works,
// regardless of whether you are in demo or prod profile.
// =============================================================================

import { Hono } from "hono";
import { zv } from "../middleware/zv.js";
import { z } from "zod";

import {
  AgentRole,
  LlmRegistry,
  type LlmEnv,
  type LlmRequest,
} from "@vsbs/llm";
import type { Env } from "../env.js";

export function buildLlmRouter(env: Env) {
  const router = new Hono();

  const llmEnv: LlmEnv = {
    LLM_PROFILE: env.LLM_PROFILE,
    ...(env.GOOGLE_AI_STUDIO_API_KEY !== undefined ? { GOOGLE_AI_STUDIO_API_KEY: env.GOOGLE_AI_STUDIO_API_KEY } : {}),
    GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT,
    VERTEX_AI_LOCATION: env.VERTEX_AI_LOCATION,
    ...(env.ANTHROPIC_API_KEY !== undefined ? { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } : {}),
    ...(env.OPENAI_API_KEY !== undefined ? { OPENAI_API_KEY: env.OPENAI_API_KEY } : {}),
  };
  const registry = new LlmRegistry(llmEnv);

  router.get("/config", (c) => {
    const bindings: Record<string, { provider: string; model: string }> = {};
    for (const role of Object.values(AgentRole)) {
      const b = registry.binding(role);
      bindings[role] = { provider: b.provider, model: b.model };
    }
    return c.json({ data: { profile: env.LLM_PROFILE, bindings } });
  });

  router.post(
    "/ping",
    zv(
      "json",
      z.object({
        role: z.enum([
          "concierge", "intake", "diagnosis", "dispatch",
          "wellbeing", "verifier", "autonomy", "payment",
        ]),
        prompt: z.string().max(4000),
      }),
    ),
    async (c) => {
      const { role, prompt } = c.req.valid("json");
      const client = registry.for(role as AgentRole);
      const req: LlmRequest = {
        purpose: `ping:${role}`,
        system:
          "You are a diagnostic ping. Respond with a single short sentence confirming you are reachable, and state the provider and model you are running on if you know them.",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxOutputTokens: 200,
      };
      try {
        const res = await client.complete(req);
        return c.json({
          data: {
            role,
            provider: res.provider,
            model: res.model,
            content: res.content,
            latencyMs: res.latencyMs,
            usage: res.usage,
            finishReason: res.finishReason,
          },
        });
      } catch (err) {
        return c.json({ error: { code: "LLM_ERROR", message: String(err) } }, 502);
      }
    },
  );

  return router;
}
