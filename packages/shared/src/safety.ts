// =============================================================================
// Safety — red-flag overrides and severity assignment.
// Hardcoded, deterministic, cross-checked twice. Reference:
//   docs/research/wellbeing.md §4
//   docs/research/dispatch.md §4
// =============================================================================

import type { SelfSafety } from "./schema/intake.js";

export type Severity = "red" | "amber" | "green";

/**
 * The union of red-flags comes from the SelfSafety schema and a small
 * set of sensor-derived flags. Any member present at assessment time
 * forces severity = red and mandates a tow.
 */
export const SAFETY_RED_FLAGS = new Set<string>([
  // owner-reported
  "brake-failure",
  "steering-failure",
  "engine-fire",
  "visible-smoke-from-hood",
  "fluid-puddle-large",
  "coolant-boiling",
  "oil-pressure-red-light",
  "airbag-deployed-recent",
  "ev-battery-thermal-warning",
  "driver-reports-unsafe",

  // sensor-derived (set elsewhere after fusion cross-validation)
  "brake-pressure-residual-critical",
  "steering-assist-lost",
  "hv-battery-dT-runaway",
  "oil-pressure-sensor-below-threshold-confirmed",
] as const);

export type RedFlag = typeof SAFETY_RED_FLAGS extends Set<infer T> ? T : never;

export interface SafetyAssessment {
  severity: Severity;
  triggered: string[];
  source: "owner" | "sensor" | "both";
  rationale: string;
}

export interface SafetyAssessmentInput {
  owner?: {
    canDriveSafely?: SelfSafety["canDriveSafely"] | undefined;
    redFlags?: string[] | undefined;
  } | undefined;
  sensorFlags?: string[] | undefined;
}

export function assessSafety(input: SafetyAssessmentInput): SafetyAssessment {
  const ownerFlags = input.owner?.redFlags ?? [];
  const sensorFlags = input.sensorFlags ?? [];

  const triggered: string[] = [];
  for (const f of ownerFlags) if (SAFETY_RED_FLAGS.has(f)) triggered.push(f);
  for (const f of sensorFlags) if (SAFETY_RED_FLAGS.has(f)) triggered.push(f);

  if (triggered.length > 0) {
    return {
      severity: "red",
      triggered,
      source:
        ownerFlags.length > 0 && sensorFlags.length > 0
          ? "both"
          : ownerFlags.length > 0
            ? "owner"
            : "sensor",
      rationale:
        "Hard-coded safety red-flag triggered; autonomous and drive-in paths are disabled. Tow dispatched.",
    };
  }

  // Amber conditions — drive allowed but we prefer mobile/tow beyond a distance.
  const amberSignals: string[] = [];
  if (input.owner?.canDriveSafely === "unsure") amberSignals.push("owner-unsure");
  if (input.owner?.canDriveSafely === "no") amberSignals.push("owner-no");
  if (input.owner?.canDriveSafely === "already-stranded") {
    return {
      severity: "red",
      triggered: ["already-stranded"],
      source: "owner",
      rationale: "Owner reports the vehicle is already stranded. Tow required.",
    };
  }
  for (const f of sensorFlags) if (!SAFETY_RED_FLAGS.has(f)) amberSignals.push(f);

  if (amberSignals.length > 0) {
    return {
      severity: "amber",
      triggered: amberSignals,
      source: sensorFlags.length > 0 ? "sensor" : "owner",
      rationale:
        "Non-critical cautionary signals present. Drive-in allowed within distance limit; mobile mechanic preferred otherwise.",
    };
  }

  return {
    severity: "green",
    triggered: [],
    source: "owner",
    rationale: "No safety signals reported or detected.",
  };
}

/**
 * A belt-and-braces second check. Called immediately before commit on any
 * path that would let the customer drive. If this ever disagrees with the
 * primary assessment we fail closed — the commit is aborted and the
 * supervisor must redo the assessment. See architecture §Safety invariants.
 */
export function postCheckSafetyAgrees(
  primary: SafetyAssessment,
  raw: SafetyAssessmentInput,
): boolean {
  const secondary = assessSafety(raw);
  if (secondary.severity !== primary.severity) return false;
  if (secondary.triggered.length !== primary.triggered.length) return false;
  const aSorted = [...primary.triggered].sort();
  const bSorted = [...secondary.triggered].sort();
  return aSorted.every((v, i) => v === bSorted[i]);
}
