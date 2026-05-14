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
import base64
import hashlib
import hmac
import json
import math
import os
import random
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _vehicle_token(signing_key: str, scope_id: str, body_bytes: bytes) -> str:
    """HMAC-SHA256(key, `${scope}.${b64url(sha256(body))}`) — must match
    `apps/api/src/routes/autonomy.ts::verifyVehicleProducerToken` byte-for-byte."""
    body_hash = _b64url(hashlib.sha256(body_bytes).digest())
    msg = f"{scope_id}.{body_hash}".encode("utf-8")
    sig = hmac.new(signing_key.encode("utf-8"), msg, hashlib.sha256).digest()
    return _b64url(sig)

DEFAULT_BASE = "http://localhost:8787"
TICK_HZ = 10
TICK_DT = 1.0 / TICK_HZ


@dataclass
class Phase:
    name: str
    start_s: float
    end_s: float


PHASES: List[Phase] = [
    # Full L5 lifecycle, ~10 min, modeled on Mercedes Drive Pilot + Waymo 6
    # operational profiles: cold-start + ODD admit + grant + drive + faults
    # + R157 ladder + service centre + return.
    Phase("cold-start-self-check", 0, 15),
    Phase("odd-admission", 15, 25),
    Phase("grant-acquisition", 25, 35),
    Phase("home-gliding-out", 35, 65),
    Phase("arterial-merge", 65, 100),
    Phase("boulevard-cruise", 100, 150),
    Phase("construction-zone", 150, 180),
    Phase("pedestrian-dart-out", 180, 200),
    Phase("brake-pad-rul-drop", 200, 235),
    Phase("predictive-booking", 235, 260),
    Phase("ood-margin-eroding", 260, 295),
    Phase("r157-rung-2-mrm", 295, 330),
    Phase("sc-routing", 330, 380),
    Phase("avp-handshake", 380, 420),
    Phase("service-bay-handover", 420, 480),
    Phase("return-leg", 480, 560),
    Phase("home-arrival-secure-park", 560, 600),
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


SPEED_CAP_KPH = 50.0  # hard regulatory cap

# Red-light / mandatory-stop schedule (start_t, duration_s). The MPC uses
# these to brake aggressively, hold zero, then re-accelerate hard.
RED_LIGHTS = [
    (75.0, 18.0),    # signalised intersection on arterial
    (135.0, 14.0),   # boulevard pedestrian crossing
    (250.0, 8.0),    # service-corridor stop sign
    (520.0, 12.0),   # return-leg traffic light
]

# Mandatory-stop windows tied to scenario events
EMERGENCY_STOPS = [
    (180.0, 5.0),    # pedestrian dart-out — emergency brake
]

# Slow-zone windows where racer must respect the constraint
SLOW_ZONES = [
    (155.0, 25.0, 25.0),   # construction zone, cap 25
    (295.0, 35.0, 8.0),    # MRM lateral creep, cap 8
    (390.0, 30.0, 6.0),    # AVP geofence, cap 6
]


def _in_window(t: float, windows: list[tuple]) -> Optional[tuple]:
    for w in windows:
        if w[0] <= t < w[0] + w[1]:
            return w
    return None


def _target_speed_for(t: float) -> float:
    """Racer-grade target speed: cruise at the cap, brake to zero only when
    the rules force it (red light, emergency, slow zone, parking)."""
    # Pre-drive: stationary
    if t < 35:    return 0.0
    # Service bay (parked)
    if 420.0 <= t < 480.0:    return 0.0
    # Home arrival + secure park
    if t >= 590.0:            return 0.0

    # Red lights / emergency stops force zero
    if _in_window(t, RED_LIGHTS) is not None:    return 0.0
    if _in_window(t, EMERGENCY_STOPS) is not None: return 0.0

    # Slow zones cap below the regulatory ceiling
    sz = _in_window(t, SLOW_ZONES)
    if sz is not None:
        return float(sz[2])

    # Otherwise drive AT the cap — racer keeps the foot down up to the limit
    return SPEED_CAP_KPH


def speed_for(t: float) -> float:
    """Racer-mode MPC: drive at SPEED_CAP_KPH, brake aggressively when the
    target drops (red light, emergency, slow zone), re-accelerate hard.

    Uses a sport-grade longitudinal profile:
      - max accel = 3.0 m/s² (~10.8 kph/s)
      - max decel = 5.0 m/s² (~18.0 kph/s)
      - emergency decel = 10.0 m/s² (~36.0 kph/s) inside dart-out window

    Anticipatory slowdown: when a stop is < 4 s ahead at current speed,
    target shifts to creep so jerk stays bounded. Tiny tick-noise is added
    above 4 kph to mimic real throttle micromodulation.
    """
    if not hasattr(speed_for, "_state"):
        speed_for._state = {"v": 0.0, "last_t": 0.0, "rng": random.Random(7)}  # type: ignore[attr-defined]
    s = speed_for._state  # type: ignore[attr-defined]
    if t + 0.5 < s["last_t"]:
        s["v"] = 0.0
        s["last_t"] = 0.0
    dt = max(0.001, t - s["last_t"])
    s["last_t"] = t

    target = _target_speed_for(t)
    # Anticipatory braking: if a hard stop window starts within 4 s, ease
    # to half-cap so the upcoming brake stays jerk-bounded.
    look_t = t + 4.0
    if (_in_window(look_t, RED_LIGHTS) is not None
            or _in_window(look_t, EMERGENCY_STOPS) is not None):
        target = min(target, SPEED_CAP_KPH * 0.45)

    # Sport-grade dynamics
    a_max_kphps = 3.0 * 3.6   # ~10.8 kph/s
    d_max_kphps = 5.0 * 3.6   # ~18.0 kph/s
    if _in_window(t, EMERGENCY_STOPS) is not None:
        d_max_kphps = 10.0 * 3.6  # ~36.0 kph/s

    delta = target - s["v"]
    cap = (a_max_kphps if delta > 0 else d_max_kphps) * dt
    if abs(delta) > cap:
        delta = math.copysign(cap, delta)
    s["v"] += delta

    # Per-tick micro-noise — throttle ripple, road camber, drag step
    if s["v"] > 4.0 and _in_window(t, EMERGENCY_STOPS) is None:
        s["v"] += s["rng"].gauss(0.0, 0.05 + s["v"] * 0.010)

    # Hard cap — racer respects the regulatory ceiling
    s["v"] = max(0.0, min(SPEED_CAP_KPH, s["v"]))
    return s["v"]


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

    # Stateful heading via a bicycle-model integration: yaw rate is only
    # produced when the vehicle is moving AND the front wheels are turned.
    # A stationary car cannot change heading; that was the bug.
    if not hasattr(build_frame, "_heading"):
        build_frame._heading = 90.0  # type: ignore[attr-defined]
        build_frame._last_t_heading = 0.0  # type: ignore[attr-defined]
    if t + 0.5 < build_frame._last_t_heading:  # type: ignore[attr-defined]
        build_frame._heading = 90.0  # type: ignore[attr-defined]
        build_frame._last_t_heading = 0.0  # type: ignore[attr-defined]
    _hdt = max(0.0, t - build_frame._last_t_heading)  # type: ignore[attr-defined]
    build_frame._last_t_heading = t  # type: ignore[attr-defined]
    if speed_kph > 1.0:
        wheelbase_m = 2.85
        max_steer_rad = math.radians(33.0)
        steer_angle_rad = steering * max_steer_rad
        yaw_rate_rad_s = (speed_mps * math.tan(steer_angle_rad)) / wheelbase_m
        build_frame._heading = (build_frame._heading + math.degrees(yaw_rate_rad_s) * _hdt) % 360.0  # type: ignore[attr-defined]
    heading_deg = build_frame._heading % 360.0  # type: ignore[attr-defined]
    if heading_deg < 0:
        heading_deg += 360.0

    frame: Dict[str, Any] = {
        "ts": now_iso(),
        "origin": "sim",
        "simSource": "chaos-scenario",
        "speedKph": round1(speed_kph),
        "headingDeg": round1(heading_deg),
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

    # ------------------------------------------------------------------
    # Hyper-realistic L5 elaboration. Top-level passthrough additions
    # that mirror what real research-grade research vehicles publish
    # (Mercedes Drive Pilot, Waymo 6, Mobileye Chauffeur, Tesla FSD HW4).
    # ------------------------------------------------------------------

    # Current phase name for downstream consumers / dashboards
    current_phase_name = "unknown"
    for _p in PHASES:
        if _p.start_s <= t < _p.end_s:
            current_phase_name = _p.name
            break
    frame["phaseName"] = current_phase_name

    # Behavior tree state (root -> selector -> action node)
    bt_action = behavior
    bt_root = "Drive"
    if t < 35:
        bt_root, bt_action = "Boot", "ColdStartSelfTest" if t < 15 else "OddAdmission" if t < 25 else "GrantAcquisition"
    elif t >= 480:
        bt_root, bt_action = "Park", "ReturnLegCruise" if t < 560 else "SecureParkSequence"
    elif in_phase(t, "r157-rung-2-mrm"):
        bt_root = "Safety"
    frame["behaviorTree"] = {
        "root": bt_root,
        "current": bt_action,
        "tickCount": int(t * 10),
        "lastTransitionAtS": round1(max(0.0, t - phase_progress(t, current_phase_name) *
                                       (next((p.end_s - p.start_s for p in PHASES if p.name == current_phase_name), 0)))),
    }

    # MPC controller errors (lateral, heading, jerk, longitudinal gap)
    lat_err_m = round3(math.sin(t / 6) * 0.05 + rng.uniform(-0.01, 0.01))
    head_err_deg = round3(math.sin(t / 7) * 0.4 + rng.uniform(-0.05, 0.05))
    jerk = round3((rng.random() - 0.5) * 0.6 + (1.4 if 124 <= t <= 132 else 0.0))
    long_gap_m = round1(18 + math.sin(t / 3) * 3) if speed_kph > 5 else None
    frame["mpcErrors"] = {
        "lateralM": lat_err_m,
        "headingDeg": head_err_deg,
        "jerkMps3": jerk,
        "longitudinalGapM": long_gap_m,
        "horizonStates": int(20),
        "predictedNextStatesM": [
            round1((speed_mps * 0.1) * (i + 1)) for i in range(5)
        ],
    }

    # Tire physics — slip ratio per wheel + lateral/longitudinal force estimate
    base_slip = 0.01 if brake < 0.3 else 0.06
    tire_physics = {}
    for corner, multiplier in (("fl", 1.0), ("fr", 1.02), ("rl", 0.95), ("rr", 0.97)):
        slip = base_slip * multiplier + rng.uniform(-0.005, 0.005)
        if 124 <= t <= 132:  # emergency brake
            slip += 0.04
        tire_physics[corner] = {
            "slipRatio": round3(slip),
            "fxN": round1((throttle - brake) * 1500 * multiplier),
            "fyN": round1(steering * 800 * multiplier),
            "surfaceTempC": round1(28 + speed_kph * 0.18 + rng.random() * 1.0),
        }
    frame["tirePhysics"] = tire_physics

    # Body dynamics — roll, pitch, body-slip-angle, yaw error
    frame["bodyDynamics"] = {
        "rollDeg": round3(math.sin(t / 4) * 0.6 + steering * 1.4),
        "pitchDeg": round3(brake * -0.8 + throttle * 0.5),
        "bodySlipDeg": round3(steering * 0.9 + rng.uniform(-0.02, 0.02)),
        "yawRateDegS": round1(steering * 12 + math.sin(t / 5) * 0.3),
        "yawErrorDegS": round3(rng.uniform(-0.05, 0.05)),
    }

    # BMS history — cycle count, last balance, runaway risk
    frame["bmsHistory"] = {
        "cycleCountTotal": int(412 + (t / 3600) * 0.1),
        "depthOfDischargePct": round1(100 - hv_soc),
        "balanceDecisionsLastHour": int(rng.random() * 4),
        "lastBalanceAtS": round1(t - 38 - rng.random() * 200),
        "thermalRunawayRiskScore": round3(0.002 + (cell_mean_mv < 3500) * 0.04),
        "fastChargeReady": True,
        "lastDcfcSessionAt": "2026-05-08T09:14:00Z",
    }

    # Per-DNN inference latencies (microseconds, p50/p95/p99) — from
    # Mobileye / NVIDIA Drive Orin published profiles.
    frame["dnnLatencies"] = {
        "perception": {"p50us": int(8400 + rng.random() * 200), "p95us": int(11200), "p99us": int(13800)},
        "prediction": {"p50us": int(2100 + rng.random() * 80),  "p95us": int(2900),  "p99us": int(3600)},
        "planning":   {"p50us": int(4200 + rng.random() * 120), "p95us": int(5800),  "p99us": int(7100)},
        "control":    {"p50us": int(680  + rng.random() * 30),  "p95us": int(900),   "p99us": int(1200)},
    }

    # Cybersecurity (ISO/SAE 21434) — TOE state + key epochs
    frame["cybersecurity"] = {
        "toeState": "ok",
        "anomaliesLastHour": int(rng.random() * 2),
        "lastSecBootEpoch": "2026-05-09T00:00:00Z",
        "hsmKeyEpoch": int(t / 60) + 1,
        "tlsRotationDueS": int(3600 - (t % 3600)),
        "intrusionDetectionState": "monitoring",
    }

    # Cumulative regen energy recovered (Wh)
    regen = max(0.0, brake * 8.0)
    if not hasattr(build_frame, "_regen_wh"):
        build_frame._regen_wh = 0.0  # type: ignore[attr-defined]
    build_frame._regen_wh += regen * (TICK_DT / 3600)  # type: ignore[attr-defined]
    frame["regenWh"] = round1(build_frame._regen_wh)  # type: ignore[attr-defined]

    # ASIL / SOTIF (ISO 26262 / 21448) status
    frame["functionalSafety"] = {
        "asilLevel": "ASIL-D",
        "sotifVersion": "ISO/PAS 21448:2024",
        "freedomFromInterference": "intact",
        "fttiBudgetMs": 220,
        "sotifUnknownsTriggered": 1 if 125 <= t <= 134 else 0,
        "iso26262SafetyGoalsViolated": 0,
    }

    # Insurance + regulatory state (informational)
    frame["regulatory"] = {
        "operatorOdcLicence": "in-good-standing",
        "insuranceProvider": "ICICI Lombard L4 motor",
        "policyId": "ICL-L4-2026-014772",
        "uneceR157Rung": rung,
        "uneceR155TaraOk": True,
        "ehrActive": False,
    }

    # ----- Driver console + route map data --------------------------------
    # currentAction is what the dashboard shows in the prominent centre
    # console; nextConstraint feeds the "in 240 m / 12 s" sub-line.
    target = _target_speed_for(t)
    if t < 15:
        action_label, action_detail = "SELF-TEST", "Lockstep + HSM heartbeat"
    elif t < 25:
        action_label, action_detail = "ODD ADMISSION", "Weather, traffic, regulatory checks"
    elif t < 35:
        action_label, action_detail = "GRANT MINTING", "ES256 owner consent + biometric"
    elif 420 <= t < 480:
        action_label, action_detail = "PARKED", "Service in progress"
    elif t >= 590:
        action_label, action_detail = "PARKED", "Home, secure shutdown"
    elif behavior == "minimal-risk-manoeuvre":
        action_label, action_detail = "MRM ACTIVE", "Lateral creep to shoulder"
    elif brake > 0.5:
        action_label, action_detail = "BRAKING", f"Slowing from {speed_kph:.0f} kph"
    elif speed_kph < 1:
        action_label, action_detail = "STOPPED", "Yielding to constraint"
    elif speed_kph < target - 3:
        action_label, action_detail = "ACCELERATING", f"Targeting {target:.0f} kph"
    elif speed_kph > target + 3:
        action_label, action_detail = "DECELERATING", f"Targeting {target:.0f} kph"
    else:
        action_label, action_detail = "CRUISING", f"Holding {target:.0f} kph"
    frame["currentAction"] = action_label
    frame["currentActionDetail"] = action_detail

    # Next constraint within the next 60 s
    next_constraint: Optional[Dict[str, Any]] = None
    candidates: List[tuple] = []
    for w in RED_LIGHTS:
        if t < w[0] < t + 60:
            candidates.append(("Red light", w[0] - t))
    for w in EMERGENCY_STOPS:
        if t < w[0] < t + 60:
            candidates.append(("Pedestrian dart-out", w[0] - t))
    for w in SLOW_ZONES:
        if t < w[0] < t + 60:
            candidates.append((f"Slow zone ({int(w[2])} kph cap)", w[0] - t))
    if candidates:
        label, time_s = min(candidates, key=lambda c: c[1])
        dist_m = max(0.0, (speed_kph / 3.6) * time_s)
        next_constraint = {"label": label, "etaS": round1(time_s), "distanceM": round1(dist_m)}
    frame["nextConstraint"] = next_constraint

    # Route progress — running integral of speed (km), plus a constant total.
    if not hasattr(build_frame, "_dist_km"):
        build_frame._dist_km = 0.0  # type: ignore[attr-defined]
        build_frame._last_t_dist = 0.0  # type: ignore[attr-defined]
    if t + 0.5 < build_frame._last_t_dist:  # type: ignore[attr-defined]
        build_frame._dist_km = 0.0  # type: ignore[attr-defined]
        build_frame._last_t_dist = 0.0  # type: ignore[attr-defined]
    _dt = max(0.0, t - build_frame._last_t_dist)  # type: ignore[attr-defined]
    build_frame._last_t_dist = t  # type: ignore[attr-defined]
    build_frame._dist_km += (speed_kph / 3.6) * _dt / 1000.0  # type: ignore[attr-defined]
    frame["distanceTraveledKm"] = round3(build_frame._dist_km)  # type: ignore[attr-defined]
    frame["routeTotalKm"] = 12.3
    frame["routeProgress"] = round3(min(1.0, build_frame._dist_km / 12.3))  # type: ignore[attr-defined]

    # Route waypoints for the dashboard map (fraction along route, label, kind)
    frame["routeWaypoints"] = [
        {"frac": 0.00, "label": "Home",            "kind": "origin"},
        {"frac": 0.15, "label": "Red light 1",     "kind": "redlight"},
        {"frac": 0.32, "label": "Red light 2",     "kind": "redlight"},
        {"frac": 0.45, "label": "Construction",    "kind": "construction"},
        {"frac": 0.55, "label": "Pedestrian event","kind": "incident"},
        {"frac": 0.65, "label": "Service centre",  "kind": "destination"},
        {"frac": 0.85, "label": "Red light 3",     "kind": "redlight"},
        {"frac": 1.00, "label": "Home",            "kind": "origin"},
    ]

    # Reality index — explicit per-block provenance for verifiers + auditors
    frame["provenance"] = {
        "speedKph": "scripted",
        "headingDeg": "scripted",
        "powertrain.hvCellsMv": "physics-of-failure-tied",
        "powertrain.motors": "synthetic-tied",
        "perception.tracks": "scripted",
        "behaviorTree": "scripted",
        "mpcErrors": "scripted",
        "tirePhysics": "synthetic-tied-to-control",
        "bodyDynamics": "synthetic-tied-to-control",
        "bmsHistory": "synthetic-const",
        "dnnLatencies": "from-published-profiles (Mobileye, NVIDIA Drive Orin)",
        "cybersecurity": "synthetic-const",
        "functionalSafety": "synthetic-const",
        "regulatory": "synthetic-const",
        "v2x": "scripted",
        "compute": "synthetic-tied",
        "network": "synthetic-const",
        "cabin": "synthetic-const",
        "environment": "synthetic-const",
        "software": "synthetic-const",
    }
    frame["realityIndex"] = {
        "scriptedFraction": 0.45,
        "syntheticTiedFraction": 0.40,
        "syntheticConstFraction": 0.15,
        "carlaTruthFraction": 0.0,  # chaos = no CARLA
        "note": "chaos-driver: dashboard parity with live CARLA bridge schema; values realistic for L5 OEM stacks",
    }

    return frame


# Full L5 lifecycle event schedule, ~45 events over 10 min.
EVENT_SCHEDULE = [
    # --- Cold-start + ODD admit + grant (0-35s) ---
    (0.5,  "scenario", "info", "Scenario started", "Owner-initiated trip. Cold start sequence engaged."),
    (1.5,  "compute",  "info", "HSM heartbeat OK", "Infineon AURIX TC4x lockstep self-test passed (diff=0 ppm)."),
    (3.0,  "compute",  "info", "Sec-boot quorum", "ML-DSA-65 chain verified, 4-of-5 attestation slots green."),
    (5.0,  "compute",  "info", "Perception models warm", "BEV-Occ-Tx + ego-tracker + intent v9.4.2 loaded (1.8 s)."),
    (8.0,  "navigation", "info", "HD-map tile fresh", "Tile veh-na-2026.05.W18.r1 in cache, 2 deltas pending."),
    (12.0, "infra",    "info", "5G NR-V2X uplink", "RSRP -84 dBm, SINR 18 dB, MEC RTT 11.6 ms (Bangalore-East)."),
    (15.0, "compliance", "info", "ODD admission check", "Weather clear, regulatory zone IN-KA, daylight, traffic medium."),
    (17.0, "compliance", "info", "DPDP consent active", "Purposes: service-fulfilment, autonomy-delegation, autopay."),
    (20.0, "regulatory","info", "ASIL-D + R157 rung 0", "Functional safety budget intact. SOTIF unknowns 0."),
    (25.0, "scenario", "info", "Owner grant accepted", "ES256 signature verified, ttl 13 min, geofence Bangalore-Indiranagar."),
    (30.0, "navigation","info", "Route locked", "12.3 km · ETA 17 min · weights time(0.4) energy(0.35) comfort(0.25)."),
    (33.0, "driving",  "info", "12V -> HV transition", "BMS contactor closed. HV bus 392 V steady. SoP 184 kW available."),
    # --- Home gliding out (35-65s) ---
    (37.0, "driving",  "info", "Behavior: cruise", "Sub-residential 24 kph. Pedestrian-aware mode."),
    (45.0, "perception","info", "Cyclist acquired", "Track trk-cyclist, range 36 m, bearing +7°, vMps 4.2."),
    (60.0, "v2x",      "info", "BSM neighbour count", "5 PC5 sidelink peers in same lane group, BSM 13 Hz each."),
    # --- Arterial merge + boulevard cruise (65-150s) ---
    (70.0, "navigation","info", "Mandatory lane change", "Arterial merge in 220 m. V2X negotiation with neighbour-3 ack."),
    (90.0, "driving",  "info", "ACC neighbour cooperation", "Lead vehicle gap target 22 m, jerk-limited approach."),
    (110.0,"v2x",      "info", "SPaT subscription", "RSU-J47 Indiranagar 100ft Rd. ttc-to-yellow 38 s ahead."),
    (130.0,"perception","info", "Free-space carving", "Front 30° free-space 0.78, drivable area mIoU 0.94."),
    (145.0,"compute",  "info", "Lockstep tick OK", "AURIX dual-core diff 0.1 ppm, FCS within bound."),
    # --- Construction zone (150-180s) ---
    (152.0,"perception","watch","Construction cones detected","3 cones, 32 m ahead. Lane shift scheduled. Speed limit 25 kph."),
    (158.0,"driving",  "info", "Behavior: lane-shift", "Mandatory lateral 2.4 m left over 12 m. Steering 0.18 rad/s."),
    (168.0,"v2x",      "info", "DENM received", "Roadworks 380 m ahead, lane 2 closed. RSU-J51 broadcast."),
    # --- Pedestrian dart-out (180-200s) ---
    (180.0,"safety",   "alert","Pedestrian dart-out", "VRU trk-ped-dart at 14 m bearing -12°. Predicted 1.6 mps lateral."),
    (180.4,"v2x",      "alert","DENM transmitted", "Type=hazardous-location-other, 5G NR-V2X uplink + PC5 broadcast."),
    (181.0,"safety",   "critical","Emergency brake engaged","MPC override brake 0.85, jerk -3.4 m/s³. R157 rung 1."),
    (183.0,"safety",   "info", "Brake AEB sustained", "Range closed to 3.2 m. AEB held until VRU clears ROI."),
    (188.0,"safety",   "info", "Pedestrian cleared", "trk-ped-dart left ROI. Brake released, gentle re-acceleration."),
    # --- Brake pad RUL drop + predictive booking (200-260s) ---
    (205.0,"fault",    "watch","Brake-pad RUL drop", "Acoustic+vibration+temp fusion: -34% margin in 8 s."),
    (215.0,"fault",    "alert","BMS cell sag detected", "Cell-7 (str A) -90 mV vs mean. Severson knee-point < 80 cycles."),
    (228.0,"fault",    "alert","PHM critical: brakes-pads-front","Tier-1 RUL 22 km, p_fail 0.92. Predictive booking pre-empted."),
    (240.0,"scenario", "info", "Booking auto-created", "ID bk_chaos_demo, severity 'unsafe-to-drive-untouched', SC shortlist x3."),
    (245.0,"navigation","info", "Service centre selected", "Sapphire Auto Indiranagar (4.6 ⭐), distance 1.4 km, parts in stock."),
    (255.0,"scenario", "info", "Outbound CommandGrant minted","ES256 cap-token, ttl 18 min, geofence SC + return corridor."),
    # --- OOD margin eroding (260-295s) ---
    (265.0,"safety",   "watch","OOD Mahalanobis rising","Score 0.61, threshold 0.92. SOTIF stack flagging margin (V8 §5.4.2)."),
    (280.0,"safety",   "watch","Capability budget 64%","Tire-grip(72), compute(91), network(88), GNSS(98), brakes(31)."),
    # --- R157 rung 2 MRM (295-330s) ---
    (298.0,"safety",   "critical","R157 rung 2", "Backup-driver attention probe + visual+audio handover request."),
    (302.0,"driving",  "info", "MRM armed", "Minimal-Risk Manoeuvre: lateral-creep-to-shoulder. ETA 22 s."),
    (320.0,"safety",   "info", "MRM stable", "Shoulder reached. 8 kph creep until SC corridor."),
    # --- SC routing + AVP (330-420s) ---
    (335.0,"navigation","info", "Approach corridor", "SC 480 m ahead. Mercedes-Bosch IPP geofence boundary in 60 m."),
    (350.0,"infra",    "info", "Mercedes IPP handshake","OEM-AVP adapter authenticated (X.509 EV). Grant ttl 13 min."),
    (370.0,"scenario", "info", "AVP slot 4-A reserved", "Sapphire Auto bay 4-A. Bosch valet parking takes over."),
    (400.0,"infra",    "info", "Wireless charging negotiated","SAE J2954 80kW, alignment offset 12 mm, inductive coil active."),
    # --- Service handover + complete (420-510s) ---
    (430.0,"scenario", "info", "Bay arrival", "Tech handoff: tablet receipt scanned, parts ticket released."),
    (455.0,"scenario", "info", "Service in progress", "Brake pads + sensor recalibration. ETA 18 min."),
    (478.0,"scenario", "info", "Service complete", "Pads replaced (OEM-spec, 11.4 mm). 24-pt safety check passed."),
    # --- Return leg + home arrival (480-600s) ---
    (485.0,"scenario", "info", "Return CommandGrant minted","ES256 cap-token, ttl 14 min, geofence corridor + home."),
    (500.0,"navigation","info", "Return cruise 28 kph", "1.4 km · ETA 4 min. Light traffic, no construction."),
    (560.0,"navigation","info", "Home approach", "240 m. Steering for driveway entry. PHM clear."),
    (585.0,"scenario", "info", "Returned home", "Booking closed. Owner key re-bound. Telemetry sealed (SHA-256 + ML-DSA)."),
    (595.0,"compliance","info", "Trip artefacts uploaded","Encrypted+signed leaf hash 8af1...e62b. Retention 30 d (DPDP)."),
]


def run_scenario_loop(
    base: str,
    booking: str,
    *,
    seed: int = 42,
    speed: float = 1.0,
    loop: bool = False,
    max_seconds: Optional[float] = None,
    stop: Optional[Any] = None,
    log: Optional[Any] = None,
    headers: Optional[Dict[str, str]] = None,
) -> int:
    """Drive the chaos scenario against ``base`` for booking ``booking``.

    Pure callable form of :func:`main` — no argparse, no signal handlers.
    The wrapper around it (CLI in ``main``, Cloud Run handler in
    ``cloudrun/server.py``) installs its own stop signalling. ``stop`` is a
    zero-arg callable returning truthy when the loop should exit; ``log`` is
    a one-arg callable receiving status strings (defaults to ``print``).
    """
    rng = random.Random(seed)
    base = base.rstrip("/")
    _log = log if log is not None else (lambda m: print(m, flush=True))
    _stop = stop if stop is not None else (lambda: False)

    # SESSION_SIGNING_KEY is the HMAC secret the API uses to verify the
    # x-vsbs-vehicle-token on every telemetry/event ingest. Falls back to
    # VSBS_SESSION_SIGNING_KEY for parity with vsbs_carla.api.VsbsApi.
    signing_key = os.environ.get("SESSION_SIGNING_KEY") or os.environ.get(
        "VSBS_SESSION_SIGNING_KEY"
    )

    last_event = -1.0
    last_phase: Optional[str] = None
    started_wall = time.monotonic()

    with httpx.Client(base_url=base, timeout=httpx.Timeout(2.0, connect=1.0), headers=headers or {}) as client:
        try:
            r = client.get("/readyz")
            r.raise_for_status()
            _log(f"[chaos] api ready at {base}: {r.json().get('status')}")
        except Exception as e:
            print(f"[chaos] api at {base} is unreachable: {e}", file=sys.stderr)
            return 2

        scenario_start = time.monotonic()
        while not _stop():
            if max_seconds is not None and (time.monotonic() - started_wall) >= max_seconds:
                _log(f"[chaos] max-seconds reached ({max_seconds}s)")
                break

            t = (time.monotonic() - scenario_start) * speed
            if t > PHASES[-1].end_s:
                if loop:
                    scenario_start = time.monotonic()
                    last_event = -1.0
                    _log("[chaos] looping")
                    continue
                _log(f"[chaos] scenario complete after {t:.1f}s")
                break

            current_phase: Optional[str] = None
            for p in PHASES:
                if p.start_s <= t < p.end_s:
                    current_phase = p.name
                    break
            if current_phase is not None and current_phase != last_phase:
                last_phase = current_phase
                _log(f">> phase: {current_phase}")

            frame = build_frame(t, booking, rng)
            try:
                body_bytes = json.dumps(frame, separators=(",", ":")).encode("utf-8")
                post_headers = {"content-type": "application/json"}
                if signing_key:
                    post_headers["x-vsbs-vehicle-token"] = _vehicle_token(
                        signing_key, booking, body_bytes
                    )
                client.post(
                    f"/v1/autonomy/{booking}/telemetry/ingest",
                    content=body_bytes,
                    headers=post_headers,
                )
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
                        event_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                        event_headers = {"content-type": "application/json"}
                        if signing_key:
                            event_headers["x-vsbs-vehicle-token"] = _vehicle_token(
                                signing_key, booking, event_bytes
                            )
                        client.post(
                            f"/v1/autonomy/{booking}/events/ingest",
                            content=event_bytes,
                            headers=event_headers,
                        )
                        _log(f"[chaos] +{ts:6.1f}s {severity.upper():8s} {category:11s} {title}")
                        safe_title = title.replace("\"", "'")
                        safe_detail = detail.replace("\"", "'")
                        _log(
                            f">> event: {category} severity={severity} title=\"{safe_title}\" detail=\"{safe_detail}\""
                        )
                    except Exception as e:
                        print(f"[chaos] event POST failed: {e}", file=sys.stderr)
            last_event = t

            time.sleep(TICK_DT / max(speed, 1e-3))

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="VSBS chaos-scenario driver (no CARLA needed)")
    parser.add_argument("--booking", default="demo", help="Booking id used in the dashboard URL")
    parser.add_argument("--base", default=DEFAULT_BASE, help="VSBS API base URL")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--speed", type=float, default=1.0, help="Wall-clock speed multiplier (1.0 = real-time)")
    parser.add_argument("--loop", action="store_true", help="Restart the scenario when it ends")
    args = parser.parse_args()

    stop_flag = {"v": False}

    def handle_sig(_signum: int, _frame: Any) -> None:
        stop_flag["v"] = True
        print("\n[chaos] stopping", flush=True)

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)

    return run_scenario_loop(
        base=args.base,
        booking=args.booking,
        seed=args.seed,
        speed=args.speed,
        loop=args.loop,
        stop=lambda: stop_flag["v"],
    )


if __name__ == "__main__":
    sys.exit(main())
