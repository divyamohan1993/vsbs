// =============================================================================
// Customer Wellbeing Composite Score.
// Reference: docs/research/wellbeing.md  — weights, parameters, and citations
// are documented there; this module just computes the formula.
// =============================================================================

import { WELLBEING_WEIGHTS } from "./constants.js";

export interface WellbeingInputs {
  /** 0–1. 1 = completely safe (short distance, green severity); 0 = driving on a red-flag vehicle. */
  safety: number;
  /** 0–1 per Maister (explained ∧ occupied ∧ in-process ∧ solo-remedied ∧ fair ∧ certain) + accuracy term. */
  wait: number;
  /** 0–1, Cost Transparency Index (itemised, parts/labour split, OEM/aftermarket disclosed, warranty shown, tax shown, final-bill match). */
  cti: number;
  /** 0–1, `max(0, 1 − |actual − estimated|/estimated)`. */
  timeAccuracy: number;
  /** 0–1, SERVQUAL EMA for the target SC. */
  servqual: number;
  /** 0–1, trust in autonomous advisor (three-item scale mean, rescaled). */
  trust: number;
  /** 0–1, mobility continuity (loaner / mobile / same-day). */
  continuity: number;
  /** 0–1, customer effort score rescaled (7-point). */
  ces: number;
  /** 0–1, CSAT rescaled (5-point). */
  csat: number;
  /** 0–1, NPS rescaled (-100..100 → 0..1). */
  nps: number;
}

export interface WellbeingResult {
  score: number;
  contributions: Record<keyof WellbeingInputs, number>;
  band: "excellent" | "good" | "fair" | "poor";
}

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Compute the composite wellbeing score in O(1). Inputs must be
 * pre-normalised to [0,1]; this function never does I/O.
 */
export function wellbeingScore(raw: WellbeingInputs): WellbeingResult {
  const i: WellbeingInputs = {
    safety: clamp01(raw.safety),
    wait: clamp01(raw.wait),
    cti: clamp01(raw.cti),
    timeAccuracy: clamp01(raw.timeAccuracy),
    servqual: clamp01(raw.servqual),
    trust: clamp01(raw.trust),
    continuity: clamp01(raw.continuity),
    ces: clamp01(raw.ces),
    csat: clamp01(raw.csat),
    nps: clamp01(raw.nps),
  };

  const contributions: Record<keyof WellbeingInputs, number> = {
    safety: WELLBEING_WEIGHTS.safety * i.safety,
    wait: WELLBEING_WEIGHTS.wait * i.wait,
    cti: WELLBEING_WEIGHTS.cti * i.cti,
    timeAccuracy: WELLBEING_WEIGHTS.timeAccuracy * i.timeAccuracy,
    servqual: WELLBEING_WEIGHTS.servqual * i.servqual,
    trust: WELLBEING_WEIGHTS.trust * i.trust,
    continuity: WELLBEING_WEIGHTS.continuity * i.continuity,
    ces: WELLBEING_WEIGHTS.ces * i.ces,
    csat: WELLBEING_WEIGHTS.csat * i.csat,
    nps: WELLBEING_WEIGHTS.nps * i.nps,
  };

  const score =
    contributions.safety +
    contributions.wait +
    contributions.cti +
    contributions.timeAccuracy +
    contributions.servqual +
    contributions.trust +
    contributions.continuity +
    contributions.ces +
    contributions.csat +
    contributions.nps;

  const band: WellbeingResult["band"] =
    score >= 0.85 ? "excellent" : score >= 0.7 ? "good" : score >= 0.5 ? "fair" : "poor";

  return { score, contributions, band };
}

/**
 * Helper: Maister-style wait score from component booleans + accuracy term.
 */
export function maisterWaitScore(
  flags: {
    explained: boolean;
    occupied: boolean;
    inProcess: boolean;
    fair: boolean;
    certain: boolean;
    groupRemedied: boolean;
  },
  accuracy: { actualMinutes: number; promisedMinutes: number },
): number {
  const booleanPart =
    ([flags.explained, flags.occupied, flags.inProcess, flags.fair, flags.certain, flags.groupRemedied].filter(Boolean)
      .length) / 6;
  const accuracyPart =
    accuracy.promisedMinutes > 0
      ? Math.max(0, 1 - Math.abs(accuracy.actualMinutes - accuracy.promisedMinutes) / accuracy.promisedMinutes)
      : 1;
  // 70 % booleans, 30 % accuracy — numerical weighting justified by Buell & Norton 2011
  // which shows operational-transparency effects dominate pure accuracy.
  return 0.7 * booleanPart + 0.3 * accuracyPart;
}
