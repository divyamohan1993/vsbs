// =============================================================================
// version-pin — env loader, registry, fail-fast for demo/prod, sim defaults.
// =============================================================================

import { describe, it, expect } from "vitest";

import { AgentRole, ALL_ROLES } from "./roles.js";
import {
  MissingModelPinError,
  ModelPinRegistry,
  ModelPinSchema,
  defaultSimPins,
  loadPinsFromEnv,
  parsePinEnvValue,
  requireAllPins,
} from "./version-pin.js";
import { resolveProfileWithPins } from "./profiles.js";

describe("ModelPinSchema", () => {
  it("requires provider, modelId, version, pinnedAt", () => {
    expect(() =>
      ModelPinSchema.parse({
        provider: "vertex-claude",
        modelId: "claude-opus-4-6",
        version: "2026-04-01",
        capabilityProfile: ["tool-use"],
        pinnedAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      ModelPinSchema.parse({
        provider: "made-up",
        modelId: "x",
        version: "1.0",
        capabilityProfile: [],
        pinnedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe("parsePinEnvValue", () => {
  it("parses provider:model@version", () => {
    const p = parsePinEnvValue("vertex-claude:claude-opus-4-6@2026-04-01");
    expect(p.provider).toBe("vertex-claude");
    expect(p.modelId).toBe("claude-opus-4-6");
    expect(p.version).toBe("2026-04-01");
    expect(p.capabilityProfile).toEqual([]);
  });

  it("parses optional capability profile", () => {
    const p = parsePinEnvValue("vertex-claude:claude-haiku-4-5-20251001@2025-10-01#tool-use,low-cost");
    expect(p.capabilityProfile).toEqual(["tool-use", "low-cost"]);
  });

  it("rejects an empty value", () => {
    expect(() => parsePinEnvValue("")).toThrow(/empty/);
  });

  it("rejects missing @version", () => {
    expect(() => parsePinEnvValue("vertex-claude:claude-opus-4-6")).toThrow(/version/);
  });

  it("rejects missing provider colon", () => {
    expect(() => parsePinEnvValue("claude-opus-4-6@2026-04-01")).toThrow(/provider/);
  });

  it("rejects unknown provider", () => {
    expect(() => parsePinEnvValue("bogus:m@v")).toThrow(/unknown provider/);
  });

  it("rejects unknown capability", () => {
    expect(() => parsePinEnvValue("vertex-claude:m@v#bogus")).toThrow(/unknown capability/);
  });
});

describe("loadPinsFromEnv", () => {
  it("loads a per-role pin from VSBS_MODEL_PIN_<ROLE>", () => {
    const env: Record<string, string> = {};
    for (const role of ALL_ROLES) {
      env[`VSBS_MODEL_PIN_${role.toUpperCase()}`] = `vertex-claude:claude-opus-4-6@2026-04-01`;
    }
    const reg = loadPinsFromEnv(env);
    for (const role of ALL_ROLES) {
      const pin = reg.get(role);
      expect(pin?.modelId).toBe("claude-opus-4-6");
      expect(pin?.version).toBe("2026-04-01");
    }
  });

  it("ignores roles with no env value", () => {
    const env = { VSBS_MODEL_PIN_CONCIERGE: "vertex-claude:claude-opus-4-6@2026-04-01" };
    const reg = loadPinsFromEnv(env);
    expect(reg.has(AgentRole.Concierge)).toBe(true);
    expect(reg.has(AgentRole.Verifier)).toBe(false);
  });
});

describe("requireAllPins fail-fast", () => {
  it("throws MissingModelPinError when any role is missing", () => {
    const reg = new ModelPinRegistry();
    reg.put(AgentRole.Concierge, {
      provider: "vertex-claude",
      modelId: "claude-opus-4-6",
      version: "2026-04-01",
      capabilityProfile: [],
      pinnedAt: new Date().toISOString(),
    });
    expect(() => requireAllPins(reg, "prod")).toThrow(MissingModelPinError);
    expect(() => requireAllPins(reg, "demo")).toThrow(MissingModelPinError);
  });

  it("succeeds when every role has a pin", () => {
    const reg = new ModelPinRegistry();
    for (const role of ALL_ROLES) {
      reg.put(role, {
        provider: "vertex-gemini",
        modelId: "gemini-3-flash",
        version: "2026-04-01",
        capabilityProfile: ["tool-use"],
        pinnedAt: new Date().toISOString(),
      });
    }
    expect(() => requireAllPins(reg, "demo")).not.toThrow();
    expect(() => requireAllPins(reg, "prod")).not.toThrow();
  });
});

describe("defaultSimPins", () => {
  it("pins every role to scripted-1@1.0.0", () => {
    const reg = defaultSimPins();
    for (const role of ALL_ROLES) {
      const pin = reg.get(role);
      expect(pin?.provider).toBe("scripted");
      expect(pin?.modelId).toBe("scripted-1");
      expect(pin?.version).toBe("1.0.0");
    }
  });
});

describe("resolveProfileWithPins", () => {
  it("sim returns the SIM profile and the deterministic scripted-1 pins", () => {
    const r = resolveProfileWithPins("sim");
    expect(r.profile).toBeDefined();
    for (const role of ALL_ROLES) {
      expect(r.pins.get(role)?.modelId).toBe("scripted-1");
    }
  });

  it("demo throws MissingModelPinError when env is empty", () => {
    expect(() => resolveProfileWithPins("demo", {})).toThrow(MissingModelPinError);
  });

  it("prod throws MissingModelPinError when env is empty", () => {
    expect(() => resolveProfileWithPins("prod", {})).toThrow(MissingModelPinError);
  });

  it("demo succeeds when every role pin is set", () => {
    const env: Record<string, string> = {};
    for (const role of ALL_ROLES) {
      env[`VSBS_MODEL_PIN_${role.toUpperCase()}`] = "google-ai-studio:gemini-2.5-flash-lite@2026-01-01";
    }
    const r = resolveProfileWithPins("demo", env);
    for (const role of ALL_ROLES) {
      expect(r.profile[role].provider).toBe("google-ai-studio");
      expect(r.profile[role].model).toBe("gemini-2.5-flash-lite");
      expect(r.pins.get(role)?.version).toBe("2026-01-01");
    }
  });

  it("prod fails fast and reports every missing role in the error message", () => {
    try {
      resolveProfileWithPins("prod", {});
    } catch (err) {
      const e = err as MissingModelPinError;
      expect(e.missingRoles.length).toBe(ALL_ROLES.length);
      expect(e.profile).toBe("prod");
      return;
    }
    expect.fail("expected MissingModelPinError");
  });
});

describe("ModelPinRegistry CRUD", () => {
  it("put/get/has/clear roundtrip", () => {
    const reg = new ModelPinRegistry();
    expect(reg.has(AgentRole.Concierge)).toBe(false);
    reg.put(AgentRole.Concierge, {
      provider: "scripted",
      modelId: "scripted-1",
      version: "1.0.0",
      capabilityProfile: [],
      pinnedAt: new Date().toISOString(),
    });
    expect(reg.has(AgentRole.Concierge)).toBe(true);
    expect(reg.get(AgentRole.Concierge)?.modelId).toBe("scripted-1");
    expect(reg.all().length).toBe(1);
    reg.clear();
    expect(reg.has(AgentRole.Concierge)).toBe(false);
  });
});
