// =============================================================================
// Takeover ladder and Minimum Risk Maneuver (MRM).
//
// References:
//   UNECE Regulation No. 157 (ALKS) — Annex 4 §5.1 "Transition demand"
//     defines the tiered takeover request escalation and the MRM fallback
//     when the human driver fails to resume the dynamic driving task.
//   ECE R79 §5.1.6 — driver override requirements for steering support.
//   ISO 21448 (SOTIF) §7 — degraded operation design and fallback.
//   SAE J3016:2021 — ADS fallback performance definitions.
//
// Design rules followed here:
//   1. The ladder has exactly four rungs: informational, warning, urgent,
//      emergency-MRM. Every rung adds a modality and shortens the hold time.
//   2. Every rung publishes a deterministic modality set so downstream UI
//      clients, HMI clusters, and haptic belts can subscribe by bitmask.
//   3. The escalator is a pure function of (current rung, elapsed ms,
//      ack received). No wall clocks, no hidden state. Deterministic tests.
//   4. MRM is the terminal state. Once triggered it is not reversible by
//      elapsed time alone; a new grant cycle is required.
// =============================================================================

import { z } from "zod";
import { TAKEOVER_ESCALATION_SECONDS } from "./constants.js";

/** The four rungs of the UNECE R157 transition demand ladder. */
export const TakeoverRungSchema = z.enum([
  "informational",
  "warning",
  "urgent",
  "emergency-mrm",
]);
export type TakeoverRung = z.infer<typeof TakeoverRungSchema>;

/**
 * Output modalities carried on a takeover prompt. Every rung adds one.
 * Bit-addressable so an HMI cluster can subscribe without parsing strings.
 */
export const TakeoverModalitiesSchema = z.object({
  visual: z.boolean(),
  auditory: z.boolean(),
  tactile: z.boolean(),
  haptic: z.boolean(),
});
export type TakeoverModalities = z.infer<typeof TakeoverModalitiesSchema>;

export const TakeoverPromptSchema = z.object({
  rung: TakeoverRungSchema,
  modalities: TakeoverModalitiesSchema,
  message: z.string().min(1),
  /** Epoch ms when the current rung began. Required so the escalator can compute elapsed. */
  rungStartEpochMs: z.number().int().nonnegative(),
  /** Max time, in ms, the current rung may hold before escalation. */
  maxHoldMs: z.number().int().positive(),
});
export type TakeoverPrompt = z.infer<typeof TakeoverPromptSchema>;

/**
 * Rung profile table. Hold times anchor on TAKEOVER_ESCALATION_SECONDS
 * (docs/research/prognostics.md §4). Research shows a minimum 10 s window
 * between first warning and handover completion for a re-engaged driver.
 */
const RUNG_PROFILE: Readonly<
  Record<TakeoverRung, { modalities: TakeoverModalities; maxHoldMs: number; message: string }>
> = Object.freeze({
  informational: {
    modalities: { visual: true, auditory: false, tactile: false, haptic: false },
    maxHoldMs: TAKEOVER_ESCALATION_SECONDS * 1000,
    message: "Please prepare to take over driving.",
  },
  warning: {
    modalities: { visual: true, auditory: true, tactile: false, haptic: false },
    maxHoldMs: Math.round(TAKEOVER_ESCALATION_SECONDS * 1000 * 0.6),
    message: "Take over now. Keep your hands on the wheel.",
  },
  urgent: {
    modalities: { visual: true, auditory: true, tactile: true, haptic: true },
    maxHoldMs: Math.round(TAKEOVER_ESCALATION_SECONDS * 1000 * 0.3),
    message: "Take over immediately. The vehicle is about to stop.",
  },
  "emergency-mrm": {
    modalities: { visual: true, auditory: true, tactile: true, haptic: true },
    maxHoldMs: 1, // terminal; escalator never leaves this rung
    message: "Minimum risk maneuver engaged. The vehicle is stopping in lane.",
  },
});

/**
 * Build a fresh takeover prompt at the given rung. Deterministic given a clock.
 */
export function buildTakeoverPrompt(rung: TakeoverRung, nowEpochMs: number): TakeoverPrompt {
  const profile = RUNG_PROFILE[rung];
  return {
    rung,
    modalities: { ...profile.modalities },
    message: profile.message,
    rungStartEpochMs: nowEpochMs,
    maxHoldMs: profile.maxHoldMs,
  };
}

export type EscalateResult =
  | { kind: "hold"; rung: TakeoverRung }
  | { kind: "escalate"; rung: TakeoverRung }
  | { kind: "acknowledged"; rung: TakeoverRung }
  | { kind: "mrm-triggered" };

/**
 * Pure, O(1), deterministic escalator. Given the current rung, the time
 * elapsed in that rung, and whether the driver acknowledged, return what
 * happens next. The escalator never looks at a wall clock.
 *
 *   ack received          -> "acknowledged" (caller clears the ladder)
 *   elapsed < maxHold     -> "hold"
 *   elapsed >= maxHold    -> "escalate" to the next rung, or "mrm-triggered"
 *                            if we are already on the urgent rung.
 *   rung == emergency-mrm -> stays "mrm-triggered"
 */
export function escalateTakeover(
  currentRung: TakeoverRung,
  elapsedMs: number,
  ackReceived: boolean,
): EscalateResult {
  if (currentRung === "emergency-mrm") {
    return { kind: "mrm-triggered" };
  }
  if (ackReceived) {
    return { kind: "acknowledged", rung: currentRung };
  }
  const maxHold = RUNG_PROFILE[currentRung].maxHoldMs;
  if (elapsedMs < maxHold) {
    return { kind: "hold", rung: currentRung };
  }
  switch (currentRung) {
    case "informational":
      return { kind: "escalate", rung: "warning" };
    case "warning":
      return { kind: "escalate", rung: "urgent" };
    case "urgent":
      return { kind: "mrm-triggered" };
  }
}

// ---------- Minimum Risk Maneuver ----------

export const MrmContextSchema = z.object({
  /** Current longitudinal speed, m/s. */
  speedMps: z.number().nonnegative(),
  /** True if the vehicle is currently inside its defined operational design domain. */
  inOdd: z.boolean(),
  /** True if a hard-shoulder or refuge is reachable in the current stopping window. */
  hardShoulderReachable: z.boolean(),
  /** True if a human driver is present and not incapacitated. */
  driverPresent: z.boolean(),
});
export type MrmContext = z.infer<typeof MrmContextSchema>;

export const MrmPlanSchema = z.object({
  action: z.enum(["slow-to-stop-in-lane", "pull-to-hard-shoulder", "hand-to-driver"]),
  /** Target longitudinal deceleration, m/s^2. UNECE R157 caps MRM decel at 4 m/s^2. */
  decelMps2: z.number().positive().max(4),
  hazardsOn: z.boolean(),
  /** Unlock doors only after the vehicle has come to a full stop. */
  unlockDoorsAfterStop: z.boolean(),
  reason: z.string().min(1),
});
export type MrmPlan = z.infer<typeof MrmPlanSchema>;

/**
 * Build a Minimum Risk Maneuver plan. Pure, O(1). UNECE R157 Annex 4 §5.1.5
 * requires the MRM to bring the vehicle to a complete stop with hazards
 * active; an "in-lane" stop is the fallback when no refuge is reachable.
 */
export function minimumRiskManeuver(ctx: MrmContext): MrmPlan {
  if (ctx.driverPresent && ctx.inOdd) {
    return {
      action: "hand-to-driver",
      decelMps2: 1.5,
      hazardsOn: true,
      unlockDoorsAfterStop: false,
      reason: "Driver present and in ODD; preferred path is graceful handover.",
    };
  }
  if (ctx.hardShoulderReachable) {
    return {
      action: "pull-to-hard-shoulder",
      decelMps2: 2.5,
      hazardsOn: true,
      unlockDoorsAfterStop: true,
      reason: "Refuge reachable within stopping window; move out of live lane.",
    };
  }
  return {
    action: "slow-to-stop-in-lane",
    decelMps2: 3.0,
    hazardsOn: true,
    unlockDoorsAfterStop: true,
    reason: "No refuge reachable; stop in lane per UNECE R157 Annex 4.",
  };
}
