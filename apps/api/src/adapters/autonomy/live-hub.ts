// =============================================================================
// LiveAutonomyHub — in-memory pub/sub keyed by bookingId.
//
// Two channels per booking:
//   - telemetry: continuous physical state of the vehicle. Schema mirrors
//                what a Tesla FSD HW4 / Waymo 6 / Mobileye Chauffeur stack
//                publishes off-vehicle to a fleet operator dashboard:
//                eight surround cameras, four 4D imaging radars, one or
//                more solid-state LiDARs, thermal IR, ultrasonic, audio
//                array, multi-constellation GNSS, tactical-grade IMU,
//                wheel encoders, brake pressure per circuit, air
//                suspension, TPMS + temp, motor/inverter, HV cells, BMS,
//                isolation resistance, AI compute utilisation, lockstep
//                diff, HSM heartbeat, V2X bus (BSM / SPaT / MAP / DENM),
//                5G + MEC RTT, HD-map sync, OOD score, ODD compliance,
//                R157 takeover state, perception detections, BEV
//                occupancy stats, planner horizon, driver attention.
//   - events:    discrete observations (red light detected, pedestrian
//                inside braking radius, fault deteriorating, V2X DENM
//                received, scenario state transition, etc.).
//
// The CARLA bridge POSTs frames + events; the dashboard SSE consumers
// subscribe and receive a copy. A bounded ring buffer per booking keeps
// the last 100 frames and 50 events so a late subscriber has immediate
// context.
//
// We deliberately avoid Redis / Pub-Sub here: a single Cloud Run instance
// holds a booking in memory for its lifetime, and the regional sticky-
// session router (apps/api/src/middleware/region-residency.ts) keeps
// consumers on the same instance as the producer. When we shard, the hub
// is the only seam that needs to grow into a network broker — see
// docs/architecture.md §7.
// =============================================================================

import { z } from "zod";

// --- Sub-schemas (kept small + composable) --------------------------------

const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

const SensorHealth = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  /** "ok" | "watch" | "alert" | "offline" */
  status: z.enum(["ok", "watch", "alert", "offline"]),
  /** Effective publish rate the bridge observed in the last second. */
  hz: z.number().min(0).max(2_000).optional(),
  /** Detection count in the latest tick. */
  returns: z.number().min(0).optional(),
  /** Self-reported temperature for thermal-sensitive modules (LiDAR, GNSS). */
  tempC: z.number().min(-50).max(150).optional(),
  /** Optional FoV in degrees (used by camera + radar tiles). */
  fovDeg: z.number().min(0).max(360).optional(),
  /** Optional max range in metres (LiDAR / radar / ultrasonic). */
  rangeM: z.number().min(0).max(2000).optional(),
});

const GnssBlock = z.object({
  fix: z.enum(["none", "2d", "3d", "rtk-float", "rtk-fixed"]),
  satellites: z.number().int().min(0).max(60),
  hdop: z.number().min(0).max(50),
  pdop: z.number().min(0).max(50).optional(),
  /** Per-constellation tracked sat counts (May 2026 multi-band receivers). */
  constellations: z
    .object({
      gps: z.number().int().min(0).max(40),
      glonass: z.number().int().min(0).max(40),
      galileo: z.number().int().min(0).max(40),
      beidou: z.number().int().min(0).max(40),
      qzss: z.number().int().min(0).max(40).optional(),
      navic: z.number().int().min(0).max(40).optional(),
    })
    .partial()
    .optional(),
  rtkAgeS: z.number().min(0).max(600).optional(),
  ageS: z.number().min(0).max(60).optional(),
  speedAccuracyMps: z.number().min(0).optional(),
  posAccuracyM: z.number().min(0).optional(),
});

const ImuBlock = z.object({
  accel: Vec3,
  gyro: Vec3,
  magneto: Vec3.optional(),
  tempC: z.number().min(-40).max(120).optional(),
  /** Bias instability in deg/hr — quality marker for tactical-grade FOG. */
  biasInstabilityDegHr: z.number().min(0).optional(),
});

const WheelsBlock = z.object({
  rpm: z.object({
    fl: z.number(),
    fr: z.number(),
    rl: z.number(),
    rr: z.number(),
  }),
  /** Brake-rotor surface temp inferred from hub thermistors (°C). */
  hubTempC: z
    .object({
      fl: z.number(),
      fr: z.number(),
      rl: z.number(),
      rr: z.number(),
    })
    .optional(),
  /** TPMS pressure in kPa per corner. */
  tpmsKpa: z.object({
    fl: z.number(),
    fr: z.number(),
    rl: z.number(),
    rr: z.number(),
  }),
  /** Tyre carcass temp from in-tyre pyrometric pucks (luxury OEM 2025+). */
  tpmsTempC: z
    .object({
      fl: z.number(),
      fr: z.number(),
      rl: z.number(),
      rr: z.number(),
    })
    .optional(),
});

const ChassisBlock = z.object({
  steeringAngleDeg: z.number().min(-720).max(720),
  steeringTorqueNm: z.number().min(-25).max(25).optional(),
  brakePressureBar: z
    .object({
      front: z.number().min(0).max(220),
      rear: z.number().min(0).max(220),
    })
    .optional(),
  /** Air-suspension ride height (mm) per corner. */
  rideHeightMm: z
    .object({
      fl: z.number(),
      fr: z.number(),
      rl: z.number(),
      rr: z.number(),
    })
    .optional(),
  /** Estimated road friction coefficient (0-1). */
  frictionCoef: z.number().min(0).max(1.2).optional(),
});

const PowertrainBlock = z.object({
  motorFront: z
    .object({
      torqueNm: z.number(),
      tempStatorC: z.number(),
      tempRotorC: z.number(),
      rpm: z.number(),
    })
    .optional(),
  motorRear: z
    .object({
      torqueNm: z.number(),
      tempStatorC: z.number(),
      tempRotorC: z.number(),
      rpm: z.number(),
    })
    .optional(),
  inverterTempC: z.number().min(-40).max(150).optional(),
  inverterCurrentA: z.number().min(-2_000).max(2_000).optional(),
  hvBusV: z.number().min(0).max(900).optional(),
  hvBusA: z.number().min(-1_500).max(1_500).optional(),
  aux12vV: z.number().min(0).max(16).optional(),
  /** Cell-level voltage histogram (mV) — typical L5 packs run 96..108 cells. */
  hvCellsMv: z.array(z.number().min(2_000).max(4_500)).max(120).optional(),
  /** Cell temp histogram (°C). */
  hvCellsTempC: z.array(z.number().min(-30).max(80)).max(120).optional(),
  /** Pack isolation resistance to chassis (kΩ). > 500 kΩ is healthy. */
  hvIsolationKohm: z.number().min(0).max(50_000).optional(),
  hvSocPercent: z.number().min(0).max(100),
  hvSohPercent: z.number().min(0).max(110).optional(),
  hvSopKw: z.number().min(0).optional(),
  /** Coolant loop temps. */
  coolantMotorC: z.number().optional(),
  coolantBatteryC: z.number().optional(),
  coolantInverterC: z.number().optional(),
  /** Generic single-loop coolant for legacy packs. */
  coolantTempC: z.number().min(-40).max(150),
});

const PerceptionBlock = z
  .object({
    detections: z
      .object({
        vehicles: z.number().int().min(0),
        pedestrians: z.number().int().min(0),
        cyclists: z.number().int().min(0),
        twoWheelers: z.number().int().min(0).optional(),
        animals: z.number().int().min(0).optional(),
        signs: z.number().int().min(0),
        cones: z.number().int().min(0).optional(),
      })
      .partial(),
    /** Top tracks visible to the dashboard — limit to keep payload small. */
    tracks: z
      .array(
        z.object({
          id: z.string(),
          cls: z.enum([
            "vehicle",
            "pedestrian",
            "cyclist",
            "two-wheeler",
            "animal",
            "static",
            "unknown",
          ]),
          /** Distance from ego in metres. */
          distanceM: z.number().min(0),
          /** Bearing relative to ego heading (deg). */
          bearingDeg: z.number(),
          /** Estimated longitudinal velocity (m/s). */
          vMps: z.number(),
          /** Predicted trajectory horizon (s). */
          predictionHorizonS: z.number().min(0).optional(),
          /** Risk score [0..1]. */
          risk: z.number().min(0).max(1).optional(),
        }),
      )
      .max(16)
      .optional(),
    bevOccupancy: z
      .object({
        /** Occupied voxel ratio over the 60×60 m BEV grid. */
        occupiedRatio: z.number().min(0).max(1),
        /** Highest single-cell uncertainty in the next 2 s rollout. */
        peakUncertainty: z.number().min(0).max(1).optional(),
      })
      .optional(),
    laneGraph: z
      .object({
        currentLane: z.number().int().min(0),
        totalLanes: z.number().int().min(1),
        confidence: z.number().min(0).max(1),
      })
      .optional(),
    trafficLight: z
      .object({
        state: z.enum(["green", "yellow", "red", "off", "unknown"]),
        /** Time-to-change estimate (s). */
        ttcS: z.number().min(0).optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
      .optional(),
    /** Free-space ratio in the front 30° cone. */
    freeSpaceRatio: z.number().min(0).max(1).optional(),
    /** Drivable area mIoU vs HD map. */
    drivableAreaMiou: z.number().min(0).max(1).optional(),
  })
  .partial();

const PlannerBlock = z
  .object({
    horizonS: z.number().min(0).max(20),
    sampledTrajectories: z.number().int().min(0),
    selectedAlt: z.number().int().min(0).optional(),
    /** Soft-constraint violations across the horizon. */
    softViolations: z.number().int().min(0).optional(),
    /** Hard constraint violations (would force a re-plan). */
    hardViolations: z.number().int().min(0).optional(),
    /** Conditional Value-at-Risk on collision probability. */
    cvar95: z.number().min(0).max(1).optional(),
    /** Active behavior. */
    behavior: z.enum([
      "cruise",
      "follow",
      "lane-change",
      "merge",
      "yield",
      "stop",
      "park",
      "minimal-risk-manoeuvre",
    ]),
  })
  .partial();

const ControlBlock = z
  .object({
    throttle: z.number().min(0).max(1),
    brake: z.number().min(0).max(1),
    steering: z.number().min(-1).max(1),
    gear: z.number().int().min(-1).max(8),
  })
  .partial();

const ComputeBlock = z
  .object({
    /** Primary AI compute (Tesla HW4 / NVIDIA Drive Orin / Mobileye EyeQ Ultra). */
    primary: z
      .object({
        soc: z.string().max(40),
        cpuPct: z.number().min(0).max(100),
        gpuPct: z.number().min(0).max(100).optional(),
        npuPct: z.number().min(0).max(100).optional(),
        ramPct: z.number().min(0).max(100).optional(),
        tempC: z.number().optional(),
        powerW: z.number().min(0).max(1_500).optional(),
      })
      .partial(),
    /** Secondary lockstep ECU (safety MCU). */
    lockstep: z
      .object({
        soc: z.string().max(40),
        cpuPct: z.number().min(0).max(100),
        diffPpm: z.number().min(0).max(1_000_000),
        tempC: z.number().optional(),
      })
      .partial()
      .optional(),
    hsmHeartbeatOk: z.boolean().optional(),
  })
  .partial();

const NetworkBlock = z
  .object({
    /** Cellular: 5G NR-V2X uplink. */
    rsrpDbm: z.number().min(-160).max(-40).optional(),
    rsrqDb: z.number().min(-40).max(0).optional(),
    sinrDb: z.number().optional(),
    /** RTT to mobile-edge compute (ms). */
    mecRttMs: z.number().min(0).max(5_000).optional(),
    /** Wi-Fi 6E backhaul state. */
    wifiRssiDbm: z.number().min(-100).max(-20).optional(),
    /** HD-map version + sync state. */
    hdMapVersion: z.string().max(64).optional(),
    hdMapSyncedAt: z.string().datetime().optional(),
    /** Crowd-sourced HD-map updates pending. */
    hdMapDeltasPending: z.number().int().min(0).optional(),
  })
  .partial();

const V2xBlock = z
  .object({
    /** Receive counts in the last second (PC5 sidelink + 5G NR-V2X). */
    bsmRxPerSec: z.number().min(0).optional(),
    camRxPerSec: z.number().min(0).optional(),
    spatRxPerSec: z.number().min(0).optional(),
    mapRxPerSec: z.number().min(0).optional(),
    denmRxPerSec: z.number().min(0).optional(),
    rsaRxPerSec: z.number().min(0).optional(),
    /** Latest decoded message — small payload for the live dashboard log. */
    latestKind: z
      .enum(["BSM", "CAM", "SPaT", "MAP", "DENM", "RSA", "SSM", "TIM"])
      .optional(),
    latestSummary: z.string().max(160).optional(),
    /** Number of identified neighbours communicating via PC5. */
    neighbours: z.number().int().min(0).optional(),
  })
  .partial();

const SafetyBlock = z
  .object({
    /** ODD compliance now. */
    oddCompliant: z.boolean(),
    /** Human-readable reason if not compliant. */
    oddReason: z.string().max(160).optional(),
    /** OOD detector score (Mahalanobis distance on intermediate features). */
    oodMahalanobis: z.number().min(0).optional(),
    /** OOD threshold — values above this trigger a fallback. */
    oodThreshold: z.number().min(0).optional(),
    /** UNECE R157 takeover ladder rung (0=none, 1..4=escalating). */
    takeoverRung: z.number().int().min(0).max(4).optional(),
    /** Time-to-collision to nearest agent (s). */
    ttcSec: z.number().optional(),
    /** Fault-Tolerant Time Interval remaining (ms). */
    fttiMs: z.number().optional(),
    /** Capability-budget remaining (0..1) — depletes as the SOTIF stack burns
     *  margin. */
    capabilityBudget: z.number().min(0).max(1).optional(),
    /** Active Minimal-Risk Manoeuvre, if any. */
    mrmActive: z.boolean().optional(),
    mrmKind: z.string().max(80).optional(),
  })
  .partial();

const CabinBlock = z
  .object({
    cabinTempC: z.number().optional(),
    cabinHumidityPct: z.number().min(0).max(100).optional(),
    co2Ppm: z.number().min(0).max(10_000).optional(),
    pm25Ugm3: z.number().min(0).max(2_000).optional(),
    /** L4 backup-driver attention from a DMS camera (Smart Eye / Seeing Machines). */
    driverAttention: z
      .object({
        gazeOnRoad: z.number().min(0).max(1),
        eyesClosed: z.boolean(),
        handsOnWheel: z.boolean().optional(),
        seatBelt: z.boolean().optional(),
      })
      .optional(),
    occupants: z.number().int().min(0).max(8).optional(),
  })
  .partial();

const EnvironmentBlock = z
  .object({
    weather: z.enum(["clear", "cloudy", "rain", "fog", "snow", "storm"]).optional(),
    visibilityM: z.number().min(0).optional(),
    ambientTempC: z.number().optional(),
    ambientHumidityPct: z.number().min(0).max(100).optional(),
    windKph: z.number().min(0).optional(),
    pavement: z
      .enum(["asphalt-dry", "asphalt-wet", "concrete", "gravel", "ice", "snow"])
      .optional(),
    timeOfDay: z.enum(["day", "dusk", "night", "dawn"]).optional(),
  })
  .partial();

const SoftwareBlock = z
  .object({
    perceptionVersion: z.string().max(48).optional(),
    plannerVersion: z.string().max(48).optional(),
    controlVersion: z.string().max(48).optional(),
    osVersion: z.string().max(48).optional(),
    calibrationVersion: z.string().max(48).optional(),
    shadowModeUploadAt: z.string().datetime().optional(),
  })
  .partial();

// --- Top-level frame -------------------------------------------------------

export const LiveTelemetryFrameSchema = z
  .object({
    ts: z.string().datetime(),
    /** "real" = ego is on physical road; "sim" = CARLA / replay / synthetic. */
    origin: z.enum(["real", "sim"]),
    simSource: z.string().max(80).optional(),

    // ---- minimal channels (back-compat with the prior schema) ----
    speedKph: z.number().min(0).max(400),
    headingDeg: z.number().min(0).max(360),
    brakePadFrontPercent: z.number().min(0).max(100),
    hvSocPercent: z.number().min(0).max(100),
    coolantTempC: z.number().min(-40).max(150),
    tpms: z.object({
      fl: z.number(),
      fr: z.number(),
      rl: z.number(),
      rr: z.number(),
    }),

    // ---- extended L5 stack (all optional, every channel populated by
    //      either the live CARLA bridge or the deterministic fallback) ----
    gps: z.object({ lat: z.number(), lng: z.number() }).optional(),
    accel: Vec3.optional(),
    distanceToServiceCentreM: z.number().min(0).optional(),
    nearbyVehicles: z.number().int().min(0).optional(),
    nearbyPedestrians: z.number().int().min(0).optional(),
    trafficLightState: z.enum(["green", "yellow", "red", "off", "unknown"]).optional(),

    sensors: z
      .object({
        cameras: z.array(SensorHealth).max(16).optional(),
        radars: z.array(SensorHealth).max(8).optional(),
        lidars: z.array(SensorHealth).max(4).optional(),
        ultrasonic: z.array(SensorHealth).max(16).optional(),
        thermal: z.array(SensorHealth).max(4).optional(),
        microphones: z.array(SensorHealth).max(8).optional(),
      })
      .partial()
      .optional(),

    gnss: GnssBlock.optional(),
    imu: ImuBlock.optional(),
    wheels: WheelsBlock.optional(),
    chassis: ChassisBlock.optional(),
    powertrain: PowertrainBlock.optional(),
    perception: PerceptionBlock.optional(),
    planner: PlannerBlock.optional(),
    control: ControlBlock.optional(),
    compute: ComputeBlock.optional(),
    network: NetworkBlock.optional(),
    v2x: V2xBlock.optional(),
    safety: SafetyBlock.optional(),
    cabin: CabinBlock.optional(),
    environment: EnvironmentBlock.optional(),
    software: SoftwareBlock.optional(),

    // ---- legacy top-level driver inputs (kept for back-compat) ----
    throttle: z.number().min(0).max(1).optional(),
    brake: z.number().min(0).max(1).optional(),
    steering: z.number().min(-1).max(1).optional(),
    gear: z.number().int().optional(),
  })
  .passthrough();

export type LiveTelemetryFrame = z.infer<typeof LiveTelemetryFrameSchema>;

export const PerceptionEventSchema = z.object({
  ts: z.string().datetime(),
  category: z.enum([
    "perception",
    "fault",
    "safety",
    "navigation",
    "driving",
    "scenario",
    "v2x",
    "cabin",
    "infra",
  ]),
  severity: z.enum(["info", "watch", "alert", "critical"]),
  title: z.string().min(1).max(120),
  detail: z.string().max(500).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type PerceptionEvent = z.infer<typeof PerceptionEventSchema>;

// --- Hub -------------------------------------------------------------------

interface BookingChannel {
  frames: LiveTelemetryFrame[];
  events: PerceptionEvent[];
  lastFrameAt: number;
  frameSubscribers: Set<(f: LiveTelemetryFrame) => void>;
  eventSubscribers: Set<(e: PerceptionEvent) => void>;
}

const FRAME_RING = 100;
const EVENT_RING = 50;
const FRESH_WINDOW_MS = 4_000;

export class LiveAutonomyHub {
  private channels = new Map<string, BookingChannel>();

  private channel(bookingId: string): BookingChannel {
    let ch = this.channels.get(bookingId);
    if (!ch) {
      ch = {
        frames: [],
        events: [],
        lastFrameAt: 0,
        frameSubscribers: new Set(),
        eventSubscribers: new Set(),
      };
      this.channels.set(bookingId, ch);
    }
    return ch;
  }

  publishFrame(bookingId: string, frame: LiveTelemetryFrame): void {
    const ch = this.channel(bookingId);
    ch.frames.push(frame);
    if (ch.frames.length > FRAME_RING) {
      ch.frames.splice(0, ch.frames.length - FRAME_RING);
    }
    ch.lastFrameAt = Date.now();
    for (const cb of ch.frameSubscribers) {
      try {
        cb(frame);
      } catch {
        // a single broken subscriber must not stop the fan-out
      }
    }
  }

  publishEvent(bookingId: string, event: PerceptionEvent): void {
    const ch = this.channel(bookingId);
    ch.events.push(event);
    if (ch.events.length > EVENT_RING) {
      ch.events.splice(0, ch.events.length - EVENT_RING);
    }
    for (const cb of ch.eventSubscribers) {
      try {
        cb(event);
      } catch {
        /* swallow */
      }
    }
  }

  /** Returns true when a frame arrived within the freshness window. */
  isLive(bookingId: string, now = Date.now()): boolean {
    const ch = this.channels.get(bookingId);
    if (!ch || ch.lastFrameAt === 0) return false;
    return now - ch.lastFrameAt <= FRESH_WINDOW_MS;
  }

  recentFrames(bookingId: string): LiveTelemetryFrame[] {
    return this.channels.get(bookingId)?.frames ?? [];
  }

  recentEvents(bookingId: string): PerceptionEvent[] {
    return this.channels.get(bookingId)?.events ?? [];
  }

  subscribeFrames(
    bookingId: string,
    cb: (f: LiveTelemetryFrame) => void,
  ): () => void {
    const ch = this.channel(bookingId);
    ch.frameSubscribers.add(cb);
    return () => ch.frameSubscribers.delete(cb);
  }

  subscribeEvents(
    bookingId: string,
    cb: (e: PerceptionEvent) => void,
  ): () => void {
    const ch = this.channel(bookingId);
    ch.eventSubscribers.add(cb);
    return () => ch.eventSubscribers.delete(cb);
  }

  /** Test / lifecycle helper — clear everything for a single booking. */
  clear(bookingId: string): void {
    this.channels.delete(bookingId);
  }
}

/** Process-singleton. Cloud Run instances are short-lived enough that this
 *  doesn't need a separate lifecycle. */
let singleton: LiveAutonomyHub | null = null;
export function getLiveAutonomyHub(): LiveAutonomyHub {
  if (!singleton) singleton = new LiveAutonomyHub();
  return singleton;
}
