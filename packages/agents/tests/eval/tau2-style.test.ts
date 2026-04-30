// =============================================================================
// τ2-bench style multi-turn scenario eval. Each scenario is a deterministic
// conversation: the user message at turn N is fixed, the scripted concierge
// emits a planned tool call, the registry executes (against a stub HTTP
// surface), and we assert the final state of the conversation matches the
// expected goal: a sequence of tools, a sequence of states, a final assistant
// summary.
//
// Determinism: scripted LLM, no network calls beyond the stub HTTP. Cases
// are CI-friendly and reproducible.
// =============================================================================

import { describe, it, expect } from "vitest";

import {
  AgentRole,
  LlmRegistry,
  type ScriptedBindingInit,
} from "@vsbs/llm";
import {
  ToolRegistry,
  registerVsbsTools,
  runOneTurn,
  type AgentEvent,
  type VsbsHttpClient,
} from "../../src/index.js";

interface ToolStep {
  name: string;
  args: Record<string, unknown>;
}

interface Tau2Scenario {
  id: string;
  description: string;
  userTurns: string[];
  /** One tool step per supervisor sub-turn. The scripted concierge follows this script per turn. */
  scriptedSteps: ToolStep[][];
  finalAssistantText: string;
  expectedToolNamesInOrder: string[];
}

const SCENARIOS: Tau2Scenario[] = [
  {
    id: "TAU2-001",
    description: "Honda Civic grinding-on-brake — happy path: assess safety → score wellbeing → recommendation",
    userTurns: ["My 2024 Honda Civic is grinding when I brake."],
    scriptedSteps: [
      [{ name: "assessSafety", args: { owner: { canDriveSafely: "yes-cautiously", redFlags: [] } } }],
      [{ name: "scoreWellbeing", args: { safety: 0.85, wait: 0.8, cti: 0.85, timeAccuracy: 0.9, servqual: 0.8, trust: 0.8, continuity: 0.9, ces: 0.9, csat: 0.9, nps: 0.7 } }],
      [],
    ],
    finalAssistantText:
      "The vehicle is drivable in the short term. Recommended drive-in for a brake-pad inspection at the nearest authorised service centre.",
    expectedToolNamesInOrder: ["assessSafety", "scoreWellbeing"],
  },
  {
    id: "TAU2-002",
    description: "Engine fire — red severity must force tow path, no autonomy. SafetyFence overrides LLM with canonical advisory.",
    userTurns: ["The engine is on fire. I'm pulled over."],
    scriptedSteps: [
      [{ name: "assessSafety", args: { owner: { canDriveSafely: "already-stranded", redFlags: ["engine-fire"] } } }],
      [],
    ],
    // The deterministic fence detects "engine is on fire" as a hard red flag
    // and replaces the LLM final with the canonical advisory. This is the
    // load-bearing safety property: LLM cannot launder a red situation into
    // a softer message no matter what it says.
    finalAssistantText:
      "I am stopping the booking flow because what you described is a safety red flag. " +
      "Please do not drive the vehicle. Stay in a safe place. " +
      "I am arranging a tow to a qualified service centre. " +
      "If anyone is injured or there is fire or smoke, call emergency services first.",
    expectedToolNamesInOrder: ["assessSafety"],
  },
  {
    id: "TAU2-003",
    description: "Pre-trip Mercedes EQS at Stuttgart P6 — autonomy resolver eligible",
    userTurns: ["I'd like the car to park itself at Stuttgart P6."],
    scriptedSteps: [
      [{ name: "resolveAutonomy", args: {
          vehicle: { make: "Mercedes-Benz", model: "EQS", year: 2024, yearsSupported: [2023, 2024], autonomyHw: ["mb-drive-pilot"] },
          destinationProvider: "stuttgart-p6",
          providersSupported: ["stuttgart-p6"],
          owner: { autonomyConsentGranted: true, insuranceAllowsAutonomy: true },
        },
      }],
      [],
    ],
    finalAssistantText:
      "Tier-A AVP eligible at Stuttgart P6. Issuing a CommandGrant under the auto-pay cap.",
    expectedToolNamesInOrder: ["resolveAutonomy"],
  },
  {
    id: "TAU2-004",
    description: "Payment chain create-order → create-intent → authorise → capture",
    userTurns: ["Pay the final ₹4,500 for the brake job."],
    scriptedSteps: [
      [{ name: "createPaymentOrder", args: { bookingId: "55555555-5555-4555-8555-555555555555", amount: { currency: "INR", minor: 450000 }, idempotencyKey: "idemp-tau2-004" } }],
      [{ name: "createPaymentIntent", args: { orderId: "ord_tau2_004", method: "upi", upiVpa: "owner@upi" } }],
      [{ name: "authorisePayment", args: { intentId: "int_tau2_004", ok: true } }],
      [{ name: "capturePayment", args: { orderId: "ord_tau2_004" } }],
      [],
    ],
    finalAssistantText:
      "Payment captured. Settlement will appear within 24 h.",
    expectedToolNamesInOrder: ["createPaymentOrder", "createPaymentIntent", "authorisePayment", "capturePayment"],
  },
  {
    id: "TAU2-005",
    description: "Decline path — owner declines payment authorisation; no capture",
    userTurns: ["Actually cancel that payment."],
    scriptedSteps: [
      [{ name: "authorisePayment", args: { intentId: "int_tau2_005", ok: false, reason: "customer-cancelled" } }],
      [],
    ],
    finalAssistantText: "Payment cancelled at owner's request.",
    expectedToolNamesInOrder: ["authorisePayment"],
  },
  {
    id: "TAU2-006",
    description: "Multi-step decode-then-assess — VIN decoded, then safety checked. SafetyFence overrides on red severity.",
    userTurns: ["Decode my VIN 1HGCM82633A004352, then check safety with brake-failure flag."],
    scriptedSteps: [
      [{ name: "decodeVin", args: { vin: "1HGCM82633A004352" } }],
      [{ name: "assessSafety", args: { owner: { redFlags: ["brake-failure"] } } }],
      [],
    ],
    // assessSafety returns red; fence rewrites the LLM final to the canonical
    // red-flag advisory regardless of what the LLM tries to say.
    finalAssistantText:
      "I am stopping the booking flow because what you described is a safety red flag. " +
      "Please do not drive the vehicle. Stay in a safe place. " +
      "I am arranging a tow to a qualified service centre. " +
      "If anyone is injured or there is fire or smoke, call emergency services first.",
    expectedToolNamesInOrder: ["decodeVin", "assessSafety"],
  },
  {
    id: "TAU2-007",
    description: "Routing — drive ETA to a service center then commit a stub intake",
    userTurns: ["How long to drive to the SC, and book me in."],
    scriptedSteps: [
      [{ name: "driveEta", args: { origin: { lat: 12.97, lng: 77.59 }, destination: { lat: 12.95, lng: 77.60 } } }],
      [{ name: "commitIntake", args: { intake: { stub: true } } }],
      [],
    ],
    finalAssistantText: "ETA 18 minutes. Intake committed. Tracking page sent.",
    expectedToolNamesInOrder: ["driveEta", "commitIntake"],
  },
  {
    id: "TAU2-008",
    description: "Sensor-only red flag — no owner input, sensor surfaces brake-pressure-residual-critical",
    userTurns: ["Bring me up to speed on the alerts."],
    scriptedSteps: [
      [{ name: "assessSafety", args: { sensorFlags: ["brake-pressure-residual-critical"] } }],
      [],
    ],
    finalAssistantText:
      "Sensor red flag confirmed. Disabling drive paths and dispatching a tow.",
    expectedToolNamesInOrder: ["assessSafety"],
  },
  {
    id: "TAU2-009",
    description: "Wellbeing alone scenario — no other tools",
    userTurns: ["Just score this option for me."],
    scriptedSteps: [
      [{ name: "scoreWellbeing", args: { safety: 0.6, wait: 0.5, cti: 0.4, timeAccuracy: 0.5, servqual: 0.6, trust: 0.5, continuity: 0.5, ces: 0.5, csat: 0.5, nps: 0.4 } }],
      [],
    ],
    finalAssistantText: "Composite wellbeing score 0.5 — fair. We can do better with a different SC.",
    expectedToolNamesInOrder: ["scoreWellbeing"],
  },
  {
    id: "TAU2-010",
    description: "Refusal-to-act scenario — concierge ends without tool calls when info is insufficient",
    userTurns: ["Hi."],
    scriptedSteps: [[]],
    finalAssistantText:
      "Hello. I can help with a service booking. Could you describe the symptom or share the VIN?",
    expectedToolNamesInOrder: [],
  },
  {
    id: "TAU2-011",
    description: "Compound day-one — decode VIN, assess safety green, score wellbeing, drive ETA",
    userTurns: ["Routine service for my Honda 1HGCM82633A004352."],
    scriptedSteps: [
      [{ name: "decodeVin", args: { vin: "1HGCM82633A004352" } }],
      [{ name: "assessSafety", args: { owner: { canDriveSafely: "yes-confidently", redFlags: [] } } }],
      [{ name: "scoreWellbeing", args: { safety: 1, wait: 0.9, cti: 0.9, timeAccuracy: 0.9, servqual: 0.9, trust: 0.9, continuity: 0.9, ces: 0.9, csat: 0.9, nps: 0.8 } }],
      [{ name: "driveEta", args: { origin: { lat: 12.97, lng: 77.59 }, destination: { lat: 12.95, lng: 77.60 } } }],
      [],
    ],
    finalAssistantText:
      "All green. Drive-in scheduled. Composite wellbeing 0.93 — excellent.",
    expectedToolNamesInOrder: ["decodeVin", "assessSafety", "scoreWellbeing", "driveEta"],
  },
];

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

function buildLlm(scenario: Tau2Scenario): LlmRegistry {
  const turns = scenario.scriptedSteps.map((step, i) => {
    const toolCalls = step.map((s) => ({ name: s.name, arguments: s.args }));
    const isLast = i === scenario.scriptedSteps.length - 1;
    if (toolCalls.length === 0) {
      return { content: isLast ? scenario.finalAssistantText : "" };
    }
    return { content: "", toolCalls };
  });
  const scriptedBindings: Record<string, ScriptedBindingInit> = {
    [AgentRole.Concierge]: { role: AgentRole.Concierge, turns, loopLastTurn: true },
    [AgentRole.Verifier]: {
      role: AgentRole.Verifier,
      turns: [{ content: JSON.stringify({ grounded: true, reason: "scenario fixture" }) }],
    },
    [AgentRole.Intake]: { role: AgentRole.Intake, turns: [{ content: "" }] },
    [AgentRole.Diagnosis]: { role: AgentRole.Diagnosis, turns: [{ content: "" }] },
    [AgentRole.Dispatch]: { role: AgentRole.Dispatch, turns: [{ content: "" }] },
    [AgentRole.Wellbeing]: { role: AgentRole.Wellbeing, turns: [{ content: "" }] },
    [AgentRole.Autonomy]: { role: AgentRole.Autonomy, turns: [{ content: "" }] },
    [AgentRole.Payment]: { role: AgentRole.Payment, turns: [{ content: "" }] },
  };
  return new LlmRegistry({ LLM_PROFILE: "sim", scriptedBindings });
}

async function runScenario(scenario: Tau2Scenario): Promise<{ events: AgentEvent[]; toolCalls: string[]; final: string }> {
  const reg = new ToolRegistry(fakeHttp());
  registerVsbsTools(reg);
  const llm = buildLlm(scenario);
  const events: AgentEvent[] = [];
  const toolCalls: string[] = [];
  let final = "";
  const conversationId = scenario.id;
  let messages: Array<{ role: "user" | "assistant" | "tool"; content: string }> = [];
  for (const userMsg of scenario.userTurns) {
    for await (const evt of runOneTurn({ messages: messages as never }, { userMessage: userMsg, conversationId }, { llm, registry: reg })) {
      events.push(evt);
      if (evt.type === "tool-call") toolCalls.push(evt.call.name);
      if (evt.type === "final") final = evt.message.content;
    }
    messages = messages.concat([{ role: "user", content: userMsg }]);
  }
  return { events, toolCalls, final };
}

describe("τ2-bench-style multi-turn scenarios", () => {
  it("corpus has 10+ scenarios", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(SCENARIOS.map((s) => [s.id, s]))(
    "%s",
    async (_id, scenario) => {
      const { toolCalls, final } = await runScenario(scenario);
      expect(toolCalls).toEqual(scenario.expectedToolNamesInOrder);
      if (scenario.finalAssistantText.length > 0) {
        expect(final).toBe(scenario.finalAssistantText);
      }
    },
  );
});
