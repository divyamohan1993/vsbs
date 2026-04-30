// =============================================================================
// Pinned model versions — every role's binding is locked to a specific
// (provider, modelId, version) tuple. Drift is the silent killer for AI
// safety: a "minor" model update can change tool-use behaviour, refusal
// thresholds, and prompt-injection susceptibility. We pin everything and
// fail-fast on demo / prod startup if any required role has no pin.
//
// Env var convention:
//   VSBS_MODEL_PIN_<ROLE>=<provider>:<modelId>@<version>
// Example:
//   VSBS_MODEL_PIN_CONCIERGE=vertex-claude:claude-opus-4-6@2026-04-01
//   VSBS_MODEL_PIN_VERIFIER=vertex-claude:claude-haiku-4-5-20251001@2025-10-01
//
// The `capabilityProfile` slot tags what the model is qualified for
// (tool-use, deterministic-format, india-locale, etc.). Production uses it
// to check a role's binding meets the role's needs before swapping models.
// =============================================================================

import { z } from "zod";

import { AgentRole, ALL_ROLES } from "./roles.js";
import type { LlmProviderId } from "./types.js";

// -----------------------------------------------------------------------------
// Capability profile — small, ordered set of capabilities a role may require.
// -----------------------------------------------------------------------------

export const CapabilityProfileSchema = z.enum([
  "tool-use",
  "deterministic-format",
  "long-context",
  "india-locale",
  "low-cost",
  "high-stakes",
]);
export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

// -----------------------------------------------------------------------------
// ModelPin schema
// -----------------------------------------------------------------------------

export const ModelPinSchema = z.object({
  provider: z.enum([
    "google-ai-studio",
    "vertex-gemini",
    "vertex-claude",
    "anthropic",
    "openai",
    "scripted",
  ]),
  modelId: z.string().min(1),
  /** Free-form version tag — date-stamped is preferred (e.g. "2026-04-01"). */
  version: z.string().min(1),
  capabilityProfile: z.array(CapabilityProfileSchema).default([]),
  /** ISO 8601 timestamp when the pin was registered. */
  pinnedAt: z.string().datetime(),
});
export type ModelPin = z.infer<typeof ModelPinSchema>;

// -----------------------------------------------------------------------------
// Registry — small in-memory store keyed by AgentRole. Read-only outside
// configured loader paths. The registry is process-global by default; tests
// can construct their own instance.
// -----------------------------------------------------------------------------

export class ModelPinRegistry {
  readonly #pins = new Map<AgentRole, ModelPin>();

  put(role: AgentRole, pin: ModelPin): void {
    ModelPinSchema.parse(pin);
    this.#pins.set(role, pin);
  }

  get(role: AgentRole): ModelPin | undefined {
    return this.#pins.get(role);
  }

  has(role: AgentRole): boolean {
    return this.#pins.has(role);
  }

  /** All pins; iteration order is the canonical ALL_ROLES order. */
  all(): Array<{ role: AgentRole; pin: ModelPin }> {
    const out: Array<{ role: AgentRole; pin: ModelPin }> = [];
    for (const role of ALL_ROLES) {
      const pin = this.#pins.get(role);
      if (pin) out.push({ role, pin });
    }
    return out;
  }

  clear(): void {
    this.#pins.clear();
  }
}

// -----------------------------------------------------------------------------
// Env loader — reads VSBS_MODEL_PIN_<ROLE> from a process.env-shaped object.
//
// Format: <provider>:<modelId>@<version>[#<cap1>,<cap2>...]
//   - provider must be a valid LlmProviderId
//   - modelId may not be empty
//   - version may not be empty
//   - optional `#caps,caps` suffix maps to capabilityProfile (comma sep)
//
// The loader returns a fresh registry; callers can chain .put() for
// programmatic overrides.
// -----------------------------------------------------------------------------

export interface PinEnv {
  [key: string]: string | undefined;
}

const PROVIDER_ALLOW = new Set<LlmProviderId>([
  "google-ai-studio",
  "vertex-gemini",
  "vertex-claude",
  "anthropic",
  "openai",
  "scripted",
]);

export function parsePinEnvValue(value: string): {
  provider: LlmProviderId;
  modelId: string;
  version: string;
  capabilityProfile: CapabilityProfile[];
} {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("ModelPin: empty env value");
  const [head, capsTail] = trimmed.split("#", 2) as [string, string | undefined];
  const at = head.lastIndexOf("@");
  if (at <= 0) {
    throw new Error(
      `ModelPin: env value missing '@version' suffix (got "${value}"); expected provider:modelId@version`,
    );
  }
  const before = head.slice(0, at);
  const version = head.slice(at + 1);
  if (!version) throw new Error(`ModelPin: empty version in "${value}"`);
  const colon = before.indexOf(":");
  if (colon <= 0) {
    throw new Error(
      `ModelPin: env value missing 'provider:' prefix (got "${value}"); expected provider:modelId@version`,
    );
  }
  const provider = before.slice(0, colon) as LlmProviderId;
  const modelId = before.slice(colon + 1);
  if (!PROVIDER_ALLOW.has(provider)) {
    throw new Error(`ModelPin: unknown provider "${provider}" in "${value}"`);
  }
  if (!modelId) throw new Error(`ModelPin: empty modelId in "${value}"`);
  const capabilityProfile: CapabilityProfile[] = [];
  if (capsTail) {
    for (const raw of capsTail.split(",")) {
      const cap = raw.trim();
      if (!cap) continue;
      const parsed = CapabilityProfileSchema.safeParse(cap);
      if (!parsed.success) {
        throw new Error(`ModelPin: unknown capability "${cap}" in "${value}"`);
      }
      capabilityProfile.push(parsed.data);
    }
  }
  return { provider, modelId, version, capabilityProfile };
}

export function loadPinsFromEnv(env: PinEnv): ModelPinRegistry {
  const registry = new ModelPinRegistry();
  const at = new Date().toISOString();
  for (const role of ALL_ROLES) {
    const key = `VSBS_MODEL_PIN_${role.toUpperCase()}`;
    const raw = env[key];
    if (!raw) continue;
    const parsed = parsePinEnvValue(raw);
    registry.put(role, {
      provider: parsed.provider,
      modelId: parsed.modelId,
      version: parsed.version,
      capabilityProfile: parsed.capabilityProfile,
      pinnedAt: at,
    });
  }
  return registry;
}

// -----------------------------------------------------------------------------
// Validation — used by profiles.ts on startup.
// -----------------------------------------------------------------------------

export class MissingModelPinError extends Error {
  constructor(readonly missingRoles: AgentRole[], readonly profile: "demo" | "prod") {
    super(
      `LLM ${profile.toUpperCase()} profile requires a model pin for every role; missing: ${missingRoles.join(", ")}. ` +
        `Set VSBS_MODEL_PIN_<ROLE> in the environment.`,
    );
    this.name = "MissingModelPinError";
  }
}

/**
 * Assert every role has a pin. Throws MissingModelPinError on miss; safe to
 * call only on startup so the failure is loud and fail-fast.
 */
export function requireAllPins(
  registry: ModelPinRegistry,
  profile: "demo" | "prod",
): void {
  const missing: AgentRole[] = [];
  for (const role of ALL_ROLES) {
    if (!registry.has(role)) missing.push(role);
  }
  if (missing.length > 0) throw new MissingModelPinError(missing, profile);
}

// -----------------------------------------------------------------------------
// Sim-profile defaults — every role pinned to scripted-1@1.0.0 deterministically.
// -----------------------------------------------------------------------------

export function defaultSimPins(): ModelPinRegistry {
  const registry = new ModelPinRegistry();
  const at = new Date(0).toISOString(); // epoch — deterministic pinning timestamp for sim
  for (const role of ALL_ROLES) {
    registry.put(role, {
      provider: "scripted",
      modelId: "scripted-1",
      version: "1.0.0",
      capabilityProfile: ["deterministic-format"],
      pinnedAt: at,
    });
  }
  return registry;
}
