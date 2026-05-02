#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""
Hyper-realistic chaos-scenario driver for the autonomy dashboard.

Runs the headline VSBS demo end-to-end against the live API without
requiring CARLA or a GPU. Produces a 5-minute scripted scenario:

    00:00  Glide-out from home, ego under autopilot
    00:30  Light traffic on the secondary road
    00:55  First red light (with multi-vehicle approach + SPaT detected)
    01:35  Cruise on the boulevard, neighbour count rises
    02:05  Pedestrian dart-out from kerb at 14 m -> emergency brake
    02:30  PHM thresholds drop (drive belt fault progression)
    03:00  Capability budget falls; OOD score climbs
    03:35  R157 takeover ladder rung 2; MRM armed
    04:10  Service centre approach, Mercedes-Bosch IPP handover
    04:50  Returned, booking complete

Frames are pushed at 10 Hz to /v1/autonomy/{bookingId}/telemetry/ingest
with the full L5 schema. Discrete events (red light, dart-out, fault,
takeover, V2X DENM, etc.) hit /v1/autonomy/{bookingId}/events/ingest as
they fire, stamped with the right category and severity.

Use this when CARLA can't run on the box. The wire-shape is identical to
what the live CARLA bridge produces, so the dashboard sees no difference.

Run:
    python -m vsbs_carla.scripts.run_chaos_demo --booking demo
"""

from __future__ import annotations

import argparse
import math
import random
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

DEFAULT_BASE = "http://localhost:8787"
TICK_HZ = 10
TICK_DT = 1.0 / TICK_HZ


@dataclass
class Phase:
    name: str
    start_s: float
    end_s: float


PHASES: List[Phase] = [
    Phase("home-glide-out", 0, 30),
    Phase("light-traffic", 30, 55),
    Phase("red-light", 55, 95),
    Phase("boulevard-cruise", 95, 125),
    Phase("pedestrian-dart-out", 125, 150),
    Phase("fault-progression", 150, 180),
    Phase("ood-rising", 180, 215),
    Phase("r157-takeover-rung-2", 215, 250),
    Phase("service-centre-approach", 250, 290),
    Phase("returned", 290, 330),
]


def now_iso() -> str:
    # Zod's z.string().datetime() expects the trailing 'Z' form, not the
    # +00:00 offset that datetime.isoformat() emits.
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def round1(v: float) -> float:
    return round(v, 1)


def round3(v: float) -> float:
    return round(v, 3)


def in_phase(t: float, name: str) -> bool:
    for p in PHASES:
        if p.name == name:
            return p.start_s <= t < p.end_s
    return False


def phase_progress(t: float, name: str) -> float:
    for p in PHASES:
        if p.name == name:
            if t < p.start_s or t >= p.end_s:
                return 0.0
            return (t - p.start_s) / (p.end_s - p.start_s)
    return 0.0


def speed_for(t: float) -> float:
    """Smooth speed profile through every phase."""
    if t < 30:
        return 12 + (t / 30) * 30  # ramp 12 -> 42 kph
    if t < 55:
        return 42 + math.sin(t / 4) * 1.5
    if t < 70:
        return max(0, 42 - (t - 55) * 3.0)  # decel into red light
    if t < 90:
        return max(0, 0 + math.sin(t / 4) * 0.4)  # stopped
    if t < 95:
        return (t - 90) * 9.0  # 0 -> 45
    if t < 125:
        return 50 + math.sin(t / 3) * 5
    if t < 130:
        return max(0, 50 - (t - 125) * 9.5)  # emergency brake at dart-out
    if t < 150:
        return 5 + math.sin(t / 2) * 1.5
    if t < 180:
        return 18 + math.sin(t / 3) * 3
    if t < 215:
        return 22 + math.sin(t / 4) * 3 - (t - 180) * 0.05
    if t < 250:
        return 12 + math.sin(t / 3) * 2  # MRM lateral creep
    if t < 290:
        return 20 + math.sin(t / 3) * 2 - max(0, t - 280) * 1.5
    return 1.5 + math.sin(t / 2) * 0.5


def build_frame(t: float, booking_id: str, rng: random.Random) -> Dict[str, Any]:
    speed_kph = speed_for(t)
    speed_mps = speed_kph / 3.6

    # Driving inputs
    if in_phase(t, "pedestrian-dart-out") and t < 132:
        brake = clamp(0.85 + rng.random() * 0.05, 0, 1)
        throttle = 0.0
    elif in_phase(t, "red-light") and t < 70:
        brake = clamp(0.4 + rng.random() * 0.05, 0, 1)
        throttle = 0.0
    elif in_phase(t, "r157-takeover-rung-2"):
        brake = 0.05
        throttle = 0.18
    else:
        brake = clamp(rng.random() * 0.05, 0, 1)
        throttle = clamp(0.32 + math.sin(t / 4) * 0.1 + rng.random() * 0.04, 0, 1)
    steering = round3(math.sin(t / 7) * 0.04 + rng.random() * 0.01)

    # Powertrain
    motor_torque = (throttle - brake) * 600
    motor_rpm = (speed_mps / 0.32) * 60 / (2 * math.pi)
    inverter_current = motor_torque * 0.6 + rng.random() * 5
    hv_bus = 380 + math.sin(t / 11) * 6 + rng.random() * 1.2

    # 96 cells, with one bad cell visible during fault-progression
    cell_mean_mv = 3650 + math.sin(t / 24) * 18 - speed_kph * 0.3
    if t > 150:
        cell_mean_mv -= (t - 150) * 0.4  # gradual sag
    hv_cells_mv: List[int] = []
    hv_cells_temp_c: List[float] = []
    for i in range(96):
        bad = -90 if (i % 17 == 7 and t > 150) else (-38 if i % 17 == 7 else 0)
        drift = bad + math.sin((i + t) / 6) * 4 + (rng.random() - 0.5) * 8
        hv_cells_mv.append(int(round(cell_mean_mv + drift)))
        hv_cells_temp_c.append(round1(28 + math.sin((i + t) / 7) * 2 + rng.random() * 0.6 + speed_kph * 0.05))

    brake_pad_front = clamp(78 - t * 0.005 - (1.0 if t > 150 else 0) * (t - 150) * 0.05, 32, 100)
    hv_soc = clamp(64 - t * 0.02 - speed_kph * 0.001, 18, 100)
    coolant_motor = clamp(58 + math.sin(t / 9) * 4 + speed_kph * 0.18, 40, 105)
    coolant_battery = clamp(28 + math.sin(t / 12) * 1.2 + speed_kph * 0.05, 18, 50)
    coolant_inverter = clamp(46 + math.sin(t / 9.5) * 3 + speed_kph * 0.12, 35, 90)

    wheel_rpm = (speed_mps / 0.32) * 60 / (2 * math.pi)

    # Sensor census — 8 cameras, 4 radars, 1 LiDAR, 1 thermal, 1 mic array
    cameras = [
        {"id": f"cam-{label}", "label": pretty, "status": "ok", "hz": round1(36 + rng.uniform(-0.5, 0.5)), "fovDeg": fov, "tempC": round1(38 + rng.random() * 2)}
        for label, pretty, fov in [
            ("front-narrow", "Front telephoto", 35),
            ("front-main", "Front main", 50),
            ("front-fish", "Front fish", 198),
            ("side-l-fwd", "L pillar fwd", 90),
            ("side-r-fwd", "R pillar fwd", 90),
            ("side-l-rev", "L pillar rev", 90),
            ("side-r-rev", "R pillar rev", 90),
            ("rear-main", "Rear main", 60),
        ]
    ]
    radars = [
        {"id": "rad-front-lr", "label": "Front LR 4D", "status": "ok", "hz": round1(20 + rng.uniform(-0.3, 0.3)), "returns": int(220 + rng.random() * 80 + speed_kph * 0.6), "fovDeg": 120, "rangeM": 300},
        {"id": "rad-front-sr", "label": "Front SR 4D", "status": "ok", "hz": round1(20), "returns": int(180 + rng.random() * 60), "fovDeg": 150, "rangeM": 80},
        {"id": "rad-rear-l", "label": "Rear-left", "status": "ok", "hz": round1(20), "returns": int(170 + rng.random() * 50), "fovDeg": 150, "rangeM": 80},
        {"id": "rad-rear-r", "label": "Rear-right", "status": "ok", "hz": round1(20), "returns": int(170 + rng.random() * 50), "fovDeg": 150, "rangeM": 80},
    ]
    lidars = [{"id": "lidar-front", "label": "Roof solid-state", "status": "ok", "hz": round1(20), "returns": int(180_000 + rng.random() * 14_000), "fovDeg": 120, "rangeM": 250, "tempC": round1(42 + rng.random() * 1.5)}]
    thermal = [{"id": "fir-front", "label": "FIR LWIR front", "status": "ok", "hz": round1(9), "fovDeg": 32, "rangeM": 200}]
    # Audio sample rate is 16 kHz; the schema reports the array publish rate.
    microphones = [{"id": "mic-array", "label": "Audio array (8-mic, 16 kHz)", "status": "ok", "hz": 60}]

    # Perception detections + tracks
    base_vehicles = 2 if t < 30 else 5 if t < 95 else 6 if t < 125 else 8 if t < 180 else 4
    pedestrians = 0 if t < 60 else 2 if t < 120 else (4 if 125 <= t <= 132 else 1)
    cyclists = 1 if 30 <= t <= 200 else 0
    detections = {
        "vehicles": int(base_vehicles + rng.random() * 2),
        "pedestrians": pedestrians,
        "cyclists": cyclists,
        "twoWheelers": int(rng.random() * 2),
        "animals": 0,
        "signs": int(2 + rng.random() * 3),
        "cones": int(2 if 200 <= t <= 260 else 0),
    }

    tracks: List[Dict[str, Any]] = []
    # Lead vehicle
    tracks.append({
        "id": "trk-lead",
        "cls": "vehicle",
        "distanceM": round1(18 + math.sin(t / 3) * 3),
        "bearingDeg": round1(2 + rng.random() * 0.8),
        "vMps": round1(speed_mps * 0.94),
        "predictionHorizonS": 4,
        "risk": round3(0.08 + rng.random() * 0.02),
    })
    # Pedestrian dart-out — distance closes from 14 -> 3 m
    if 124 <= t <= 132:
        d = max(2.5, 14 - (t - 124) * 1.4)
        risk = clamp(0.4 + (14 - d) / 14 * 0.55, 0, 1)
        tracks.append({
            "id": "trk-ped-dart",
            "cls": "pedestrian",
            "distanceM": round1(d),
            "bearingDeg": round1(-12 + rng.random() * 0.5),
            "vMps": 1.6,
            "predictionHorizonS": 2,
            "risk": round3(risk),
        })
    # Cyclist
    if 30 <= t <= 200:
        tracks.append({
            "id": "trk-cyclist",
            "cls": "cyclist",
            "distanceM": round1(36 + math.sin(t / 5) * 6),
            "bearingDeg": round1(7 + rng.random() * 0.5),
            "vMps": round1(4.1 + rng.random() * 0.3),
            "predictionHorizonS": 4,
            "risk": round3(0.11 + rng.random() * 0.02),
        })

    # Traffic light state
    if 55 <= t < 65:
        tl = {"state": "yellow", "ttcS": max(1, round1(65 - t)), "confidence": 0.97}
    elif 65 <= t < 90:
        tl = {"state": "red", "ttcS": round1(90 - t), "confidence": 0.99}
    elif 90 <= t < 95:
        tl = {"state": "green", "ttcS": 22, "confidence": 0.99}
    else:
        tl = {"state": "green", "ttcS": 28, "confidence": 0.99}

    # Planner behaviour
    if 55 <= t < 90:
        behavior = "stop"
    elif 124 <= t <= 132:
        behavior = "minimal-risk-manoeuvre"
    elif 215 <= t < 250:
        behavior = "minimal-risk-manoeuvre"
    elif t < 95:
        behavior = "cruise"
    elif t < 200:
        behavior = "follow"
    elif t < 290:
        behavior = "yield"
    else:
        behavior = "park"

    # OOD + capability budget
    ood = clamp(0.34 + max(0, (t - 180) / 35) * 0.45 + rng.random() * 0.02, 0, 1.2)
    cap_budget = clamp(0.92 - max(0, (t - 150) / 100) * 0.6, 0.2, 1)

    # R157 takeover rung
    if 215 <= t < 250:
        rung = 2
    elif 124 <= t <= 132:
        rung = 1
    else:
        rung = 0
    mrm_active = behavior == "minimal-risk-manoeuvre"

    frame: Dict[str, Any] = {
        "ts": now_iso(),
        "origin": "sim",
        "simSource": "chaos-scenario",
        "speedKph": round1(speed_kph),
        "headingDeg": round1((180 + math.sin(t / 6) * 35 + t * 0.4) % 360),
        "brakePadFrontPercent": round1(brake_pad_front),
        "hvSocPercent": round1(hv_soc),
        "coolantTempC": round1((coolant_motor + coolant_inverter) / 2),
        "tpms": {
            "fl": int(230 + math.sin(t / 4) * 1.4),
            "fr": int(232 + math.cos(t / 4 + 0.2) * 1.3),
            "rl": int(228 + math.sin(t / 3.7) * 1.0),
            "rr": int(231 + math.cos(t / 3.5) * 1.1),
        },
        "gps": {"lat": 12.9716 + math.sin(t / 60) * 0.001, "lng": 77.5946 + math.cos(t / 60) * 0.001},
        "accel": {"x": round3((throttle - brake) * 1.4), "y": round3(math.sin(t / 5) * 0.6), "z": round3(9.81)},
        "nearbyVehicles": detections["vehicles"],
        "nearbyPedestrians": detections["pedestrians"],
        "trafficLightState": tl["state"],
        "sensors": {
            "cameras": cameras,
            "radars": radars,
            "lidars": lidars,
            "ultrasonic": [],
            "thermal": thermal,
            "microphones": microphones,
        },
        "gnss": {
            "fix": "rtk-fixed",
            "satellites": 32 + int(rng.random() * 4),
            "hdop": round1(0.7 + rng.random() * 0.2),
            "pdop": round1(1.1 + rng.random() * 0.2),
            "constellations": {
                "gps": 12, "glonass": 8, "galileo": 10, "beidou": 7, "navic": 3,
            },
            "rtkAgeS": round1(1.4 + rng.random() * 0.8),
            "posAccuracyM": round3(0.018 + rng.random() * 0.012),
            "speedAccuracyMps": round3(0.04 + rng.random() * 0.02),
        },
        "imu": {
            "accel": {"x": round3((throttle - brake) * 1.4), "y": round3(math.sin(t / 5) * 0.6), "z": round3(9.81)},
            "gyro": {"x": round3((rng.random() - 0.5) * 0.005), "y": round3((rng.random() - 0.5) * 0.005), "z": round3(math.sin(t / 6) * 0.04)},
            "magneto": {"x": 28.4, "y": -1.1, "z": 42.2},
            "tempC": round1(36 + rng.random() * 1.5),
            "biasInstabilityDegHr": 0.05,
        },
        "wheels": {
            "rpm": {
                "fl": round1(wheel_rpm + math.sin(t * 1.4) * 1.6),
                "fr": round1(wheel_rpm + math.sin(t * 1.4 + 1) * 1.6),
                "rl": round1(wheel_rpm + math.sin(t * 1.4 + 2) * 1.6),
                "rr": round1(wheel_rpm + math.sin(t * 1.4 + 3) * 1.6),
            },
            "hubTempC": {
                "fl": round1(48 + speed_kph * 0.18),
                "fr": round1(50 + speed_kph * 0.18),
                "rl": round1(46 + speed_kph * 0.16),
                "rr": round1(45 + speed_kph * 0.16),
            },
            "tpmsKpa": {"fl": int(230), "fr": int(232), "rl": int(228), "rr": int(231)},
            "tpmsTempC": {
                "fl": round1(31 + speed_kph * 0.06),
                "fr": round1(31 + speed_kph * 0.06),
                "rl": round1(30 + speed_kph * 0.05),
                "rr": round1(30 + speed_kph * 0.05),
            },
        },
        "chassis": {
            "steeringAngleDeg": round1(math.sin(t / 7) * 4),
            "steeringTorqueNm": round1(math.sin(t / 6) * 0.8),
            "brakePressureBar": {"front": round1(brake * 110), "rear": round1(brake * 70)},
            "rideHeightMm": {"fl": 152, "fr": 152, "rl": 154, "rr": 154},
            "frictionCoef": round3(0.85 + rng.random() * 0.02),
        },
        "powertrain": {
            "motorFront": {"torqueNm": round1(motor_torque * 0.45), "tempStatorC": round1(64 + speed_kph * 0.18), "tempRotorC": round1(72 + speed_kph * 0.2), "rpm": round1(motor_rpm * 8.6)},
            "motorRear": {"torqueNm": round1(motor_torque * 0.55), "tempStatorC": round1(66 + speed_kph * 0.18), "tempRotorC": round1(74 + speed_kph * 0.2), "rpm": round1(motor_rpm * 8.6)},
            "inverterTempC": round1(46 + speed_kph * 0.12),
            "inverterCurrentA": round1(inverter_current),
            "hvBusV": round1(hv_bus),
            "hvBusA": round1(inverter_current * 0.8),
            "aux12vV": round1(13.4 + rng.random() * 0.06),
            "hvCellsMv": hv_cells_mv,
            "hvCellsTempC": hv_cells_temp_c,
            "hvIsolationKohm": int(820 + rng.random() * 30),
            "hvSocPercent": round1(hv_soc),
            "hvSohPercent": round1(96.2 + rng.random() * 0.2),
            "hvSopKw": round1(180 + rng.random() * 4),
            "coolantMotorC": round1(coolant_motor),
            "coolantBatteryC": round1(coolant_battery),
            "coolantInverterC": round1(coolant_inverter),
            "coolantTempC": round1((coolant_motor + coolant_inverter) / 2),
        },
        "perception": {
            "detections": detections,
            "tracks": tracks,
            "bevOccupancy": {"occupiedRatio": round3(0.18 + math.sin(t / 5) * 0.04), "peakUncertainty": round3(0.21 + rng.random() * 0.04)},
            "laneGraph": {"currentLane": 1, "totalLanes": 3, "confidence": round3(0.96 + rng.random() * 0.02)},
            "trafficLight": tl,
            "freeSpaceRatio": round3(0.78 - speed_kph * 0.001),
            "drivableAreaMiou": round3(0.94 + rng.random() * 0.01),
        },
        "planner": {
            "horizonS": 8,
            "sampledTrajectories": 64,
            "selectedAlt": int(rng.random() * 30),
            "softViolations": 1 if mrm_active else 0,
            "hardViolations": 0,
            "cvar95": round3(0.06 + (1 if mrm_active else 0) * 0.04),
            "behavior": behavior,
        },
        "control": {
            "throttle": round3(throttle),
            "brake": round3(brake),
            "steering": steering,
            "gear": 1 if speed_kph > 1 else 0,
        },
        "compute": {
            "primary": {
                "soc": "Tesla HW4 / FSD Computer",
                "cpuPct": round1(48 + math.sin(t / 4) * 6),
                "gpuPct": round1(72 + math.sin(t / 3.5) * 8),
                "npuPct": round1(81 + math.sin(t / 3) * 4),
                "ramPct": round1(63),
                "tempC": round1(56 + speed_kph * 0.05),
                "powerW": round1(180 + math.sin(t / 4) * 20),
            },
            "lockstep": {"soc": "Infineon AURIX TC4x", "cpuPct": round1(28 + rng.random() * 3), "diffPpm": int(rng.random() * 4), "tempC": round1(48 + rng.random())},
            "hsmHeartbeatOk": True,
        },
        "network": {
            "rsrpDbm": int(-86 - rng.random() * 6),
            "rsrqDb": int(-9 - rng.random() * 2),
            "sinrDb": int(18 - rng.random() * 4),
            "mecRttMs": round1(12 + rng.random() * 6),
            "wifiRssiDbm": int(-58 - rng.random() * 4),
            "hdMapVersion": "veh-na-2026.04.W17.r3",
            "hdMapSyncedAt": "2026-04-30T18:14:00Z",
            "hdMapDeltasPending": int(rng.random() * 4),
        },
        "v2x": {
            "bsmRxPerSec": round1(8 + rng.random() * 4 + (6 if 30 <= t <= 200 else 0)),
            "camRxPerSec": round1(2 + rng.random() * 1.5),
            "spatRxPerSec": round1(0.9 + rng.random() * 0.4),
            "mapRxPerSec": round1(0.3 + rng.random() * 0.1),
            "denmRxPerSec": round1(rng.random() * 0.1) if t < 124 else round1(0.5 + rng.random() * 0.3),
            "rsaRxPerSec": round1(rng.random() * 0.05),
            "latestKind": "DENM" if 124 <= t <= 132 else "BSM",
            "latestSummary": (
                "DENM stationary-vehicle 80 m ahead lane 1 — local-RSU"
                if 124 <= t <= 132
                else f"BSM tx=ego rx≤200m neighbours={int(4 + rng.random() * 6)}"
            ),
            "neighbours": int(4 + rng.random() * 8),
        },
        "safety": {
            "oddCompliant": rung < 3,
            "oodMahalanobis": round3(ood),
            "oodThreshold": 0.92,
            "takeoverRung": rung,
            "ttcSec": round1(max(1, 9 - phase_progress(t, "fault-progression") * 4)),
            "fttiMs": 220,
            "capabilityBudget": round3(cap_budget),
            "mrmActive": mrm_active,
            **({"mrmKind": "lateral-creep-to-shoulder"} if mrm_active else {}),
        },
        "cabin": {
            "cabinTempC": round1(22 + math.sin(t / 30) * 0.6),
            "cabinHumidityPct": round1(45 + math.sin(t / 25) * 4),
            "co2Ppm": int(640 + math.sin(t / 18) * 60),
            "pm25Ugm3": round1(11 + rng.random() * 2),
            "driverAttention": {
                "gazeOnRoad": round3(0.94 + rng.random() * 0.04),
                "eyesClosed": False,
                "handsOnWheel": True,
                "seatBelt": True,
            },
            "occupants": 1,
        },
        "environment": {
            "weather": "clear",
            "visibilityM": 10000,
            "ambientTempC": round1(28),
            "ambientHumidityPct": round1(63),
            "windKph": round1(7 + rng.random()),
            "pavement": "asphalt-dry",
            "timeOfDay": "day",
        },
        "software": {
            "perceptionVersion": "perceptron-v9.4.2-bev-occ-tx",
            "plannerVersion": "wayve-mp-2026.05",
            "controlVersion": "mpc-asild-1.7",
            "osVersion": "vsbs-os 2026.05.r2",
            "calibrationVersion": "extr-cal 2026.04.W14",
            "shadowModeUploadAt": "2026-05-01T03:55:00Z",
        },
        "throttle": round3(throttle),
        "brake": round3(brake),
        "steering": steering,
        "gear": 1 if speed_kph > 1 else 0,
    }
    return frame


# Discrete events fired by the scenario at specific timestamps.
EVENT_SCHEDULE = [
    (0.5, "scenario", "info", "Scenario started", "Drive home -> service centre. Demo seed = chaos."),
    (5.0, "navigation", "info", "Route locked", "12.3 km · ETA 18 min · weights: time, energy, comfort"),
    (28.0, "perception", "info", "Lead vehicle acquired", "Track trk-lead, range 18.2 m, vx -1.4 m/s relative"),
    (45.0, "v2x", "info", "SPaT subscription armed", "PC5 sidelink: SPaT/MAP from RSU-J47 (Indiranagar 100ft Rd)"),
    (55.0, "perception", "watch", "Traffic light yellow", "TL ahead, ttc 6 s. Decel ramp scheduled."),
    (60.0, "driving", "info", "Behavior: STOP", "Yielding to TL. Brake pedal 35%, distance 8 m."),
    (90.0, "driving", "info", "Behavior: CRUISE", "Light cleared. Throttle ramp 0 -> 0.55."),
    (115.0, "v2x", "info", "Neighbours = 9", "PC5 BSM rate 13 Hz, all in same lane group."),
    (124.0, "safety", "alert", "Pedestrian dart-out", "Vulnerable road user trk-ped-dart at 14 m bearing -12°. Risk 0.45."),
    (124.5, "v2x", "alert", "DENM transmitted", "Type=stationary-vehicle, RSU broadcast 5G NR-V2X uplink."),
    (125.0, "safety", "critical", "Emergency brake engaged", "Front MPC override 0.85 brake. R157 rung 1."),
    (132.0, "safety", "info", "Pedestrian cleared", "Track trk-ped-dart left ROI. Brake released."),
    (150.0, "fault", "watch", "Drive-belt RUL drop", "Acoustic + vibration fusion: -34% RUL margin in 7 s."),
    (165.0, "fault", "alert", "PHM critical: drive-belt", "Severson knee-point distance < 80 cycles. Booking pre-empted."),
    (180.0, "safety", "watch", "OOD score rising", "Mahalanobis 0.61, threshold 0.92. SOTIF stack flagging margin."),
    (200.0, "perception", "info", "Construction zone", "3 cones detected at 32 m. Behaviour: lane-change."),
    (215.0, "safety", "critical", "R157 takeover rung 2", "Backup-driver attention probe + visual+audio handover request."),
    (218.0, "driving", "info", "MRM armed", "Minimal-Risk Manoeuvre: lateral creep to shoulder. ETA 22 s."),
    (250.0, "navigation", "info", "Approach corridor", "Service centre 480 m ahead. Mercedes-Bosch IPP geofence."),
    (260.0, "infra", "info", "Mercedes IPP handshake", "OEM-AVP adapter authenticated. Grant ttl 13 min."),
    (270.0, "scenario", "info", "AVP slot acquired", "Slot 4-A reserved. Vehicle handover at Sapphire Auto, Indiranagar."),
    (290.0, "scenario", "info", "Service complete", "Booking transitioned: SERVICED -> RETURN_LEG."),
    (320.0, "scenario", "info", "Returned home", "Booking closed. Owner key re-bound to ego."),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="VSBS chaos-scenario driver (no CARLA needed)")
    parser.add_argument("--booking", default="demo", help="Booking id used in the dashboard URL")
    parser.add_argument("--base", default=DEFAULT_BASE, help="VSBS API base URL")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--speed", type=float, default=1.0, help="Wall-clock speed multiplier (1.0 = real-time)")
    parser.add_argument("--loop", action="store_true", help="Restart the scenario when it ends")
    args = parser.parse_args()

    rng = random.Random(args.seed)
    base = args.base.rstrip("/")
    booking = args.booking

    stop = False

    def handle_sig(_signum: int, _frame: Any) -> None:
        nonlocal stop
        stop = True
        print("\n[chaos] stopping", flush=True)

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)

    last_event = -1.0
    last_phase: Optional[str] = None

    with httpx.Client(base_url=base, timeout=httpx.Timeout(2.0, connect=1.0)) as client:
        # Health probe
        try:
            r = client.get("/readyz")
            r.raise_for_status()
            print(f"[chaos] api ready at {base}: {r.json().get('status')}", flush=True)
        except Exception as e:
            print(f"[chaos] api at {base} is unreachable: {e}", file=sys.stderr)
            return 2

        # Sync events with the scenario clock
        scenario_start = time.monotonic()
        while not stop:
            t = (time.monotonic() - scenario_start) * args.speed
            if t > PHASES[-1].end_s:
                if args.loop:
                    scenario_start = time.monotonic()
                    last_event = -1.0
                    print("[chaos] looping", flush=True)
                    continue
                print(f"[chaos] scenario complete after {t:.1f}s", flush=True)
                break

            # Emit a phase marker on every transition so the recorder can
            # surface scenario.phase events into the live SSE stream.
            current_phase: Optional[str] = None
            for p in PHASES:
                if p.start_s <= t < p.end_s:
                    current_phase = p.name
                    break
            if current_phase is not None and current_phase != last_phase:
                last_phase = current_phase
                print(f">> phase: {current_phase}", flush=True)

            frame = build_frame(t, booking, rng)
            try:
                client.post(f"/v1/autonomy/{booking}/telemetry/ingest", json=frame)
            except Exception as e:
                print(f"[chaos] telemetry POST failed: {e}", file=sys.stderr)

            for ts, category, severity, title, detail in EVENT_SCHEDULE:
                if last_event < ts <= t:
                    payload: Dict[str, Any] = {
                        "ts": now_iso(),
                        "category": category,
                        "severity": severity,
                        "title": title,
                        "detail": detail,
                    }
                    try:
                        client.post(f"/v1/autonomy/{booking}/events/ingest", json=payload)
                        print(f"[chaos] +{ts:6.1f}s {severity.upper():8s} {category:11s} {title}", flush=True)
                        # Structured marker line consumed by record_demo.sh.
                        safe_title = title.replace("\"", "'")
                        safe_detail = detail.replace("\"", "'")
                        print(
                            f">> event: {category} severity={severity} title=\"{safe_title}\" detail=\"{safe_detail}\"",
                            flush=True,
                        )
                    except Exception as e:
                        print(f"[chaos] event POST failed: {e}", file=sys.stderr)
            last_event = t

            time.sleep(TICK_DT / args.speed)

    return 0


if __name__ == "__main__":
    sys.exit(main())
