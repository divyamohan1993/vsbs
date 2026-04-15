// =============================================================================
// Demo vs Prod profile defaults.
//
// INVARIANT: switching profiles changes only (provider, model) per role.
// Prompts, tools, LangGraph topology, verifier chains, retrieval, and UI
// do not change. Promotion is purely a config flip.
// =============================================================================

import { AgentRole } from "./roles.js";
import type { LlmProviderId } from "./types.js";

export interface RoleBinding {
  provider: LlmProviderId;
  model: string;
}

export type Profile = Record<AgentRole, RoleBinding>;

/**
 * DEMO profile — cheapest viable path. Google AI Studio Gemini 2.5
 * Flash-Lite everywhere except diagnosis, which gets Flash for slightly
 * better reasoning. Free-tier friendly for PhD research + public demo.
 *
 * Flash-Lite is Google's lowest-cost tool-use-capable model in the 2.5
 * family and is adequate for every role here when the prompts and
 * tool-use boundaries carry the semantic weight (which they do).
 */
export const PROFILE_DEMO: Profile = {
  [AgentRole.Concierge]: { provider: "google-ai-studio", model: "gemini-2.5-flash-lite" },
  [AgentRole.Intake]:    { provider: "google-ai-studio", model: "gemini-2.5-flash-lite" },
  [AgentRole.Diagnosis]: { provider: "google-ai-studio", model: "gemini-2.5-flash" },
  [AgentRole.Dispatch]:  { provider: "google-ai-studio", model: "gemini-2.5-flash-lite" },
  [AgentRole.Wellbeing]: { provider: "google-ai-studio", model: "gemini-2.5-flash-lite" },
  [AgentRole.Verifier]:  { provider: "google-ai-studio", model: "gemini-2.5-flash-lite" },
  [AgentRole.Autonomy]:  { provider: "google-ai-studio", model: "gemini-2.5-flash" },
  [AgentRole.Payment]:   { provider: "google-ai-studio", model: "gemini-2.5-flash-lite" },
};

/**
 * PROD profile — best available April 2026, inside GCP via Vertex AI so
 * the whole stack authenticates with Workload Identity in
 * `lmsforshantithakur`. Opus for the high-stakes roles, Haiku for the
 * cheap specialist + verifier, Gemini 3 for the grounded-search roles.
 */
export const PROFILE_PROD: Profile = {
  [AgentRole.Concierge]: { provider: "vertex-claude", model: "claude-opus-4-6" },
  [AgentRole.Intake]:    { provider: "vertex-gemini", model: "gemini-3-flash" },
  [AgentRole.Diagnosis]: { provider: "vertex-claude", model: "claude-opus-4-6" },
  [AgentRole.Dispatch]:  { provider: "vertex-gemini", model: "gemini-3-pro" },
  [AgentRole.Wellbeing]: { provider: "vertex-gemini", model: "gemini-3-flash" },
  [AgentRole.Verifier]:  { provider: "vertex-claude", model: "claude-haiku-4-5-20251001" },
  [AgentRole.Autonomy]:  { provider: "vertex-claude", model: "claude-opus-4-6" },
  [AgentRole.Payment]:   { provider: "vertex-claude", model: "claude-haiku-4-5-20251001" },
};

/**
 * SIM profile — every role uses the in-process scripted provider. No
 * API keys, no network. Used for end-to-end demos, CI, and the default
 * `pnpm dev` experience. Promotion to `demo` or `prod` flips ONE env
 * var (LLM_PROFILE) and nothing else.
 */
export const PROFILE_SIM: Profile = {
  [AgentRole.Concierge]: { provider: "scripted", model: "scripted:concierge" },
  [AgentRole.Intake]:    { provider: "scripted", model: "scripted:intake" },
  [AgentRole.Diagnosis]: { provider: "scripted", model: "scripted:diagnosis" },
  [AgentRole.Dispatch]:  { provider: "scripted", model: "scripted:dispatch" },
  [AgentRole.Wellbeing]: { provider: "scripted", model: "scripted:wellbeing" },
  [AgentRole.Verifier]:  { provider: "scripted", model: "scripted:verifier" },
  [AgentRole.Autonomy]:  { provider: "scripted", model: "scripted:autonomy" },
  [AgentRole.Payment]:   { provider: "scripted", model: "scripted:payment" },
};

export const PROFILES: Record<"sim" | "demo" | "prod", Profile> = {
  sim: PROFILE_SIM,
  demo: PROFILE_DEMO,
  prod: PROFILE_PROD,
};
