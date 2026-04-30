// =============================================================================
// Sensor channel types. The runtime simulator + fusion engine live in the
// `@vsbs/sensors` package; this file defines the cross-package contracts.
// Reference: docs/research/autonomy.md §2-3, docs/research/prognostics.md §5.
// =============================================================================

import { z } from "zod";

export const SensorOriginSchema = z.enum(["real", "sim"]);
export type SensorOrigin = z.infer<typeof SensorOriginSchema>;

/**
 * Provenance discriminator within `origin: "sim"`. Defaults to "deterministic"
 * for back-compat with existing callers; a CARLA bridge stamps "carla", and
 * the offline trace replayer stamps "replay". Real samples should never set
 * this field; the fusion layer treats `simSource` as informational and never
 * lifts a sim sample into a real-decision path.
 */
export const SimSourceSchema = z.enum(["deterministic", "carla", "replay"]);
export type SimSource = z.infer<typeof SimSourceSchema>;

export const SensorChannelSchema = z.enum([
  "obd-pid",
  "obd-dtc",
  "obd-freeze-frame",
  "smartcar",
  "tpms",
  "bms",
  "imu",
  "gps",
  "camera-front",
  "camera-rear",
  "camera-surround",
  "camera-cabin",
  "lidar",
  "radar-front",
  "radar-corner",
  "ultrasonic",
  "microphone",
  "hvac",
  "wheel-speed",
  "brake-pressure",
  "steering-torque",
]);
export type SensorChannel = z.infer<typeof SensorChannelSchema>;

/**
 * A generic sample header. Concrete sample payloads are channel-specific
 * and travel in `value`. Every sample is stamped with an `origin` so that
 * simulated data can never masquerade as real customer telemetry.
 */
export const SensorSampleSchema = z.object({
  channel: SensorChannelSchema,
  timestamp: z.string().datetime(),
  origin: SensorOriginSchema,
  vehicleId: z.string(),
  value: z.unknown(),
  health: z
    .object({
      selfTestOk: z.boolean().default(true),
      trust: z.number().min(0).max(1).default(1),
      residual: z.number().optional(),
    })
    .default({ selfTestOk: true, trust: 1 }),
  simSource: SimSourceSchema.optional(),
});
export type SensorSample = z.infer<typeof SensorSampleSchema>;

/**
 * A signed sensor frame envelope. Wraps a `SensorSample` with the metadata
 * needed by the integrity layer in `@vsbs/sensors/signed-frame`:
 *   - keyId   : identifier for the per-vehicle HMAC key (so live mode can
 *               point at a KMS handle and sim mode can use an in-memory key
 *               under the same shape).
 *   - nonce   : per-frame opaque token used for replay detection inside the
 *               configurable skew window (default 5000 ms).
 *   - alg     : signature algorithm id. Today we ship "HMAC-SHA-256"; the
 *               field is enumerated so a future PQ-resistant algorithm can
 *               be promoted via configuration.
 *   - signature: base64url over the canonical bytes of
 *               (vehicleId, channel, ts, payload, nonce). Canonicalisation
 *               is RFC 8785 (sorted keys, no whitespace, deterministic).
 *
 * The ingest path rejects unsigned frames with structured errors:
 *   "frame-unsigned" | "frame-replay" | "frame-skew" | "frame-bad-sig"
 *   | "frame-unknown-key" | "frame-shape".
 */
export const SignedFrameAlgSchema = z.enum(["HMAC-SHA-256"]);
export type SignedFrameAlg = z.infer<typeof SignedFrameAlgSchema>;

export const SignedSensorFrameSchema = z.object({
  sample: SensorSampleSchema,
  keyId: z.string().min(1),
  nonce: z.string().min(8).max(128),
  alg: SignedFrameAlgSchema,
  signature: z.string().min(1),
});
export type SignedSensorFrame = z.infer<typeof SignedSensorFrameSchema>;

export const FusedObservationSchema = z.object({
  observationId: z.string().uuid(),
  vehicleId: z.string(),
  timestamp: z.string().datetime(),
  statements: z.array(
    z.object({
      claim: z.string(),
      confidence: z.number().min(0).max(1),
      supportingChannels: z.array(SensorChannelSchema).min(1),
      contradictingChannels: z.array(SensorChannelSchema).default([]),
      status: z.enum(["confirmed", "suspected", "sensor-failure"]),
    }),
  ),
  originSummary: z.object({
    real: z.number().int().nonnegative(),
    sim: z.number().int().nonnegative(),
    simSources: z
      .object({
        deterministic: z.number().int().nonnegative(),
        carla: z.number().int().nonnegative(),
        replay: z.number().int().nonnegative(),
      })
      .default({ deterministic: 0, carla: 0, replay: 0 }),
  }),
});
export type FusedObservation = z.infer<typeof FusedObservationSchema>;
