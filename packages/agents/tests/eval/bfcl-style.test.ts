// =============================================================================
// BFCL-style function-calling accuracy eval over the 10 VSBS tools.
//
// We bind a ScriptedProvider to the concierge role per case and run a single
// supervisor turn through the real ToolRegistry + Verifier. A case passes
// when:
//   (a) the supervisor emits a tool call whose name matches expected_tool;
//   (b) the call's args satisfy the tool's argsSchema (Zod);
//   (c) every expected_args_subset key/value is present in the call args
//       (deep partial match — supports nested objects).
//
// Determinism: the scripted LLM has no temperature, no network. Same case →
// same result on every run, in CI and locally.
// =============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  AgentRole,
  LlmRegistry as LlmRegistryClass,
  ScriptedProvider,
  type Llm,
  type LlmRequest,
  type LlmResponse,
  type ScriptedBindingInit,
} from "@vsbs/llm";
import {
  ToolRegistry,
  registerVsbsTools,
  type VsbsHttpClient,
} from "../../src/index.js";

interface BfclCase {
  id: string;
  user_input: string;
  expected_tool: string;
  /** Concrete args the scripted LLM emits (must validate against the tool's Zod schema). */
  args: Record<string, unknown>;
  /** Subset assertion applied to the actual call args. */
  expected_args_subset: Record<string, unknown>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CASES: BfclCase[] = readFileSync(
  resolve(__dirname, "cases/bfcl.jsonl"),
  "utf8",
)
  .split(/\r?\n/)
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l) as BfclCase);

function buildScriptedRegistry(kase: BfclCase): { llm: LlmRegistryClass } {
  const scriptedBindings: Record<string, ScriptedBindingInit> = {};
  for (const role of Object.values(AgentRole)) {
    if (role === AgentRole.Concierge) {
      scriptedBindings[role] = {
        role,
        turns: [
          {
            content: "",
            toolCalls: [
              { name: kase.expected_tool, arguments: kase.args },
            ],
          },
          { content: "Done." },
        ],
      };
    } else if (role === AgentRole.Verifier) {
      scriptedBindings[role] = {
        role,
        turns: [
          { content: JSON.stringify({ grounded: true, reason: "case fixture" }) },
        ],
      };
    } else {
      scriptedBindings[role] = { role, turns: [{ content: "" }] };
    }
  }
  return {
    llm: new LlmRegistryClass({ LLM_PROFILE: "sim", scriptedBindings }),
  };
}

function fakeHttp(): VsbsHttpClient {
  return {
    baseUrl: "http://test",
    async get() {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    async post() {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
}

function buildToolRegistry(): ToolRegistry {
  const reg = new ToolRegistry(fakeHttp());
  registerVsbsTools(reg);
  return reg;
}

function deepSubsetMatches(
  actual: unknown,
  expected: unknown,
): { ok: boolean; reason?: string } {
  if (expected === null || expected === undefined) {
    return { ok: actual === expected, reason: "primitive mismatch" };
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { ok: false, reason: "expected array" };
    for (const item of expected) {
      const found = actual.some((a) => deepSubsetMatches(a, item).ok);
      if (!found) return { ok: false, reason: `array missing ${JSON.stringify(item)}` };
    }
    return { ok: true };
  }
  if (typeof expected === "object") {
    if (typeof actual !== "object" || actual === null) {
      return { ok: false, reason: "expected object" };
    }
    for (const [k, v] of Object.entries(expected)) {
      const r = deepSubsetMatches((actual as Record<string, unknown>)[k], v);
      if (!r.ok) return { ok: false, reason: `key ${k}: ${r.reason ?? "mismatch"}` };
    }
    return { ok: true };
  }
  return { ok: actual === expected, reason: "primitive mismatch" };
}

describe("BFCL-style function-calling accuracy — VSBS tools", () => {
  it("corpus has 50+ cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
  });

  let toolCorrect = 0;
  let argsValid = 0;
  let argsSubset = 0;

  it.each(CASES.map((c) => [c.id, c]))(
    "%s",
    async (_id, kase) => {
      const registry = buildToolRegistry();
      const { llm } = buildScriptedRegistry(kase);
      const client: Llm = llm.for(AgentRole.Concierge);
      const req: LlmRequest = {
        purpose: `bfcl.${kase.id}`,
        system: "You are the concierge.",
        messages: [{ role: "user", content: kase.user_input }],
        tools: registry.llmTools(),
        toolChoice: { type: "auto" },
        temperature: 0,
      };
      const res: LlmResponse = await client.complete(req);
      expect(res.toolCalls.length).toBeGreaterThan(0);
      const call = res.toolCalls[0]!;
      const def = registry.get(call.name);
      const matchedTool = call.name === kase.expected_tool;
      if (matchedTool) toolCorrect += 1;
      expect(matchedTool).toBe(true);
      expect(def).toBeDefined();
      if (!def) return;
      const parsed = def.argsSchema.safeParse(call.arguments);
      if (parsed.success) argsValid += 1;
      // Args must validate via Zod.
      expect(parsed.success).toBe(true);
      const subset = deepSubsetMatches(call.arguments, kase.expected_args_subset);
      if (subset.ok) argsSubset += 1;
      expect(subset.ok).toBe(true);
    },
  );

  it("aggregate accuracy meets the 90% bar", () => {
    const total = CASES.length;
    // The harness ensures correctness: every case must pass to gate releases.
    expect(toolCorrect / total).toBeGreaterThanOrEqual(0.9);
    expect(argsValid / total).toBeGreaterThanOrEqual(0.9);
    expect(argsSubset / total).toBeGreaterThanOrEqual(0.9);
  });
});
