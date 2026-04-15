// =============================================================================
// Registry — reads env vars, applies profile defaults, builds a concrete
// provider client per role, and memoises the clients.
//
// Env var conventions:
//   LLM_PROFILE=demo | prod | custom
//
//   Per-role overrides (any role can deviate from the profile default):
//     LLM_<ROLE>_PROVIDER=google-ai-studio | vertex-gemini | vertex-claude | anthropic | openai
//     LLM_<ROLE>_MODEL=<model id>
//
//   Provider credentials (only the ones you use need to be set):
//     GOOGLE_AI_STUDIO_API_KEY     # demo default; free tier available
//     GOOGLE_CLOUD_PROJECT         # vertex-*
//     VERTEX_AI_LOCATION           # vertex-*
//     ANTHROPIC_API_KEY            # direct Anthropic, optional
//     OPENAI_API_KEY               # optional
//
// Switching demo → prod is flipping LLM_PROFILE=prod. That is the only
// change. No prompt, no tool, no code difference.
// =============================================================================

import { AgentRole, ALL_ROLES } from "./roles.js";
import { PROFILES, type Profile, type RoleBinding } from "./profiles.js";
import type { Llm, LlmProviderId } from "./types.js";
import { GoogleAiStudioProvider } from "./providers/google-ai-studio.js";
import { VertexGeminiProvider } from "./providers/vertex-gemini.js";
import { VertexClaudeProvider } from "./providers/vertex-claude.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAiProvider } from "./providers/openai.js";
import { ScriptedProvider, defaultVsbsScripts, type ScriptedBindingInit } from "./providers/scripted.js";

export interface LlmEnv {
  LLM_PROFILE: "sim" | "demo" | "prod" | "custom";
  GOOGLE_AI_STUDIO_API_KEY?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  VERTEX_AI_LOCATION?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /**
   * Optional override for the scripted provider's per-role scripts.
   * Defaults to `defaultVsbsScripts()` when LLM_PROFILE=sim.
   */
  scriptedBindings?: Record<string, ScriptedBindingInit>;
  /** Optional per-role overrides — key is UPPERCASE role. */
  perRole?: Partial<Record<string, { provider?: LlmProviderId; model?: string }>>;
}

export class LlmRegistry {
  readonly #bindings: Record<AgentRole, RoleBinding>;
  readonly #env: LlmEnv;
  readonly #clients = new Map<string, Llm>();

  constructor(env: LlmEnv) {
    this.#env = env;
    const profile: Profile =
      env.LLM_PROFILE === "prod"
        ? PROFILES.prod
        : env.LLM_PROFILE === "sim"
          ? PROFILES.sim
          : PROFILES.demo;
    const merged: Record<AgentRole, RoleBinding> = { ...profile };
    for (const role of ALL_ROLES) {
      const override = env.perRole?.[role.toUpperCase()];
      if (override?.provider || override?.model) {
        const base = merged[role];
        merged[role] = {
          provider: override.provider ?? base.provider,
          model: override.model ?? base.model,
        };
      }
    }
    this.#bindings = merged;
  }

  binding(role: AgentRole): RoleBinding {
    return this.#bindings[role];
  }

  for(role: AgentRole): Llm {
    const { provider, model } = this.#bindings[role];
    // Scripted provider keys per-role so each role's cursor advances
    // independently. Network providers key per (provider, model).
    const key = provider === "scripted" ? `scripted::${role}` : `${provider}::${model}`;
    const existing = this.#clients.get(key);
    if (existing) return existing;
    const built = this.#build(provider, model, role);
    this.#clients.set(key, built);
    return built;
  }

  #build(provider: LlmProviderId, model: string, role: AgentRole): Llm {
    switch (provider) {
      case "scripted": {
        const bindings = this.#env.scriptedBindings ?? defaultVsbsScripts();
        const init = bindings[role] ?? { role, turns: [{ content: "" }] };
        return new ScriptedProvider({ role, model, turns: init.turns, ...(init.loopLastTurn !== undefined ? { loopLastTurn: init.loopLastTurn } : {}) });
      }
      case "google-ai-studio": {
        if (!this.#env.GOOGLE_AI_STUDIO_API_KEY) {
          throw new Error("LLM provider google-ai-studio needs GOOGLE_AI_STUDIO_API_KEY");
        }
        return new GoogleAiStudioProvider({ apiKey: this.#env.GOOGLE_AI_STUDIO_API_KEY, model });
      }
      case "vertex-gemini": {
        if (!this.#env.GOOGLE_CLOUD_PROJECT || !this.#env.VERTEX_AI_LOCATION) {
          throw new Error("LLM provider vertex-gemini needs GOOGLE_CLOUD_PROJECT and VERTEX_AI_LOCATION");
        }
        return new VertexGeminiProvider({
          project: this.#env.GOOGLE_CLOUD_PROJECT,
          location: this.#env.VERTEX_AI_LOCATION,
          model,
        });
      }
      case "vertex-claude": {
        if (!this.#env.GOOGLE_CLOUD_PROJECT || !this.#env.VERTEX_AI_LOCATION) {
          throw new Error("LLM provider vertex-claude needs GOOGLE_CLOUD_PROJECT and VERTEX_AI_LOCATION");
        }
        return new VertexClaudeProvider({
          project: this.#env.GOOGLE_CLOUD_PROJECT,
          location: this.#env.VERTEX_AI_LOCATION,
          model,
        });
      }
      case "anthropic": {
        if (!this.#env.ANTHROPIC_API_KEY) {
          throw new Error("LLM provider anthropic needs ANTHROPIC_API_KEY");
        }
        return new AnthropicProvider({ apiKey: this.#env.ANTHROPIC_API_KEY, model });
      }
      case "openai": {
        if (!this.#env.OPENAI_API_KEY) {
          throw new Error("LLM provider openai needs OPENAI_API_KEY");
        }
        return new OpenAiProvider({ apiKey: this.#env.OPENAI_API_KEY, model });
      }
    }
  }
}
