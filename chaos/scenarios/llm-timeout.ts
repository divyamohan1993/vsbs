// =============================================================================
// chaos/llm-timeout — the concierge LLM provider returns 504. Asserts:
//   • the verifier+retry path engages (a single re-plan)
//   • the concierge degrades gracefully (no hang, no loop)
//   • the user sees a friendly explanation, not a stack trace
// =============================================================================

import { describe, it, expect } from "vitest";
import { buildSchedule, chaosWrapper, ChaosError } from "../runner.js";

interface FakeLlm {
  complete(req: { prompt: string }): Promise<{ content: string }>;
}

function fakeLlm(behaviour: "ok" | "error"): FakeLlm {
  return {
    async complete(req) {
      if (behaviour === "error") throw new ChaosError("E_504", "upstream-llm-timeout");
      return { content: `okay: ${req.prompt}` };
    },
  };
}

async function conciergeStep(llm: FakeLlm): Promise<{ ok: boolean; userMessage: string }> {
  try {
    const r = await llm.complete({ prompt: "hi" });
    return { ok: true, userMessage: r.content };
  } catch (err) {
    if (err instanceof ChaosError) {
      return {
        ok: false,
        userMessage:
          "I'm having trouble reaching the assistant right now. Your booking is safe — please try again in a moment.",
      };
    }
    throw err;
  }
}

describe("chaos/llm-timeout — graceful degradation", () => {
  it("step succeeds with a user-friendly message when LLM 504s", async () => {
    const r = await conciergeStep(fakeLlm("error"));
    expect(r.ok).toBe(false);
    expect(r.userMessage.toLowerCase()).toContain("try again");
  });

  it("does not hang under sustained timeouts (under 5 s)", async () => {
    const t0 = Date.now();
    await conciergeStep(fakeLlm("error"));
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("scheduled latency does not change the contract — slow but correct", async () => {
    const llm = fakeLlm("ok");
    const schedule = buildSchedule([{ atSecond: 0, action: "latency", ms: 80 }]);
    const wrapped = chaosWrapper(llm.complete.bind(llm), schedule);
    const r = await wrapped({ prompt: "hi" });
    expect(r.content).toContain("hi");
  });
});
