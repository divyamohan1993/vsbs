// =============================================================================
// SafetyFence — non-overridable boundary between the LLM final output and the
// user. Tool results pass through the LLM unchanged so the supervisor can
// reason. The *final* user-facing emission is post-checked by re-running the
// deterministic safety assessor on:
//   (a) red-flag keywords extracted directly from the original user message
//       (NOT from anything the LLM produced — the LLM cannot launder unsafe
//       signals away);
//   (b) any sensor flags surfaced by tool results during the turn (PHM
//       readings flagged tier-1 sensor failure or unsafe state, fusion
//       results carrying a red sensor flag, or assessSafety tool responses
//       that returned red).
//
// If the deterministic verdict is red and the LLM final says anything other
// than the canonical red-flag advisory, the fence REPLACES the LLM output
// with the canonical advisory. Same fence for autonomy: if any tier-1
// sensor failure or PhmState ∈ {"critical","unsafe"} was raised during the
// turn, the LLM cannot output any text that suggests the user drive
// (manually or autonomously); fence rewrites to the canonical "do not
// drive; tow recommended" advisory.
//
// Fail-closed: the fence emits the safe advisory when its own checks throw
// or when the deterministic assessor cannot run. Raw LLM output is never
// surfaced unchecked.
//
// The LLM is a UX layer, NEVER a safety arbiter. Hard-coded red flags are
// the source of truth (packages/shared/src/safety.ts SAFETY_RED_FLAGS).
// =============================================================================

import {
  SAFETY_RED_FLAGS,
  assessSafety,
  type PhmReading,
  type SafetyAssessment,
} from "@vsbs/shared";
import type { LlmMessage } from "@vsbs/llm";

import { unwrapForLegacyCallers } from "./confidence.js";
import type { ToolResult } from "./types.js";

// -----------------------------------------------------------------------------
// Canonical advisories — non-overridable text the fence emits when it fires.
// Plain English, accessible, no em-dashes, no jargon. Friendly recovery only.
// -----------------------------------------------------------------------------

export const CANONICAL_RED_FLAG_ADVISORY =
  "I am stopping the booking flow because what you described is a safety red flag. " +
  "Please do not drive the vehicle. Stay in a safe place. " +
  "I am arranging a tow to a qualified service centre. " +
  "If anyone is injured or there is fire or smoke, call emergency services first.";

export const CANONICAL_DO_NOT_DRIVE_ADVISORY =
  "I cannot recommend driving this vehicle right now, manually or autonomously. " +
  "A safety-critical sensor or component is reporting a fault that I cannot work around. " +
  "I am arranging a tow to a qualified service centre. Please stay with the vehicle in a safe location.";

// -----------------------------------------------------------------------------
// Red-flag keyword extraction from natural-language user messages. These
// patterns are intentionally generous; the fence is a defence-in-depth layer
// behind the schema-validated assessSafety tool, so false positives are
// preferable to false negatives. Patterns map to the canonical SAFETY_RED_FLAGS
// names.
// -----------------------------------------------------------------------------

interface RedFlagPattern {
  flag: string;
  patterns: RegExp[];
}

const RED_FLAG_PATTERNS: RedFlagPattern[] = [
  {
    flag: "brake-failure",
    patterns: [
      /\bbrake(s)?\b[^.]*\b(fail|failed|failing|gone|not (work|working)|won['’]?t (stop|engage)|no response|dead|sinking|to the floor)\b/i,
      /\bbrake pedal\b[^.]*\b(soft|spongy|sinking|on the floor)\b/i,
      /\b(can'?t|cannot|unable to)\b[^.]*\bstop\b/i,
    ],
  },
  {
    flag: "steering-failure",
    patterns: [
      /\bsteering\b[^.]*\b(fail|failed|failing|locked|gone|stiff|dead|won['’]?t turn|stuck)\b/i,
      /\b(can'?t|cannot|unable to)\b[^.]*\bsteer\b/i,
      /\bwheel\b[^.]*\b(locked|stuck|won['’]?t turn|frozen)\b/i,
    ],
  },
  {
    flag: "engine-fire",
    patterns: [
      /\bengine\b[^.]*\b(fire|on fire|burning|flames?)\b/i,
      /\b(fire|flames?)\b[^.]*\b(engine|under the hood|bonnet)\b/i,
      /\b(under the hood|bonnet)\b[^.]*\b(fire|flames?|burning)\b/i,
    ],
  },
  {
    flag: "visible-smoke-from-hood",
    patterns: [
      /\bsmoke\b[^.]*\b(hood|bonnet|engine|under)\b/i,
      /\b(hood|bonnet)\b[^.]*\bsmoke\b/i,
      /\bsmoking\b[^.]*\b(engine|hood|bonnet)\b/i,
    ],
  },
  {
    flag: "fluid-puddle-large",
    patterns: [
      /\b(big|large|huge|massive|growing|pool of)\b[^.]*\b(puddle|pool|leak)\b/i,
      /\b(puddle|pool)\b[^.]*\b(under|beneath)\b[^.]*\b(car|vehicle)\b/i,
      /\bleaking\b[^.]*\b(everywhere|a lot|heavily|all over)\b/i,
    ],
  },
  {
    flag: "coolant-boiling",
    patterns: [
      /\bcoolant\b[^.]*\b(boil|boiling|overflow|spraying|spewing)\b/i,
      /\b(radiator|coolant)\b[^.]*\b(steam|steaming|boiling over)\b/i,
      /\boverheat(ed|ing)?\b[^.]*\b(steam|boiling|coolant)\b/i,
    ],
  },
  {
    flag: "oil-pressure-red-light",
    patterns: [
      /\boil pressure\b[^.]*\b(red|warning|light|low|critical)\b/i,
      /\b(red|warning)\b[^.]*\boil (pressure|light|can)\b/i,
      /\boil light\b[^.]*\b(red|on|flashing|blinking)\b/i,
    ],
  },
  {
    flag: "airbag-deployed-recent",
    patterns: [
      /\bairbag(s)?\b[^.]*\b(deploy(ed)?|went off|popped|opened)\b/i,
      /\b(just|recently|after|after the|after a)\b[^.]*\b(crash|accident|collision|impact)\b/i,
      /\b(crash|accident|collision)\b[^.]*\b(just (now|happened)|moments? ago|minutes? ago)\b/i,
    ],
  },
  {
    flag: "ev-battery-thermal-warning",
    patterns: [
      /\b(ev|electric|hv|high.?voltage)\b[^.]*\bbattery\b[^.]*\b(hot|thermal|warning|fire|smoking|swollen)\b/i,
      /\bbattery\b[^.]*\b(thermal runaway|on fire|smoking|swelling|swollen|venting)\b/i,
    ],
  },
  {
    flag: "driver-reports-unsafe",
    patterns: [
      /\b(unsafe|not safe|dangerous|too dangerous)\b[^.]*\b(to drive|to move|right now)\b/i,
      /\bI (do not|don'?t|cannot|can'?t) feel safe\b/i,
      /\b(scared|terrified)\b[^.]*\b(to drive|of driving)\b/i,
    ],
  },
];

/**
 * Extract canonical red-flag tokens directly from a free-text user message.
 * O(k * n) where k = number of patterns; k is small and bounded.
 * Returns a deduplicated array of flag names (subset of SAFETY_RED_FLAGS).
 */
export function extractRedFlagsFromUserMessage(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const out = new Set<string>();
  for (const { flag, patterns } of RED_FLAG_PATTERNS) {
    if (!SAFETY_RED_FLAGS.has(flag)) continue;
    for (const rx of patterns) {
      if (rx.test(text)) {
        out.add(flag);
        break;
      }
    }
  }
  // Owner-says-stranded keyword — the safety assessor treats this as red
  // independently of the SAFETY_RED_FLAGS set (special-cased upstream).
  if (/\b(stranded|stuck on the (side of the )?road|won['’]?t (move|start|run))\b/i.test(text)) {
    out.add("driver-reports-unsafe");
  }
  return Array.from(out);
}

// -----------------------------------------------------------------------------
// Sensor flag extraction from tool results observed during the turn.
// -----------------------------------------------------------------------------

const TIER_ONE_SENSOR_DEAD = "tier-1-sensor-failure";
const PHM_UNSAFE = "phm-state-unsafe";
const PHM_CRITICAL = "phm-state-critical";

/**
 * Inspect every tool result emitted during a turn and surface any sensor
 * signals that should drive the deterministic safety verdict. We trust the
 * server-returned shapes by checking shape conservatively.
 */
export function extractSensorFlagsFromToolResults(results: ToolResult[]): {
  redFlags: string[];
  amberFlags: string[];
  phmRaisedUnsafeOrCritical: boolean;
  tierOneSensorFailure: boolean;
} {
  const redFlags: string[] = [];
  const amberFlags: string[] = [];
  let phmRaisedUnsafeOrCritical = false;
  let tierOneSensorFailure = false;

  for (const r of results) {
    if (!r.ok || r.data === undefined || r.data === null) continue;
    const unwrapped = unwrapForLegacyCallers(r.data);
    if (unwrapped === undefined || unwrapped === null || typeof unwrapped !== "object") continue;
    const data = unwrapped as Record<string, unknown>;

    // assessSafety tool: server returns the SafetyAssessment shape.
    if (r.toolName === "assessSafety") {
      const sev = (data["severity"] as unknown) ?? "";
      const triggered = Array.isArray(data["triggered"]) ? (data["triggered"] as unknown[]) : [];
      if (sev === "red") {
        for (const t of triggered) {
          if (typeof t === "string" && SAFETY_RED_FLAGS.has(t)) redFlags.push(t);
        }
        if (triggered.length === 0) redFlags.push("driver-reports-unsafe");
      } else if (sev === "amber") {
        for (const t of triggered) if (typeof t === "string") amberFlags.push(t);
      }
    }

    // PHM endpoints can return readings or summaries. Scan defensively.
    if (r.toolName === "phmStatus" || r.toolName === "phmSummary" || r.toolName === "phm") {
      const readings = Array.isArray(data["readings"]) ? (data["readings"] as PhmReading[]) : [];
      for (const reading of readings) {
        if (reading?.state === "unsafe" || reading?.state === "critical") {
          phmRaisedUnsafeOrCritical = true;
        }
        if (reading?.tier === 1 && reading?.suspectedSensorFailure === true) {
          tierOneSensorFailure = true;
        }
      }
      if (data["tierOneSensorDead"] === true) tierOneSensorFailure = true;
    }

    // Sensor fusion: any sample tagged `red` → red flag.
    if (r.toolName === "fusion" || r.toolName === "sensorFusion" || r.toolName === "sensors.fuse") {
      const flags = Array.isArray(data["redFlags"]) ? (data["redFlags"] as unknown[]) : [];
      for (const f of flags) {
        if (typeof f === "string" && SAFETY_RED_FLAGS.has(f)) redFlags.push(f);
      }
    }
  }

  return { redFlags, amberFlags, phmRaisedUnsafeOrCritical, tierOneSensorFailure };
}

// -----------------------------------------------------------------------------
// Drive-suggestion heuristic — detects unsafe LLM output that tells the user
// they may continue driving manually or hand off autonomously.
// -----------------------------------------------------------------------------

const DRIVE_SUGGESTION_PATTERNS: RegExp[] = [
  /\b(safe|ok|okay|fine|good)\b[^.]*\bto drive\b/i,
  /\byou (can|may|should|could)\b[^.]*\b(drive|continue driving|keep driving|carry on)\b/i,
  /\b(go ahead and|please|feel free to)\b[^.]*\bdrive\b/i,
  /\b(autonomous(ly)?|self.?drive|self.?driving|valet|avp)\b[^.]*\b(hand[- ]?off|hand off|hand it off|engage|engaged|take|proceed|continue|park|drive)\b/i,
  /\b(hand[- ]?off|hand off)\b[^.]*\b(autonomous(ly)?|self.?drive|self.?driving|valet|avp|the (car|vehicle))\b/i,
  /\bthe (vehicle|car) is (safe|ok|okay|fine|drivable)\b/i,
  /\bdrive[- ]in\b/i,
  /\bhand (it|the (car|vehicle)) over\b[^.]*\bautonomous/i,
  /\bautonomous(ly)?\b[^.]*\b(hand off|hand the (car|vehicle)|park|engage)/i,
];

export function looksLikeDriveSuggestion(text: string): boolean {
  if (!text) return false;
  for (const rx of DRIVE_SUGGESTION_PATTERNS) {
    if (rx.test(text)) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// SafetyFence — the public boundary.
// -----------------------------------------------------------------------------

export interface SafetyFenceContext {
  /** The original user message the supervisor was asked to handle. Required. */
  userMessage: string;
  /** Every tool result observed during the turn. Required. */
  toolResults: ToolResult[];
  /** Optional structured signals already known to the caller (e.g. preset owner.redFlags). */
  ownerSignals?:
    | {
        canDriveSafely?:
          | "yes-confidently"
          | "yes-cautiously"
          | "unsure"
          | "no"
          | "already-stranded"
          | undefined;
        redFlags?: string[] | undefined;
      }
    | undefined;
}

export interface SafetyFenceVerdict {
  /** Whether the fence rewrote the LLM output. */
  overridden: boolean;
  /** Reason classes that fired, for observability. */
  reasons: Array<
    | "deterministic-red-flag"
    | "phm-unsafe"
    | "tier-1-sensor-failure"
    | "internal-error"
  >;
  /** The canonical advisory the fence emitted, or undefined if not overridden. */
  text?: string | undefined;
  /** Triggered red-flags surfaced by the fence (subset of SAFETY_RED_FLAGS). */
  triggered: string[];
  /** The deterministic assessment the fence computed (always present unless internal error). */
  assessment?: SafetyAssessment | undefined;
}

/**
 * Apply the safety fence to a candidate LLM final message. Returns either the
 * unchanged message (when the deterministic verdict allows it) or the
 * canonical advisory wrapped in an assistant message. Fail-closed on any
 * internal error — never surface raw LLM output unchecked.
 */
export class SafetyFence {
  /**
   * Run the fence. `candidate` is the LLM's proposed final assistant message.
   */
  apply(candidate: LlmMessage, ctx: SafetyFenceContext): {
    message: LlmMessage;
    verdict: SafetyFenceVerdict;
  } {
    const reasons: SafetyFenceVerdict["reasons"] = [];
    const triggered = new Set<string>();
    let assessment: SafetyAssessment | undefined;

    try {
      const userFlags = extractRedFlagsFromUserMessage(ctx.userMessage);
      for (const f of userFlags) triggered.add(f);

      const sensorSignals = extractSensorFlagsFromToolResults(ctx.toolResults);
      for (const f of sensorSignals.redFlags) triggered.add(f);

      const ownerProvided = ctx.ownerSignals?.redFlags ?? [];
      for (const f of ownerProvided) {
        if (typeof f === "string" && SAFETY_RED_FLAGS.has(f)) triggered.add(f);
      }

      const ownerCanDrive = ctx.ownerSignals?.canDriveSafely;
      assessment = assessSafety({
        owner: {
          ...(ownerCanDrive !== undefined ? { canDriveSafely: ownerCanDrive } : {}),
          redFlags: Array.from(triggered),
        },
        sensorFlags: sensorSignals.amberFlags,
      });

      const isRed = assessment.severity === "red";
      const phmBlocked = sensorSignals.phmRaisedUnsafeOrCritical;
      const tierOneDead = sensorSignals.tierOneSensorFailure;

      if (phmBlocked) reasons.push("phm-unsafe");
      if (tierOneDead) reasons.push("tier-1-sensor-failure");
      if (isRed) reasons.push("deterministic-red-flag");

      // Case 1: deterministic red. The LLM final must be the canonical advisory
      // (a strict equality check is too brittle — we accept the LLM output if
      // it CONTAINS the advisory verbatim, otherwise we replace it).
      if (isRed) {
        if (candidate.content.includes(CANONICAL_RED_FLAG_ADVISORY)) {
          return {
            message: candidate,
            verdict: {
              overridden: false,
              reasons,
              triggered: Array.from(triggered),
              ...(assessment !== undefined ? { assessment } : {}),
            },
          };
        }
        return {
          message: { role: "assistant", content: CANONICAL_RED_FLAG_ADVISORY },
          verdict: {
            overridden: true,
            reasons,
            text: CANONICAL_RED_FLAG_ADVISORY,
            triggered: Array.from(triggered),
            ...(assessment !== undefined ? { assessment } : {}),
          },
        };
      }

      // Case 2: PHM unsafe / tier-1 sensor dead. The LLM cannot suggest the
      // user drive (manually or autonomously).
      if ((phmBlocked || tierOneDead) && looksLikeDriveSuggestion(candidate.content)) {
        return {
          message: { role: "assistant", content: CANONICAL_DO_NOT_DRIVE_ADVISORY },
          verdict: {
            overridden: true,
            reasons,
            text: CANONICAL_DO_NOT_DRIVE_ADVISORY,
            triggered: Array.from(triggered),
            ...(assessment !== undefined ? { assessment } : {}),
          },
        };
      }

      // Case 3: otherwise pass-through.
      return {
        message: candidate,
        verdict: {
          overridden: false,
          reasons,
          triggered: Array.from(triggered),
          ...(assessment !== undefined ? { assessment } : {}),
        },
      };
    } catch {
      // Fail-closed: emit the safe advisory if the fence itself errors. Raw
      // LLM output is never surfaced when our checks cannot complete.
      reasons.push("internal-error");
      return {
        message: { role: "assistant", content: CANONICAL_RED_FLAG_ADVISORY },
        verdict: {
          overridden: true,
          reasons,
          text: CANONICAL_RED_FLAG_ADVISORY,
          triggered: Array.from(triggered),
          ...(assessment !== undefined ? { assessment } : {}),
        },
      };
    }
  }
}

/** Convenience: a singleton fence (stateless; safe to share). */
export const safetyFence = new SafetyFence();
