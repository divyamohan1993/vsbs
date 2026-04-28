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
