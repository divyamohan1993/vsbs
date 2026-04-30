// =============================================================================
// Coverage manifest — which PHM-modelled components VSBS is qualified to
// reason about for a given vehicle class.
//
// A manifest is an explicit allow-list. Anything outside the manifest is
// "uncovered": VSBS has no calibrated model for that component on that
// vehicle class and must REFUSE autonomous reasoning rather than silently
// falling back to a generic estimate.
//
// Tier-1 (road-safety-critical) gaps are fatal: an HCV with no calibrated
// J1939 air-brake model cannot be cleared for autonomy by the resolver, even
// if every other tier-1 component on the seed list is healthy. Calling
// `refuseIfTier1Uncovered` from the autonomy resolver is therefore
// load-bearing for safety, not advisory.
//
// References:
//   docs/research/prognostics.md §2 (criticality tiers).
//   ISO 21448 (SOTIF) — known unknowns vs unknown unknowns.
//   AIS-053 (India CMVR vehicle classification).
// =============================================================================

import { z } from "zod";
import { ComponentIdSchema, COMPONENT_TIER, type ComponentId, type Tier } from "./phm.js";
import { VehicleClassSchema, type VehicleClass } from "./odd.js";

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

export const CoverageManifestSchema = z.object({
  vehicleClass: VehicleClassSchema,
  modelVersion: z.string().min(1),
  /** Components for which a calibrated PHM model exists for this class. */
  coveredComponents: z.array(ComponentIdSchema).min(1),
  /**
   * Tier-1 components the manifest deliberately *refuses* to cover for this
   * vehicle class, with a human-readable reason. Used to audit gaps that
   * are known but not yet filled (e.g. HCV air brakes).
   */
  knownGaps: z
    .array(
      z.object({
        component: ComponentIdSchema,
        reason: z.string().min(1).max(280),
      }),
    )
    .default([]),
  notes: z.string().max(2_000).optional(),
});
export type CoverageManifest = z.infer<typeof CoverageManifestSchema>;

// -----------------------------------------------------------------------------
// Seed manifests
// -----------------------------------------------------------------------------

const TIER_1_PASSENGER_LIGHT: ComponentId[] = [
  "brakes-hydraulic",
  "brakes-pads-front",
  "brakes-pads-rear",
  "abs-module",
  "steering-eps",
  "tire-fl",
  "tire-fr",
  "tire-rl",
  "tire-rr",
  "airbag-srs",
  "adas-camera-front",
  "adas-radar-front",
  "lidar-roof",
  "battery-hv",
];
const TIER_2_PASSENGER_LIGHT: ComponentId[] = [
  "adas-radar-corner-fl",
  "adas-radar-corner-fr",
  "adas-radar-corner-rl",
  "adas-radar-corner-rr",
  "ultrasonic-array",
  "imu",
  "battery-12v",
  "bms",
  "alternator",
  "engine-oil-system",
  "cooling-system",
  "fuel-system",
  "transmission",
  "drive-belt",
  "wheel-bearings",
];
const TIER_3_PASSENGER_LIGHT: ComponentId[] = [
  "suspension-dampers",
  "exhaust-o2",
  "dpf",
];

export const SEED_PASSENGER_LIGHT_MANIFEST: CoverageManifest = {
  vehicleClass: "passenger-light",
  modelVersion: "phm-pl-2026.04",
  coveredComponents: [
    ...TIER_1_PASSENGER_LIGHT,
    ...TIER_2_PASSENGER_LIGHT,
    ...TIER_3_PASSENGER_LIGHT,
  ],
  knownGaps: [],
  notes:
    "Full passenger-light coverage. Models calibrated for ICE, HEV, and PHEV; pure EVs use the ev-passenger manifest.",
};

/**
 * HCV manifest — deliberately reduced. Heavy commercial vehicles run J1939
 * air-brake systems which the current model does not yet calibrate; light-
 * duty disc-brake-pad models are explicitly REFUSED rather than reused.
 * Listing the gaps in `knownGaps` makes the refusal auditable.
 */
export const SEED_HCV_MANIFEST: CoverageManifest = {
  vehicleClass: "hcv",
  modelVersion: "phm-hcv-2026.04",
  coveredComponents: [
    "tire-fl",
    "tire-fr",
    "tire-rl",
    "tire-rr",
    "engine-oil-system",
    "cooling-system",
    "fuel-system",
    "transmission",
    "drive-belt",
    "wheel-bearings",
    "alternator",
    "battery-12v",
    "exhaust-o2",
    "dpf",
  ],
  knownGaps: [
    {
      component: "brakes-hydraulic",
      reason:
        "HCVs use J1939 air-brake systems; the hydraulic-brake model from the passenger-light manifest is not transferable.",
    },
    {
      component: "brakes-pads-front",
      reason:
        "Disc-pad wear curves do not match HCV drum or air-disc geometry. Awaiting EBS-J1939 calibration.",
    },
    {
      component: "brakes-pads-rear",
      reason:
        "Disc-pad wear curves do not match HCV drum or air-disc geometry. Awaiting EBS-J1939 calibration.",
    },
    {
      component: "abs-module",
      reason: "HCV ABS/EBS uses J1939 PIDs not yet ingested.",
    },
    {
      component: "steering-eps",
      reason: "HCVs typically run hydraulic-assist steering; EPS model does not apply.",
    },
    {
      component: "airbag-srs",
      reason: "HCV occupant restraint systems are out of scope for the 2026.04 release.",
    },
    {
      component: "adas-camera-front",
      reason: "HCV ADAS suites vary widely by axle config; specific calibrations pending.",
    },
    {
      component: "adas-radar-front",
      reason: "HCV ADAS suites vary widely by axle config; specific calibrations pending.",
    },
    {
      component: "lidar-roof",
      reason: "Most in-service HCVs are not lidar-equipped; calibration deferred.",
    },
    {
      component: "battery-hv",
      reason: "Heavy-duty BEV traction packs use different chemistries; out of scope this release.",
    },
  ],
  notes:
    "HCV coverage is deliberately narrow. Tier-1 air-brake and steering models are pending and MUST trigger refuseIfTier1Uncovered.",
};

/**
 * Two-wheeler manifest — very narrow. Most consumer-PHM components don't
 * apply (no ABS on lower trims, no EPS, no airbags on most models, no ADAS).
 * Tyre + chain-drive + brake-pad wear are the calibrated set.
 */
export const SEED_TWO_WHEELER_MANIFEST: CoverageManifest = {
  vehicleClass: "two-wheeler",
  modelVersion: "phm-2w-2026.04",
  coveredComponents: [
    "tire-fl",
    "tire-fr",
    "brakes-pads-front",
    "brakes-pads-rear",
    "drive-belt",
    "battery-12v",
    "engine-oil-system",
  ],
  knownGaps: [
    {
      component: "abs-module",
      reason:
        "Single-channel ABS only on select trims; calibration per VIN-derived trim pending.",
    },
    {
      component: "airbag-srs",
      reason: "Two-wheelers do not carry SRS airbags.",
    },
    {
      component: "steering-eps",
      reason: "Two-wheelers do not carry EPS.",
    },
    {
      component: "tire-rl",
      reason: "Two-wheelers have only front and rear tyres; rear-left does not exist.",
    },
    {
      component: "tire-rr",
      reason: "Two-wheelers have only front and rear tyres; rear-right does not exist.",
    },
  ],
  notes:
    "Two-wheelers are explicitly NOT eligible for Tier A AVP under this release; this manifest exists only for service-recommendation reasoning.",
};

export const SEED_COVERAGE_MANIFESTS: Record<VehicleClass, CoverageManifest | undefined> = {
  "passenger-light": SEED_PASSENGER_LIGHT_MANIFEST,
  "suv": undefined,
  "lcv": undefined,
  "hcv": SEED_HCV_MANIFEST,
  "two-wheeler": SEED_TWO_WHEELER_MANIFEST,
  "three-wheeler": undefined,
  "ev-passenger": undefined,
};

/**
 * Helper for tests / callers. Returns the seeded manifest if one exists,
 * otherwise undefined. Callers must treat undefined as "no calibrated model
 * for this vehicle class" and refuse autonomy.
 */
export function getSeedManifest(vehicleClass: VehicleClass): CoverageManifest | undefined {
  return SEED_COVERAGE_MANIFESTS[vehicleClass];
}

// -----------------------------------------------------------------------------
// Coverage assertion
// -----------------------------------------------------------------------------

export interface CoverageAssertionResult {
  covered: ComponentId[];
  uncovered: ComponentId[];
  tier1Uncovered: ComponentId[];
}

/**
 * Check the supplied component list against the manifest. Pure, O(n+m).
 * `tier1Uncovered` is the subset of `uncovered` whose COMPONENT_TIER is 1.
 */
export function assertCovered(
  manifest: CoverageManifest,
  components: ComponentId[],
): CoverageAssertionResult {
  const coveredSet = new Set(manifest.coveredComponents);
  const covered: ComponentId[] = [];
  const uncovered: ComponentId[] = [];
  const tier1Uncovered: ComponentId[] = [];

  for (const c of components) {
    if (coveredSet.has(c)) {
      covered.push(c);
    } else {
      uncovered.push(c);
      const tier: Tier = COMPONENT_TIER[c];
      if (tier === 1) tier1Uncovered.push(c);
    }
  }

  return { covered, uncovered, tier1Uncovered };
}

// -----------------------------------------------------------------------------
// Refusal gate
// -----------------------------------------------------------------------------

export class CoverageGap extends Error {
  override readonly name = "CoverageGap";
  readonly code = "coverage-gap" as const;
  readonly vehicleClass: VehicleClass;
  readonly missing: ComponentId[];

  constructor(vehicleClass: VehicleClass, missing: ComponentId[]) {
    super(
      `Tier-1 components uncovered for vehicle class ${vehicleClass}: ${missing.join(", ")}`,
    );
    this.vehicleClass = vehicleClass;
    this.missing = missing;
  }
}

/**
 * Throws CoverageGap if any of the requested components is tier-1 and not
 * covered by the manifest. The autonomy resolver consumes this gate before
 * minting any Tier-A grant — see docs/research/autonomy.md §5.
 */
export function refuseIfTier1Uncovered(
  manifest: CoverageManifest,
  components: ComponentId[],
): void {
  const { tier1Uncovered } = assertCovered(manifest, components);
  if (tier1Uncovered.length > 0) {
    throw new CoverageGap(manifest.vehicleClass, tier1Uncovered);
  }
}
