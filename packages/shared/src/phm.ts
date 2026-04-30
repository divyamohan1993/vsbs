// =============================================================================
// Prognostic Health Management — component criticality tiers and RUL types.
// Reference: docs/research/prognostics.md
// Standards: ISO 13374 (pipeline stages), ISO 21448 (SOTIF), ISO 26262 (ASIL).
// =============================================================================

import { z } from "zod";

export const ComponentIdSchema = z.enum([
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
  "adas-radar-corner-fl",
  "adas-radar-corner-fr",
  "adas-radar-corner-rl",
  "adas-radar-corner-rr",
  "lidar-roof",
  "ultrasonic-array",
  "imu",
  "battery-12v",
  "battery-hv",
  "bms",
  "alternator",
  "engine-oil-system",
  "cooling-system",
  "fuel-system",
  "transmission",
  "suspension-dampers",
  "drive-belt",
  "wheel-bearings",
  "exhaust-o2",
  "dpf",
]);
export type ComponentId = z.infer<typeof ComponentIdSchema>;

/**
 * Criticality tier per docs/research/prognostics.md §2.
 * Tier 1 — road-safety-critical. Failure ⇒ vehicle unsafe.
 * Tier 2 — impacts reliability but not immediate safety.
 * Tier 3 — comfort / emissions.
 */
export type Tier = 1 | 2 | 3;

export const COMPONENT_TIER: Record<ComponentId, Tier> = {
  "brakes-hydraulic": 1,
  "brakes-pads-front": 1,
  "brakes-pads-rear": 1,
  "abs-module": 1,
  "steering-eps": 1,
  "tire-fl": 1,
  "tire-fr": 1,
  "tire-rl": 1,
  "tire-rr": 1,
  "airbag-srs": 1,
  "adas-camera-front": 1,
  "adas-radar-front": 1,
  "adas-radar-corner-fl": 2,
  "adas-radar-corner-fr": 2,
  "adas-radar-corner-rl": 2,
  "adas-radar-corner-rr": 2,
  "lidar-roof": 1,
  "ultrasonic-array": 2,
  "imu": 2,
  "battery-12v": 2,
  "battery-hv": 1,
  "bms": 2,
  "alternator": 2,
  "engine-oil-system": 2,
  "cooling-system": 2,
  "fuel-system": 2,
  "transmission": 2,
  "suspension-dampers": 3,
  "drive-belt": 2,
  "wheel-bearings": 2,
  "exhaust-o2": 3,
  "dpf": 3,
};

export const PhmStateSchema = z.enum(["healthy", "watch", "act-soon", "critical", "unsafe"]);
export type PhmState = z.infer<typeof PhmStateSchema>;

/**
 * One PHM reading per (vehicle, component). Always carries uncertainty.
 * The consumer (autonomy + UI) must use `pFailLower` for safety decisions.
 */
export const PhmReadingSchema = z.object({
  vehicleId: z.string(),
  component: ComponentIdSchema,
  tier: z.literal(1).or(z.literal(2)).or(z.literal(3)),
  state: PhmStateSchema,
  pFail1000km: z.number().min(0).max(1),
  pFailLower: z.number().min(0).max(1),
  pFailUpper: z.number().min(0).max(1),
  rulKmMean: z.number().nonnegative().optional(),
  rulKmLower: z.number().nonnegative().optional(),
  modelSource: z.enum([
    "physics-of-failure",
    "empirical-rule",
    "ensemble-transformer",
    "ensemble-lstm",
    "inspection",
  ]),
  featuresVersion: z.string(),
  updatedAt: z.string().datetime(),
  suspectedSensorFailure: z.boolean().default(false),
});
export type PhmReading = z.infer<typeof PhmReadingSchema>;

/**
 * Translate (component-tier, state) → operational action for the
 * autonomy + UI layer. Deterministic, O(1). See prognostics.md §4.
 */
export type PhmAction =
  | { kind: "silent" }
  | { kind: "remind-next-open" }
  | { kind: "alert-propose-booking"; severity: "amber" }
  | { kind: "refuse-autonomy-propose-mobile"; reason?: string }
  | { kind: "takeover-required-and-block-autonomy"; mrm: boolean }
  | { kind: "manual-drive-to-shop"; reason: string };

export function phmAction(reading: PhmReading, inMotion: boolean): PhmAction {
  if (reading.state === "unsafe") {
    if (inMotion) return { kind: "takeover-required-and-block-autonomy", mrm: true };
    if (reading.tier === 1) return { kind: "takeover-required-and-block-autonomy", mrm: false };
    return { kind: "refuse-autonomy-propose-mobile" };
  }
  if (reading.state === "critical") {
    if (reading.tier === 1) return { kind: "takeover-required-and-block-autonomy", mrm: inMotion };
    return { kind: "refuse-autonomy-propose-mobile" };
  }
  if (reading.state === "act-soon") return { kind: "alert-propose-booking", severity: "amber" };
  if (reading.state === "watch") return { kind: "remind-next-open" };
  return { kind: "silent" };
}

export function isTierOneSensorDead(readings: PhmReading[]): { dead: boolean; component?: ComponentId; reason?: string } {
  for (const r of readings) {
    if (r.tier === 1 && r.suspectedSensorFailure) {
      return {
        dead: true,
        component: r.component,
        reason: "A tier-1 safety-critical sensor is reporting failure; autonomy refused per SOTIF.",
      };
    }
  }
  return { dead: false };
}

/**
 * Coverage-aware variant. Pre-checks the manifest's covered set; if the
 * reading's component is *uncovered* for the manifest's vehicle class, the
 * action is `refuse-autonomy-propose-mobile` regardless of state. Otherwise
 * it delegates to `phmAction` so behaviour is unchanged for covered
 * components. The existing `phmAction` signature is intentionally
 * preserved for backward compatibility with the sensors-team consumers.
 *
 * The minimal `manifest` shape used here is the same `coveredComponents`
 * field that `CoverageManifestSchema` enforces, but to avoid a circular
 * import we accept a structural subset.
 */
export function phmActionWithCoverage(
  reading: PhmReading,
  inMotion: boolean,
  manifest: { coveredComponents: readonly ComponentId[] },
): PhmAction {
  if (!manifest.coveredComponents.includes(reading.component)) {
    return {
      kind: "refuse-autonomy-propose-mobile",
      reason: "component not covered for vehicle class",
    };
  }
  return phmAction(reading, inMotion);
}
