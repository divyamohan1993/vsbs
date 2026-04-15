// @vsbs/llm — provider-agnostic LLM layer.
//
// The promise: swap model or provider by changing the env vars, not the
// code. Every agent role in the system (concierge, intake, diagnosis,
// dispatch, wellbeing, verifier, autonomy, payment) resolves to a
// concrete (provider, model) pair at startup via `loadLlmConfig()` and
// uses the same `Llm.complete()` interface thereafter.
//
// See packages/llm/src/profiles.ts for the demo / prod defaults, and
// docs/simulation-policy.md for the parity invariant between modes.

export * from "./types.js";
export * from "./roles.js";
export * from "./profiles.js";
export * from "./registry.js";
export * from "./providers/google-ai-studio.js";
export * from "./providers/vertex-gemini.js";
export * from "./providers/vertex-claude.js";
export * from "./providers/anthropic.js";
export * from "./providers/openai.js";
export * from "./providers/scripted.js";
