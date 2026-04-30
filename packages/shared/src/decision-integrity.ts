// =============================================================================
// Decision-integrity barrel.
//
// Aggregates the load-bearing safety gates that every autonomous-decision
// path in VSBS must pass through: ODD envelope, per-vehicle-class coverage
// manifest, per-OEM/region calibration tables, and the coverage-aware PHM
// action. Importing from this single barrel keeps the contract auditable in
// one place.
//
// References:
//   docs/research/autonomy.md §5 (capability gates).
//   docs/research/prognostics.md §2-3 (criticality, calibration).
//   ISO 21448 (SOTIF), SAE J3016 §8 (ODD), ISO 34503 (ODD taxonomy).
// =============================================================================

export {
  Iso3166Alpha2Schema,
  WeatherSchema,
  TimeOfDaySchema,
  VehicleClassSchema,
  RoadClassSchema,
  OperationalDesignDomainSchema,
  OperationalContextSchema,
  ODD_VIOLATION_CODES,
  OddViolation,
  oddSatisfied,
  requireOdd,
} from "./odd.js";
export type {
  Weather,
  TimeOfDay,
  VehicleClass,
  RoadClass,
  OperationalDesignDomain,
  OperationalContext,
  OddVerdict,
  OddViolationCode,
  OddViolationReason,
} from "./odd.js";

export {
  CoverageManifestSchema,
  SEED_PASSENGER_LIGHT_MANIFEST,
  SEED_HCV_MANIFEST,
  SEED_TWO_WHEELER_MANIFEST,
  SEED_COVERAGE_MANIFESTS,
  getSeedManifest,
  assertCovered,
  refuseIfTier1Uncovered,
  CoverageGap,
} from "./coverage-manifest.js";
export type { CoverageManifest, CoverageAssertionResult } from "./coverage-manifest.js";

export {
  CalibrationKeySchema,
  CalibrationEntrySchema,
  DEFAULT_CALIBRATION_ENTRY,
  SEED_CALIBRATION_ENTRIES,
  CalibrationRegistry,
  buildSeedCalibrationRegistry,
} from "./calibration.js";
export type {
  CalibrationKey,
  CalibrationEntry,
  CalibrationLookupResult,
} from "./calibration.js";

export { phmActionWithCoverage } from "./phm.js";
