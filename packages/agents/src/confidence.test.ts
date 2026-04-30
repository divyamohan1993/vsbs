// =============================================================================
// Confidence envelope + gate — unit tests.
// =============================================================================

import { describe, it, expect } from "vitest";

import {
  ConfidenceFloor,
  ToolResultEnvelopeMetadataSchema,
  ToolResultEnvelopeSchema,
  envelope,
  isEnvelope,
  unwrapForLegacyCallers,
  runConfidenceGate,
} from "./confidence.js";
import type { ToolResult } from "./types.js";
import { z } from "zod";

describe("envelope() construction + helpers", () => {
  it("wraps a value with default confidence 1 and floor 0.6", () => {
    const env = envelope({ x: 1 }, { source: "deterministic" });
    expect(env.value).toEqual({ x: 1 });
    expect(env.confidence).toBe(1);
    expect(env.confidenceFloor).toBe(0.6);
    expect(env.source).toBe("deterministic");
    expect(env.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("supports an explicit confidence and note", () => {
    const env = envelope("ok", { confidence: 0.5, source: "engine:wellbeing", note: "thin signal" });
    expect(env.confidence).toBe(0.5);
    expect(env.note).toBe("thin signal");
  });

  it("ConfidenceFloor is 0.6", () => {
    expect(ConfidenceFloor).toBe(0.6);
  });

  it("ToolResultEnvelopeMetadataSchema parses a well-formed metadata object", () => {
    const parsed = ToolResultEnvelopeMetadataSchema.parse({
      confidence: 0.7,
      confidenceFloor: 0.6,
      source: "test",
      computedAt: new Date().toISOString(),
    });
    expect(parsed.confidence).toBe(0.7);
  });

  it("ToolResultEnvelopeSchema(value) builds a per-T schema", () => {
    const schema = ToolResultEnvelopeSchema(z.object({ foo: z.string() }));
    const parsed = schema.parse({
      value: { foo: "bar" },
      confidence: 1,
      source: "x",
      confidenceFloor: 0.6,
      computedAt: new Date().toISOString(),
    });
    expect(parsed.value.foo).toBe("bar");
  });
});

describe("isEnvelope + unwrapForLegacyCallers", () => {
  it("identifies an envelope", () => {
    const env = envelope("hi", { source: "x" });
    expect(isEnvelope(env)).toBe(true);
  });

  it("does not identify a raw object", () => {
    expect(isEnvelope({ value: 1 })).toBe(false);
    expect(isEnvelope("string")).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });

  it("unwraps an envelope, passes raw values through", () => {
    const env = envelope({ a: 1 }, { source: "x" });
    expect(unwrapForLegacyCallers(env)).toEqual({ a: 1 });
    expect(unwrapForLegacyCallers({ a: 1 })).toEqual({ a: 1 });
    expect(unwrapForLegacyCallers("plain")).toBe("plain");
  });
});

describe("runConfidenceGate", () => {
  function makeResult(name: string, env: unknown, ok = true): ToolResult {
    return {
      toolCallId: `tc-${name}`,
      toolName: name,
      ok,
      data: env,
      latencyMs: 1,
    };
  }

  it("returns belowFloor=false when every envelope is at or above the floor", () => {
    const results: ToolResult[] = [
      makeResult("assessSafety", envelope({}, { confidence: 1, source: "engine:safety" })),
      makeResult("driveEta", envelope({}, { confidence: 0.85, source: "adapter:routes" })),
    ];
    const v = runConfidenceGate(results);
    expect(v.belowFloor).toBe(false);
    expect(v.details.length).toBe(2);
  });

  it("returns belowFloor=true when at least one envelope is below floor", () => {
    const results: ToolResult[] = [
      makeResult("assessSafety", envelope({}, { confidence: 1, source: "engine:safety" })),
      makeResult("driveEta", envelope({}, { confidence: 0.4, source: "adapter:routes" })),
    ];
    const v = runConfidenceGate(results);
    expect(v.belowFloor).toBe(true);
    const eta = v.details.find((d) => d.toolName === "driveEta");
    expect(eta?.belowFloor).toBe(true);
  });

  it("ignores non-envelope payloads (legacy shim path)", () => {
    const results: ToolResult[] = [
      makeResult("legacyTool", { rawShape: true }),
      makeResult("envelopeTool", envelope({}, { confidence: 0.4, source: "x" })),
    ];
    const v = runConfidenceGate(results);
    expect(v.details.length).toBe(1);
    expect(v.details[0]!.toolName).toBe("envelopeTool");
    expect(v.belowFloor).toBe(true);
  });

  it("ignores failed tool calls", () => {
    const results: ToolResult[] = [
      makeResult("assessSafety", envelope({}, { confidence: 0.1, source: "x" }), false),
      makeResult("driveEta", envelope({}, { confidence: 0.9, source: "x" })),
    ];
    const v = runConfidenceGate(results);
    expect(v.details.length).toBe(1);
    expect(v.belowFloor).toBe(false);
  });

  it("supports a custom confidenceFloor per envelope", () => {
    const results: ToolResult[] = [
      makeResult("strictTool", envelope({}, { confidence: 0.7, confidenceFloor: 0.95, source: "x" })),
    ];
    const v = runConfidenceGate(results);
    expect(v.belowFloor).toBe(true);
    expect(v.details[0]!.floor).toBe(0.95);
  });
});
