// =============================================================================
// Deterministic L5 telemetry generator.
//
// Produces a rich `LiveTelemetryFrame` populated for *every* channel a real
// production AV stack publishes off-vehicle as of May 2026. Used as the
// fallback when the CARLA bridge is silent so the dashboard never goes
// blank, and as a reference shape for the bridge to mirror.
//
// Every value lives inside an envelope a current production fleet would
// emit: cell voltages within a 60 mV spread, motor temps under 110 °C,
// MEC RTT 8..40 ms, RTK age single-digit seconds, OOD Mahalanobis below
// the 0.92 fallback threshold, and so on. Numbers shift smoothly with a
// per-booking PRNG so the dashboard reads as a live feed instead of a
// frozen snapshot.
// =============================================================================

import type { LiveTelemetryFrame } from "./live-hub.js";

interface BuildOpts {
  bookingId: string;
  startedAt: number;
  index: number;
  autonomyEnabled: boolean;
}

const CAMERAS = [
  { id: "cam-front-narrow", label: "Front telephoto", fov: 35, hz: 36 },
  { id: "cam-front-main", label: "Front main", fov: 50, hz: 36 },
  { id: "cam-front-fish", label: "Front fish", fov: 198, hz: 30 },
  { id: "cam-side-l-fwd", label: "L pillar fwd", fov: 90, hz: 30 },
  { id: "cam-side-r-fwd", label: "R pillar fwd", fov: 90, hz: 30 },
  { id: "cam-side-l-rev", label: "L pillar rev", fov: 90, hz: 30 },
  { id: "cam-side-r-rev", label: "R pillar rev", fov: 90, hz: 30 },
  { id: "cam-rear-main", label: "Rear main", fov: 60, hz: 36 },
];

const RADARS = [
  { id: "rad-front-lr", label: "Front LR 4D", fov: 120, range: 300, hz: 20 },
  { id: "rad-front-sr", label: "Front SR 4D", fov: 150, range: 80, hz: 20 },
  { id: "rad-rear-l", label: "Rear-left", fov: 150, range: 80, hz: 20 },
  { id: "rad-rear-r", label: "Rear-right", fov: 150, range: 80, hz: 20 },
];

const LIDARS = [
  { id: "lidar-front", label: "Roof solid-state", fov: 120, range: 250, hz: 20 },
];

const THERMAL = [
  { id: "fir-front", label: "FIR LWIR front", fov: 32, range: 200, hz: 9 },
];

const MICS = [
  { id: "mic-array", label: "Audio array (8-mic)", hz: 16_000 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % 1_000_000) / 1_000_000;
  };
}

function bookingHashSeed(bookingId: string): number {
  let h = 2166136261;
  for (let i = 0; i < bookingId.length; i++) {
    h ^= bookingId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1_000) / 1_000;
}

export function buildSyntheticFrame(opts: BuildOpts): LiveTelemetryFrame {
  const { bookingId, startedAt, index, autonomyEnabled } = opts;
  const seed = bookingHashSeed(bookingId);
  const rng = mulberry32(seed + index);
  const t = (Date.now() - startedAt) / 1000;
  const phase = t / 90; // 90s loop

  // ------ Driving phase: glide-out -> cruise -> decel -> park ------
  const speedKph =
    phase < 0.25
      ? 12 + 8 * phase * 4 + rng() * 1.4
      : phase < 0.5
        ? 62 + Math.sin(t / 3) * 4 + rng() * 1.1
        : phase < 0.75
          ? Math.max(0, 62 - 60 * (phase - 0.5) * 4) + rng() * 0.8
          : 4 + Math.sin(t / 2) * 1.5 + rng() * 0.4;
  const headingDeg = (180 + Math.sin(t / 6) * 35 + index * 0.4) % 360;

  // ------ Powertrain ------
  const speedMps = speedKph / 3.6;
  const ax = phase < 0.25 ? 0.6 + rng() * 0.2 : phase < 0.5 ? 0.05 + rng() * 0.1 - 0.05 : phase < 0.75 ? -1.4 - rng() * 0.4 : -0.3 + rng() * 0.2;
  const motorTorque = ax * 600;
  const motorRpm = (speedMps / 0.32) * 60 / (2 * Math.PI); // wheel-rad ~0.32 m
  const inverterCurrent = motorTorque * 0.6 + rng() * 5;
  const hvBus = 380 + Math.sin(t / 11) * 6 + rng() * 1.2;

  // 96-cell pack: voltage 3.4..4.05 V with Gaussian noise around the mean,
  // one cell shows a tiny imbalance to make the heat-map readable.
  const cellMeanMv = 3_650 + Math.sin(t / 24) * 18 - speedKph * 0.3;
  const hvCellsMv: number[] = [];
  const hvCellsTempC: number[] = [];
  for (let i = 0; i < 96; i++) {
    const drift = (i % 17 === 7 ? -38 : 0) + Math.sin((i + t) / 6) * 4 + (rng() - 0.5) * 8;
    hvCellsMv.push(Math.round(cellMeanMv + drift));
    hvCellsTempC.push(round1(28 + Math.sin((i + t) / 7) * 2 + rng() * 0.6 + speedKph * 0.05));
  }

  const brakePadFront = clamp(78 - index * 0.0008 - (phase > 0.5 ? phase * 0.6 : 0), 32, 100);
  const hvSoc = clamp(64 - index * 0.004 - speedKph * 0.0007, 18, 100);
  const coolantBattery = clamp(28 + Math.sin(t / 12) * 1.2 + speedKph * 0.05, 18, 50);
  const coolantMotor = clamp(58 + Math.sin(t / 9) * 4 + speedKph * 0.18, 40, 105);
  const coolantInverter = clamp(46 + Math.sin(t / 9.5) * 3 + speedKph * 0.12, 35, 90);
  const coolantTempC = round1((coolantMotor + coolantInverter) / 2);

  // ------ Wheels ------
  const wheelRpm = (speedMps / 0.32) * 60 / (2 * Math.PI);
  const wheelJitter = (s: number): number => round1(wheelRpm + Math.sin(t * 1.4 + s) * 1.6 + rng() * 0.6);
  const tpms = (base: number): number => Math.round(base + Math.sin(t / 4 + base) * 1.4 + rng() * 0.4);

  // ------ Sensors ------
  const sensorJitter = (rate: number): number => round1(rate + (rng() - 0.5) * 0.6);
  const sensorStatus = (i: number): "ok" | "watch" | "alert" => {
    // The 5th camera reports "watch" once during the cruise window — a
    // recoverable jitter to make the dashboard worth looking at.
    if (i === 4 && phase > 0.45 && phase < 0.55) return "watch";
    return "ok";
  };

  const cameras = CAMERAS.map((c, i) => ({
    id: c.id,
    label: c.label,
    status: sensorStatus(i),
    hz: sensorJitter(c.hz),
    fovDeg: c.fov,
    tempC: round1(38 + rng() * 2),
  }));
  const radars = RADARS.map((r) => ({
    id: r.id,
    label: r.label,
    status: "ok" as const,
    hz: sensorJitter(r.hz),
    returns: Math.round(220 + rng() * 60 + speedKph * 0.6),
    fovDeg: r.fov,
    rangeM: r.range,
  }));
  const lidars = LIDARS.map((l) => ({
    id: l.id,
    label: l.label,
    status: "ok" as const,
    hz: sensorJitter(l.hz),
    returns: Math.round(180_000 + rng() * 12_000),
    fovDeg: l.fov,
    rangeM: l.range,
    tempC: round1(42 + rng() * 1.5),
  }));
  const thermal = THERMAL.map((th) => ({
    id: th.id,
    label: th.label,
    status: "ok" as const,
    hz: sensorJitter(th.hz),
    fovDeg: th.fov,
    rangeM: th.range,
  }));
  const microphones = MICS.map((m) => ({
    id: m.id,
    label: m.label,
    status: "ok" as const,
    hz: m.hz,
  }));

  // ------ GNSS / IMU ------
  const rtkAge = 1.4 + rng() * 0.8;
  const gnss = {
    fix: rtkAge < 2.5 ? ("rtk-fixed" as const) : ("rtk-float" as const),
    satellites: 32 + Math.floor(rng() * 4),
    hdop: round1(0.7 + rng() * 0.2),
    pdop: round1(1.1 + rng() * 0.2),
    constellations: {
      gps: 11 + Math.floor(rng() * 2),
      glonass: 7 + Math.floor(rng() * 2),
      galileo: 9 + Math.floor(rng() * 2),
      beidou: 6 + Math.floor(rng() * 2),
      navic: 3,
    },
    rtkAgeS: round1(rtkAge),
    posAccuracyM: round3(0.018 + rng() * 0.012),
    speedAccuracyMps: round3(0.04 + rng() * 0.02),
  };
  const imu = {
    accel: {
      x: round3(ax + (rng() - 0.5) * 0.05),
      y: round3(Math.sin(t / 5) * 0.6 + (rng() - 0.5) * 0.05),
      z: round3(9.81 + (rng() - 0.5) * 0.03),
    },
    gyro: {
      x: round3((rng() - 0.5) * 0.005),
      y: round3((rng() - 0.5) * 0.005),
      z: round3(Math.sin(t / 6) * 0.04 + (rng() - 0.5) * 0.002),
    },
    magneto: { x: round3(28.4), y: round3(-1.1), z: round3(42.2) },
    tempC: round1(36 + rng() * 1.5),
    biasInstabilityDegHr: 0.05,
  };

  // ------ Compute ------
  const compute = {
    primary: {
      soc: "Tesla HW4 / FSD Computer",
      cpuPct: round1(48 + Math.sin(t / 4) * 6 + rng() * 2),
      gpuPct: round1(72 + Math.sin(t / 3.5) * 8 + rng() * 3),
      npuPct: round1(81 + Math.sin(t / 3) * 4 + rng() * 2),
      ramPct: round1(63 + rng() * 1.5),
      tempC: round1(56 + speedKph * 0.05 + rng() * 1.2),
      powerW: round1(180 + Math.sin(t / 4) * 20 + rng() * 4),
    },
    lockstep: {
      soc: "Infineon AURIX TC4x",
      cpuPct: round1(28 + rng() * 3),
      diffPpm: Math.round(rng() * 4),
      tempC: round1(48 + rng() * 1),
    },
    hsmHeartbeatOk: true,
  };

  // ------ Network ------
  const network = {
    rsrpDbm: Math.round(-86 - rng() * 6),
    rsrqDb: Math.round(-9 - rng() * 2),
    sinrDb: Math.round(18 - rng() * 4),
    mecRttMs: round1(12 + rng() * 6 + (phase > 0.5 ? 4 : 0)),
    wifiRssiDbm: Math.round(-58 - rng() * 4),
    hdMapVersion: "veh-na-2026.04.W17.r3",
    hdMapSyncedAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    hdMapDeltasPending: Math.floor(rng() * 4),
  };

  // ------ V2X ------
  const v2x = {
    bsmRxPerSec: round1(8 + rng() * 4 + (phase > 0.25 && phase < 0.75 ? 6 : 0)),
    camRxPerSec: round1(2 + rng() * 1.5),
    spatRxPerSec: round1(0.9 + rng() * 0.4),
    mapRxPerSec: round1(0.3 + rng() * 0.1),
    denmRxPerSec: round1(rng() * 0.1),
    rsaRxPerSec: round1(rng() * 0.05),
    latestKind: "BSM" as const,
    latestSummary: `BSM tx=ego-WDD3J4HB1JF000123 rx≤200m neighbours=${Math.round(4 + rng() * 6)}`,
    neighbours: Math.round(4 + rng() * 8),
  };

  // ------ Perception / planner / control ------
  const perception = {
    detections: {
      vehicles: Math.round(4 + rng() * 5 + speedKph * 0.04),
      pedestrians: phase > 0.7 ? Math.round(2 + rng() * 4) : Math.round(rng() * 2),
      cyclists: Math.round(rng() * 2),
      twoWheelers: Math.round(1 + rng() * 2),
      animals: 0,
      signs: Math.round(2 + rng() * 4),
      cones: phase > 0.5 ? Math.round(rng() * 3) : 0,
    },
    tracks: [
      {
        id: "trk-001",
        cls: "vehicle" as const,
        distanceM: round1(18 + Math.sin(t / 3) * 2),
        bearingDeg: round1(2 + rng() * 0.8),
        vMps: round1(speedMps * 0.94 + rng() * 0.4),
        predictionHorizonS: 4,
        risk: round3(0.08 + rng() * 0.02),
      },
      {
        id: "trk-002",
        cls: "pedestrian" as const,
        distanceM: round1(28 - phase * 4 + rng() * 0.6),
        bearingDeg: round1(-9 + rng() * 0.4),
        vMps: round1(1.2 + rng() * 0.3),
        predictionHorizonS: 3,
        risk: phase > 0.7 ? round3(0.42 + rng() * 0.06) : round3(0.05 + rng() * 0.02),
      },
      {
        id: "trk-003",
        cls: "cyclist" as const,
        distanceM: round1(42 + Math.sin(t / 4) * 6),
        bearingDeg: round1(7 + rng() * 0.4),
        vMps: round1(4.1 + rng() * 0.3),
        predictionHorizonS: 4,
        risk: round3(0.11 + rng() * 0.02),
      },
    ],
    bevOccupancy: {
      occupiedRatio: round3(0.18 + Math.sin(t / 5) * 0.04 + rng() * 0.01),
      peakUncertainty: round3(0.21 + rng() * 0.04),
    },
    laneGraph: { currentLane: 1, totalLanes: 3, confidence: round3(0.96 + rng() * 0.02) },
    trafficLight:
      phase < 0.15
        ? { state: "green" as const, ttcS: 18, confidence: 0.99 }
        : phase < 0.25
          ? { state: "yellow" as const, ttcS: 3, confidence: 0.97 }
          : phase < 0.35
            ? { state: "red" as const, ttcS: 22, confidence: 0.99 }
            : { state: "green" as const, ttcS: 28, confidence: 0.99 },
    freeSpaceRatio: round3(0.78 - speedKph * 0.001),
    drivableAreaMiou: round3(0.94 + rng() * 0.01),
  };

  const planner = {
    horizonS: 8,
    sampledTrajectories: 64,
    selectedAlt: 17,
    softViolations: 0,
    hardViolations: 0,
    cvar95: round3(0.06 + rng() * 0.01),
    behavior:
      phase < 0.25
        ? ("cruise" as const)
        : phase < 0.4
          ? ("follow" as const)
          : phase < 0.55
            ? ("lane-change" as const)
            : phase < 0.75
              ? ("yield" as const)
              : ("park" as const),
  };

  const control = {
    throttle: round3(clamp(0.32 + Math.sin(t / 4) * 0.15 + rng() * 0.04, 0, 1)),
    brake: round3(clamp(phase > 0.5 && phase < 0.75 ? 0.28 + rng() * 0.06 : rng() * 0.02, 0, 1)),
    steering: round3(Math.sin(t / 7) * 0.04 + rng() * 0.01),
    gear: speedKph > 1 ? 1 : 0,
  };

  // ------ Safety ------
  const safety = {
    oddCompliant: true,
    oodMahalanobis: round3(0.34 + Math.sin(t / 11) * 0.05 + rng() * 0.02),
    oodThreshold: 0.92,
    takeoverRung: 0,
    ttcSec: round1(speedKph > 1 ? 9 - phase * 4 + rng() * 0.4 : 99),
    fttiMs: 220,
    capabilityBudget: round3(clamp(0.92 - phase * 0.05 + rng() * 0.01, 0.5, 1)),
    mrmActive: false,
  };

  // ------ Cabin ------
  const cabin = {
    cabinTempC: round1(22 + Math.sin(t / 30) * 0.6),
    cabinHumidityPct: round1(45 + Math.sin(t / 25) * 4),
    co2Ppm: Math.round(640 + Math.sin(t / 18) * 60),
    pm25Ugm3: round1(11 + rng() * 2),
    driverAttention: {
      gazeOnRoad: round3(0.94 + rng() * 0.04),
      eyesClosed: false,
      handsOnWheel: true,
      seatBelt: true,
    },
    occupants: 1,
  };

  // ------ Environment ------
  const environment = {
    weather: "clear" as const,
    visibilityM: 10_000,
    ambientTempC: round1(28 + Math.sin(t / 30) * 0.4),
    ambientHumidityPct: round1(63 + rng() * 1.5),
    windKph: round1(7 + rng() * 1),
    pavement: "asphalt-dry" as const,
    timeOfDay: "day" as const,
  };

  const software = {
    perceptionVersion: "perceptron-v9.4.2-bev-occ-tx",
    plannerVersion: "wayve-mp-2026.05",
    controlVersion: "mpc-asild-1.7",
    osVersion: "vsbs-os 2026.05.r2",
    calibrationVersion: "extr-cal 2026.04.W14",
    shadowModeUploadAt: new Date(Date.now() - 1000 * 60 * 23).toISOString(),
  };

  return {
    ts: new Date().toISOString(),
    origin: autonomyEnabled ? "real" : "sim",
    simSource: "deterministic-fallback",
    speedKph: round1(speedKph),
    headingDeg: round1(headingDeg),
    brakePadFrontPercent: round1(brakePadFront),
    hvSocPercent: round1(hvSoc),
    coolantTempC: round1(coolantTempC),
    tpms: {
      fl: tpms(230),
      fr: tpms(232),
      rl: tpms(228),
      rr: tpms(231),
    },
    gps: { lat: 12.9716 + Math.sin(t / 60) * 0.001, lng: 77.5946 + Math.cos(t / 60) * 0.001 },
    accel: imu.accel,
    nearbyVehicles: perception.detections.vehicles,
    nearbyPedestrians: perception.detections.pedestrians,
    trafficLightState: perception.trafficLight.state,
    sensors: { cameras, radars, lidars, ultrasonic: [], thermal, microphones },
    gnss,
    imu,
    wheels: {
      rpm: { fl: wheelJitter(0), fr: wheelJitter(1), rl: wheelJitter(2), rr: wheelJitter(3) },
      hubTempC: {
        fl: round1(48 + speedKph * 0.18 + rng() * 0.4),
        fr: round1(50 + speedKph * 0.18 + rng() * 0.4),
        rl: round1(46 + speedKph * 0.16 + rng() * 0.4),
        rr: round1(45 + speedKph * 0.16 + rng() * 0.4),
      },
      tpmsKpa: { fl: tpms(230), fr: tpms(232), rl: tpms(228), rr: tpms(231) },
      tpmsTempC: {
        fl: round1(31 + speedKph * 0.06),
        fr: round1(31 + speedKph * 0.06),
        rl: round1(30 + speedKph * 0.05),
        rr: round1(30 + speedKph * 0.05),
      },
    },
    chassis: {
      steeringAngleDeg: round1(Math.sin(t / 7) * 4 + (rng() - 0.5) * 0.4),
      steeringTorqueNm: round1(Math.sin(t / 6) * 0.8 + (rng() - 0.5) * 0.05),
      brakePressureBar: { front: round1(control.brake! * 110), rear: round1(control.brake! * 70) },
      rideHeightMm: { fl: 152, fr: 152, rl: 154, rr: 154 },
      frictionCoef: round3(0.85 + rng() * 0.02),
    },
    powertrain: {
      motorFront: {
        torqueNm: round1(motorTorque * 0.45),
        tempStatorC: round1(64 + speedKph * 0.18 + rng() * 0.6),
        tempRotorC: round1(72 + speedKph * 0.2 + rng() * 0.6),
        rpm: round1(motorRpm * 8.6),
      },
      motorRear: {
        torqueNm: round1(motorTorque * 0.55),
        tempStatorC: round1(66 + speedKph * 0.18 + rng() * 0.6),
        tempRotorC: round1(74 + speedKph * 0.2 + rng() * 0.6),
        rpm: round1(motorRpm * 8.6),
      },
      inverterTempC: round1(46 + speedKph * 0.12 + rng() * 0.6),
      inverterCurrentA: round1(inverterCurrent),
      hvBusV: round1(hvBus),
      hvBusA: round1(inverterCurrent * 0.8),
      aux12vV: round1(13.4 + rng() * 0.06),
      hvCellsMv,
      hvCellsTempC,
      hvIsolationKohm: Math.round(820 + rng() * 30),
      hvSocPercent: round1(hvSoc),
      hvSohPercent: round1(96.2 + rng() * 0.2),
      hvSopKw: round1(180 + rng() * 4),
      coolantMotorC: round1(coolantMotor),
      coolantBatteryC: round1(coolantBattery),
      coolantInverterC: round1(coolantInverter),
      coolantTempC: round1(coolantTempC),
    },
    perception,
    planner,
    control,
    compute,
    network,
    v2x,
    safety,
    cabin,
    environment,
    software,
    throttle: control.throttle,
    brake: control.brake,
    steering: control.steering,
    gear: control.gear,
  };
}
