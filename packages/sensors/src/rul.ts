// =============================================================================
// Remaining Useful Life estimators — production v1 ships physics-of-failure
// and empirical rules for components that have them. Data-driven ensembles
// (C-MAPSS-trained transformer for complex components) plug in via the
// `RulModel` interface when the training pipeline is productionised.
//
// References in docs/research/prognostics.md §3.
// =============================================================================

import type { ComponentId, PhmReading } from "@vsbs/shared";

export interface RulModel {
  readonly id: string;
  readonly source: PhmReading["modelSource"];
  /** Returns `(pFail1000km, lower, upper, rulKmMean?, rulKmLower?)`. */
  predict(input: unknown): {
    pFail1000km: number;
    pFailLower: number;
    pFailUpper: number;
    rulKmMean?: number;
    rulKmLower?: number;
  };
}

/**
 * Brake pad physics-of-failure. Linear wear rate re-calibrated on every
 * inspection. Inputs in mm.
 */
export const BrakePadRul: RulModel = {
  id: "brake-pad-v1",
  source: "physics-of-failure",
  predict(input: unknown) {
    const i = input as {
      currentMm: number;
      wearRateMmPerKm: number; // e.g. 5e-5 for typical pads
      wearRateSigma: number;
      minSafeMm: number; // e.g. 3
    };
    const usableMm = Math.max(0, i.currentMm - i.minSafeMm);
    const rulKmMean = usableMm / Math.max(1e-9, i.wearRateMmPerKm);
    const rulKmLower = usableMm / Math.max(1e-9, i.wearRateMmPerKm + 2 * i.wearRateSigma);
    // Probability of failure within 1000 km ≈ 1 − Φ((rul − 1000)/(rul*σratio))
    // Simplified: use a triangular proxy.
    const pFail1000km = rulKmMean <= 1000 ? 1 : Math.max(0, 1 - (rulKmMean - 1000) / rulKmMean);
    const pFailLower = rulKmLower <= 1000 ? 1 : Math.max(0, 1 - (rulKmLower - 1000) / rulKmLower);
    const pFailUpper = Math.min(1, pFail1000km + 0.1);
    return { pFail1000km, pFailLower, pFailUpper, rulKmMean, rulKmLower };
  },
};

/**
 * 12 V battery RUL — heuristic on resting voltage + cranking voltage + age.
 * Grounded in standard SAE J537 guidance. We treat ≤ 11.9 V resting as
 * critical and ≥ 12.5 V as healthy.
 */
export const Battery12vRul: RulModel = {
  id: "battery-12v-v1",
  source: "empirical-rule",
  predict(input: unknown) {
    const i = input as { restingV: number; ageMonths: number; crankingV: number };
    const base = Math.max(0, Math.min(1, (12.8 - i.restingV) / 0.9)); // 0 at 12.8+, 1 at 11.9-
    const ageFactor = Math.max(0, Math.min(1, (i.ageMonths - 36) / 24));
    const crankFactor = Math.max(0, Math.min(1, (10.5 - i.crankingV) / 1.0));
    const pFail1000km = Math.max(base, 0.6 * ageFactor, 0.8 * crankFactor);
    return {
      pFail1000km,
      pFailLower: Math.max(0, pFail1000km - 0.1),
      pFailUpper: Math.min(1, pFail1000km + 0.15),
    };
  },
};

export const RUL_MODELS: Partial<Record<ComponentId, RulModel>> = {
  "brakes-pads-front": BrakePadRul,
  "brakes-pads-rear": BrakePadRul,
  "battery-12v": Battery12vRul,
};
