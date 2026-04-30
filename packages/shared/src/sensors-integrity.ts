// =============================================================================
// Sensors integrity surface.
//
// Re-exports the schemas that runtime integrity code in `@vsbs/sensors`
// (signed frames, replay window, provenance guard, anomaly monitor) consumes.
// Splitting these into their own module lets the coordinator add a single
// `export * from "./sensors-integrity.js"` line in the package barrel
// without re-exporting the whole sensors surface.
//
// All exports are pure type/schema declarations; no runtime behaviour lives
// here. The runtime lives in @vsbs/sensors. See:
//   - signed-frame.ts       (A1: HMAC signature + replay window)
//   - provenance-guard.ts   (A2: real/sim storage segregation)
//   - anomaly.ts            (A3: KL-divergence drift monitor)
//   - j1939.ts              (A4: heavy-duty CAN driver scaffold)
// =============================================================================

import { z } from "zod";
import { SensorChannelSchema, SensorOriginSchema } from "./sensors.js";

export {
  SignedFrameAlgSchema,
  SignedSensorFrameSchema,
  type SignedFrameAlg,
  type SignedSensorFrame,
} from "./sensors.js";

/**
 * Structured error code surface for the signed-frame ingest path. Stable
 * machine-readable identifiers; UI / logging layers translate them.
 */
export const FrameRejectionCodeSchema = z.enum([
  "frame-unsigned",
  "frame-replay",
  "frame-skew",
  "frame-bad-sig",
  "frame-unknown-key",
  "frame-shape",
]);
export type FrameRejectionCode = z.infer<typeof FrameRejectionCodeSchema>;

/**
 * Anomaly verdict for a single (vehicle, channel) pair, emitted by the
 * online KL-divergence monitor in `@vsbs/sensors/anomaly`.
 *
 * `state`:
 *   ok        — divergence within threshold for the whole window.
 *   suspected — threshold breached for fewer than `consecutiveTrigger`
 *               samples (early warning, not yet a sensor-failure).
 *   anomaly   — threshold breached for `consecutiveTrigger` consecutive
 *               samples; the existing PHM pipeline is expected to flip
 *               `suspectedSensorFailure: true` for any tier-1 reading whose
 *               channel is implicated.
 */
export const AnomalyVerdictSchema = z.object({
  vehicleId: z.string().min(1),
  channel: SensorChannelSchema,
  state: z.enum(["ok", "suspected", "anomaly"]),
  klNats: z.number().nonnegative(),
  threshold: z.number().nonnegative(),
  consecutive: z.number().int().nonnegative(),
  consecutiveTrigger: z.number().int().positive(),
  observedAt: z.string().datetime(),
});
export type AnomalyVerdict = z.infer<typeof AnomalyVerdictSchema>;

/**
 * Provenance store mode. The `provenance-guard` module REFUSES at runtime
 * any record whose origin is `"sim"` when the store is configured `"real"`.
 */
export const ProvenanceStoreModeSchema = z.enum(["real", "sim"]);
export type ProvenanceStoreMode = z.infer<typeof ProvenanceStoreModeSchema>;

export { SensorOriginSchema };
