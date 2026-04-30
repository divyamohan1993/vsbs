// =============================================================================
// Calibration tables — per-OEM, per-region PHM and wear constants.
//
// PHM models in @vsbs/sensors and the recommendation logic in @vsbs/api both
// consume *constants* (wear rates, sigma, Arrhenius reference temperature,
// service intervals) that are NOT universal. India sees high heat and dust;
// EU sees mild conditions; an HCV in India wears tyres very differently from
// a passenger-light. Hard-coding a single global constant is a known source
// of misclassification — this module replaces that with a typed, regionally
// keyed registry.
//
// When a (oem, model, year, region) tuple has no exact entry the registry
// falls back to the seeded `default` and stamps `usedFallback: true` on the
// lookup so the caller can mark the resulting recommendation advisory-only.
//
// Standards / references:
//   docs/research/prognostics.md §3 (physics-of-failure constants).
//   Severson et al. 2019 (Nature Energy) — battery knee-point modelling.
//   ISO 13374 — condition-monitoring data flow.
//   API J300 — engine-oil viscosity grade vs service interval.
// =============================================================================

import { z } from "zod";
import { Iso3166Alpha2Schema } from "./odd.js";

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

/**
 * A calibration key identifies the (oem, model, year, region) tuple a
 * calibration entry applies to. `year === 0` is the sentinel meaning
 * "regional default — applies to any model year for this region".
 * Real model years are bounded to [1950, currentYear + 1] for sanity.
 */
export const CalibrationKeySchema = z
  .object({
    oem: z.string().min(1).max(80),
    model: z.string().min(1).max(80),
    year: z.number().int(),
    region: Iso3166Alpha2Schema,
  })
  .refine(
    (k) => k.year === 0 || (k.year >= 1950 && k.year <= new Date().getFullYear() + 1),
    {
      message: "year must be 0 (regional default) or in [1950, currentYear+1]",
      path: ["year"],
    },
  );
export type CalibrationKey = z.infer<typeof CalibrationKeySchema>;

export const CalibrationEntrySchema = z.object({
  key: CalibrationKeySchema,
  /** Brake-pad wear rate in mm of pad consumed per km of driving. */
  brakePadWearRateMmPerKm: z.number().positive(),
  /** Standard deviation of the brake-pad wear rate (same units). */
  brakePadWearRateSigma: z.number().nonnegative(),
  /** Tyre tread wear rate in mm per km. */
  tyreWearRateMmPerKm: z.number().positive(),
  tyreWearRateSigma: z.number().nonnegative(),
  /** HV battery Arrhenius reference temperature in degrees Celsius. */
  hvBatteryArrheniusReferenceC: z.number().min(-40).max(80),
  /** Manufacturer engine-oil change interval in km. */
  oilChangeIntervalKm: z.number().int().positive(),
  /** Drive-belt service-life in km. */
  beltLifeKm: z.number().int().positive(),
  /** Free-form region-specific notes for auditors / reviewers. */
  regionNotes: z.string().max(2_000).default(""),
});
export type CalibrationEntry = z.infer<typeof CalibrationEntrySchema>;

// -----------------------------------------------------------------------------
// Seeded entries
// -----------------------------------------------------------------------------

/**
 * Default fallback. Used when no exact (oem, model, year, region) entry
 * exists. Numbers are conservative averages; any decision based on a
 * fallback lookup MUST be flagged advisory-only by the caller.
 */
export const DEFAULT_CALIBRATION_ENTRY: CalibrationEntry = {
  key: { oem: "*", model: "*", year: 0, region: "ZZ" },
  brakePadWearRateMmPerKm: 0.00012,
  brakePadWearRateSigma: 0.00004,
  tyreWearRateMmPerKm: 0.00010,
  tyreWearRateSigma: 0.00003,
  hvBatteryArrheniusReferenceC: 25,
  oilChangeIntervalKm: 10_000,
  beltLifeKm: 100_000,
  regionNotes:
    "Generic global fallback. Caller must flag any recommendation built from this entry as advisory-only.",
};

const SEED_INDIA_PASSENGER_LIGHT: CalibrationEntry = {
  key: { oem: "*", model: "*", year: 0, region: "IN" },
  // Higher heat + dust load lifts pad and tyre wear; service intervals shorten.
  brakePadWearRateMmPerKm: 0.00018,
  brakePadWearRateSigma: 0.00006,
  tyreWearRateMmPerKm: 0.00016,
  tyreWearRateSigma: 0.00005,
  hvBatteryArrheniusReferenceC: 32,
  oilChangeIntervalKm: 7_500,
  beltLifeKm: 80_000,
  regionNotes:
    "India passenger-light: ambient mean ~32 C; dust ingress accelerates pad and belt wear. Source: docs/research/prognostics.md §3.2.",
};

const SEED_EU_PASSENGER_LIGHT: CalibrationEntry = {
  key: { oem: "*", model: "*", year: 0, region: "DE" },
  brakePadWearRateMmPerKm: 0.00010,
  brakePadWearRateSigma: 0.00003,
  tyreWearRateMmPerKm: 0.00009,
  tyreWearRateSigma: 0.00003,
  hvBatteryArrheniusReferenceC: 22,
  oilChangeIntervalKm: 15_000,
  beltLifeKm: 120_000,
  regionNotes:
    "EU passenger-light (DE proxy): mild ambient, paved roads, longer service intervals per OEM schedule.",
};

const SEED_US_PASSENGER_LIGHT: CalibrationEntry = {
  key: { oem: "*", model: "*", year: 0, region: "US" },
  brakePadWearRateMmPerKm: 0.00013,
  brakePadWearRateSigma: 0.00004,
  tyreWearRateMmPerKm: 0.00011,
  tyreWearRateSigma: 0.00004,
  hvBatteryArrheniusReferenceC: 25,
  oilChangeIntervalKm: 12_000,
  beltLifeKm: 100_000,
  regionNotes:
    "US passenger-light: mixed climate average; OEM schedules of 10–15k km between oil changes.",
};

const SEED_INDIA_HCV: CalibrationEntry = {
  key: { oem: "*", model: "*-hcv", year: 0, region: "IN" },
  // HCVs run higher mass and longer routes; pads and tyres burn faster.
  brakePadWearRateMmPerKm: 0.00040,
  brakePadWearRateSigma: 0.00010,
  tyreWearRateMmPerKm: 0.00028,
  tyreWearRateSigma: 0.00009,
  hvBatteryArrheniusReferenceC: 35,
  oilChangeIntervalKm: 20_000,
  beltLifeKm: 150_000,
  regionNotes:
    "India HCV: GVW>=12t, multi-axle trunk routes; brake duty cycle is substantially heavier than passenger-light.",
};

export const SEED_CALIBRATION_ENTRIES: readonly CalibrationEntry[] = [
  SEED_INDIA_PASSENGER_LIGHT,
  SEED_EU_PASSENGER_LIGHT,
  SEED_US_PASSENGER_LIGHT,
  SEED_INDIA_HCV,
];

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export interface CalibrationLookupResult {
  entry: CalibrationEntry;
  usedFallback: boolean;
  matchedKey: CalibrationKey;
}

/**
 * Stable string key for the registry's internal Map.
 */
function keyToString(k: CalibrationKey): string {
  return `${k.oem}|${k.model}|${k.year}|${k.region}`;
}

/**
 * In-memory calibration registry. Deterministic — given the same put() calls
 * in the same order, every get() returns the same result. The fallback chain
 * is:
 *
 *   1. Exact (oem, model, year, region) match.
 *   2. (*, *, 0, region) regional default if seeded.
 *   3. The global DEFAULT_CALIBRATION_ENTRY.
 *
 * Every lookup that doesn't hit step 1 stamps `usedFallback: true`.
 */
export class CalibrationRegistry {
  private readonly exact = new Map<string, CalibrationEntry>();
  private readonly regionalDefaults = new Map<string, CalibrationEntry>();

  put(entry: CalibrationEntry): void {
    const parsed = CalibrationEntrySchema.parse(entry);
    if (parsed.key.oem === "*" && parsed.key.model === "*" && parsed.key.year === 0) {
      this.regionalDefaults.set(parsed.key.region, parsed);
    } else {
      this.exact.set(keyToString(parsed.key), parsed);
    }
  }

  get(key: CalibrationKey): CalibrationLookupResult {
    const validated = CalibrationKeySchema.parse(key);

    const exactHit = this.exact.get(keyToString(validated));
    if (exactHit !== undefined) {
      return { entry: exactHit, usedFallback: false, matchedKey: validated };
    }

    const regional = this.regionalDefaults.get(validated.region);
    if (regional !== undefined) {
      return {
        entry: regional,
        usedFallback: true,
        matchedKey: regional.key,
      };
    }

    return {
      entry: DEFAULT_CALIBRATION_ENTRY,
      usedFallback: true,
      matchedKey: DEFAULT_CALIBRATION_ENTRY.key,
    };
  }

  size(): { exact: number; regional: number } {
    return { exact: this.exact.size, regional: this.regionalDefaults.size };
  }
}

/**
 * Build a registry preloaded with the four seed entries. Every callsite
 * that needs calibration MUST go through a registry instance — there is no
 * module-level mutable singleton.
 */
export function buildSeedCalibrationRegistry(): CalibrationRegistry {
  const reg = new CalibrationRegistry();
  for (const e of SEED_CALIBRATION_ENTRIES) reg.put(e);
  return reg;
}
