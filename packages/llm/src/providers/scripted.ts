// =============================================================================
// Scripted LLM provider — the sim driver for the LLM layer.
//
// Purpose: run the full agent pipeline end-to-end (LangGraph supervisor,
// tool calls, verifier chain, SSE streaming to the web) with ZERO external
// API calls and ZERO API keys. Promotion to any live provider is a
// single LLM_PROFILE flip; no other code changes — per the repo-wide
// simulation-policy invariant (docs/simulation-policy.md).
//
// Behaviour: for each (role, turn-index) the scripted provider returns a
// deterministic response matching the normalised Llm interface. Agent
// code and prompts are unchanged between sim and live — only the
// transport (canned response vs. real HTTP call) differs.
//
// The script is keyed by AgentRole; each role has a list of turn
// responses that advance round-robin through the conversation. A turn
// can either (a) emit text content, (b) emit one or more tool calls, or
// (c) both. The verifier role has its own script that always approves
// the latest tool call so tool-use exercising is unconstrained.
// =============================================================================

import type {
  Llm,
  LlmProviderId,
  LlmRequest,
  LlmResponse,
  LlmToolCall,
} from "../types.js";

export interface ScriptedTurn {
  content?: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

export interface ScriptedBindingInit {
  role: string; // e.g. "concierge", "intake", "verifier" — matches AgentRole
  turns: ScriptedTurn[];
  /** Loops the last turn forever once exhausted (default true). */
  loopLastTurn?: boolean;
}

/**
 * A scripted response sequence per role. Instances are memoised on the
 * provider so repeated turns advance deterministically.
 */
export class ScriptedProvider implements Llm {
  readonly provider: LlmProviderId = "scripted" as LlmProviderId;
  readonly model: string;
  readonly #turns: ScriptedTurn[];
  readonly #loop: boolean;
  #cursor = 0;

  constructor(init: { role: string; model?: string; turns: ScriptedTurn[]; loopLastTurn?: boolean }) {
    this.model = init.model ?? `scripted:${init.role}`;
    this.#turns = init.turns.length > 0 ? init.turns : [{ content: "" }];
    this.#loop = init.loopLastTurn ?? true;
  }

  async complete(_req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const idx = this.#nextIndex();
    const turn = this.#turns[idx] ?? { content: "" };
    const toolCalls: LlmToolCall[] =
      turn.toolCalls?.map((tc, i) => ({
        id: `scripted_${idx}_${i}_${Date.now().toString(36)}`,
        name: tc.name,
        arguments: tc.arguments,
      })) ?? [];
    // Short async hop so downstream timing assertions are consistent.
    await new Promise((r) => setTimeout(r, 1));
    return {
      content: turn.content ?? "",
      toolCalls,
      model: this.model,
      provider: this.provider,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: Date.now() - started,
      finishReason: toolCalls.length > 0 ? "tool-use" : "stop",
    };
  }

  #nextIndex(): number {
    const cur = this.#cursor;
    const last = this.#turns.length - 1;
    if (this.#cursor < last) {
      this.#cursor += 1;
    } else if (!this.#loop) {
      this.#cursor = last;
    }
    return Math.min(cur, last);
  }

  /** For tests: rewind the cursor. */
  reset(): void {
    this.#cursor = 0;
  }
}

/**
 * A built-in happy-path script for the VSBS concierge pipeline. The script
 * walks a conversation where the user reports a grinding-on-brake symptom
 * on a known Honda and ends with a confirmed drive-in booking.
 *
 * Every tool name here must exist in the VSBS tool registry (see
 * packages/agents/src/tools/vsbs.ts). The verifier always approves.
 */
export function defaultVsbsScripts(): Record<string, ScriptedBindingInit> {
  return {
    concierge: {
      role: "concierge",
      turns: [
        {
          content: "",
          toolCalls: [
            {
              name: "assessSafety",
              arguments: {
                owner: {
                  canDriveSafely: "yes-cautiously",
                  redFlags: [],
                },
                sensorFlags: [],
              },
            },
          ],
        },
        {
          content: "",
          toolCalls: [
            {
              name: "scoreWellbeing",
              arguments: {
                safety: 0.85,
                wait: 0.8,
                cti: 0.85,
                timeAccuracy: 0.9,
                servqual: 0.8,
                trust: 0.8,
                continuity: 0.9,
                ces: 0.9,
                csat: 0.9,
                nps: 0.7,
              },
            },
          ],
        },
        {
          content:
            "Based on what you told me, the vehicle is safe to drive in the short term. The most likely cause of a grinding noise when braking is worn front brake pads. I am recommending a drive-in at the nearest authorised service centre for a brake-pad inspection and replacement. Your wellbeing score for this option is high. You can override this recommendation at any time.",
        },
      ],
    },
    intake: {
      role: "intake",
      turns: [
        {
          content:
            "Captured: 2024 Honda Civic, grinding noise when braking from moderate speed, no warning lights, driver reports vehicle feels safe but cautious.",
        },
      ],
    },
    diagnosis: {
      role: "diagnosis",
      turns: [
        {
          content:
            "Differential diagnosis: (1) worn front brake pads (most likely, noise on braking deceleration); (2) warped rotors (less likely without pedal pulsation); (3) caliper contamination (low likelihood). Recommended: front brake pad + rotor inspection. Source: generic SAE J2012 DTC family + common-fault knowledge base.",
        },
      ],
    },
    dispatch: {
      role: "dispatch",
      turns: [
        {
          content:
            "Dispatch plan: drive-in at partner service centre, estimated 12 km, 18 min travel, 45 min wait, 90 min service. Tow not required. Mobile mechanic not preferred because pads require a lift.",
        },
      ],
    },
    wellbeing: {
      role: "wellbeing",
      turns: [
        {
          content:
            "Composite wellbeing score 0.85 (excellent). Safety dominates the score because the vehicle is drivable. Cost transparency is high because the quote will be itemised pre-commit.",
        },
      ],
    },
    verifier: {
      role: "verifier",
      turns: [
        // The verifier prompt in packages/agents/src/verifier.ts asks for
        // strict JSON with fields {grounded, reason}. We always approve in
        // sim so the tool-use plumbing can be exercised end-to-end.
        {
          content: JSON.stringify({
            grounded: true,
            reason: "Tool arguments are consistent with the owner's stated symptoms and the prior turn.",
          }),
        },
      ],
    },
    autonomy: {
      role: "autonomy",
      turns: [
        {
          content:
            "Autonomy Tier A unavailable for this vehicle at the destination service centre. Falling back to human drive-in.",
        },
      ],
    },
    payment: {
      role: "payment",
      turns: [
        {
          content:
            "Estimated cost ₹4,500 to ₹7,200 (parts + labour). Under your auto-pay cap of ₹0, so manual approval required at settlement.",
        },
      ],
    },
  };
}
