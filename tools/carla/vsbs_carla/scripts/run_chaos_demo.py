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
import dataclasses
import hashlib
import hmac
import json
import math
import os
import random
import signal
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple

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


# ============================================================================
# Physics simulator — chaos driver behaves like a CARLA stand-in. Forces are
# integrated each tick; every observable (speed, brake heat, motor temp, cell
# voltage, TPMS pressure, coolant) flows from the integrated state so the
# dashboard sees physically consistent telemetry. Plug a real CARLA back in
# and the only thing that changes is the data source — the wire shape, the
# API contract, and the dashboard render path stay byte-identical.
# ============================================================================


@dataclass(frozen=True)
class PhysicsConstants:
    # EQS-class research vehicle, AWD dual-motor
    mass_kg: float = 2200.0
    drag_coeff: float = 0.20
    frontal_area_m2: float = 2.4
    rolling_resistance: float = 0.012
    wheel_radius_m: float = 0.34
    wheelbase_m: float = 2.85
    max_motor_torque_total_nm: float = 1100.0   # sum of front + rear motors
    max_brake_force_total_n: float = 25000.0     # ~11 m/s² peak decel
    motor_efficiency: float = 0.93
    final_drive_ratio: float = 8.6
    # Battery
    battery_capacity_kwh: float = 107.8
    cell_count: int = 96
    cell_internal_r_mohm: float = 0.6
    # Thermal masses (J/K) — set so heat-up over a 5-min run is visible without
    # going pathological. These are tuned, not measured; they trade strict
    # physical accuracy for legible dashboard behaviour at 10 Hz.
    motor_thermal_mass_jk: float = 14000.0
    inverter_thermal_mass_jk: float = 5500.0
    brake_thermal_mass_per_wheel_jk: float = 14000.0
    tire_thermal_mass_jk: float = 9000.0
    coolant_motor_thermal_mass_jk: float = 65000.0
    coolant_battery_thermal_mass_jk: float = 50000.0
    # Cabin
    cabin_thermal_mass_jk: float = 18000.0          # air + seats + plastics
    cabin_glass_area_m2: float = 4.0
    cabin_glass_solar_transmissivity: float = 0.62  # tinted laminated glass
    cabin_surface_area_m2: float = 18.0
    cabin_insulation_w_per_k: float = 28.0
    cabin_solar_absorptance: float = 0.55           # body + dashboard absorption
    # HVAC compressor — peak ~6 kW electrical, COP varies with ambient
    hvac_peak_compressor_w: float = 6000.0
    hvac_blower_w: float = 350.0
    # Constants
    air_density_kg_m3: float = 1.225
    g_m_s2: float = 9.81
    stefan_boltzmann: float = 5.67e-8


PC = PhysicsConstants()


# ----------------------------------------------------------------------------
# Environment: real-time weather + air quality fetched once at scenario start.
# Everything thermal in the chaos driver feeds off this: solar gain heats the
# cabin, HVAC fights it (draining the HV pack), ambient and humidity set the
# coolant-loop target, wind shifts effective drag, pavement state drops μ on
# rain/snow which limits braking acceleration. Falls back to a sane "clear-day
# Bangalore" default if the network is unreachable (Cloud Run egress, free
# Open-Meteo endpoint, ~200 ms RTT).
# ----------------------------------------------------------------------------


WMO_LABEL: Dict[int, str] = {
    0: "clear", 1: "cloudy", 2: "cloudy", 3: "cloudy",
    45: "fog", 48: "fog",
    51: "rain", 53: "rain", 55: "rain", 56: "rain", 57: "rain",
    61: "rain", 63: "rain", 65: "rain", 66: "rain", 67: "rain",
    71: "snow", 73: "snow", 75: "snow", 77: "snow",
    80: "rain", 81: "rain", 82: "rain",
    85: "snow", 86: "snow",
    95: "storm", 96: "storm", 99: "storm",
}


def _interpret_weather(code: int) -> tuple[str, str, float]:
    """Map WMO code -> (label, pavement, baseline μ). Tire grip baseline drops
    on wet/snow/ice; storms lop visibility too."""
    label = WMO_LABEL.get(code, "cloudy")
    if label == "clear" or label == "cloudy":
        return label, "asphalt-dry", 0.88
    if label == "fog":
        return label, "asphalt-dry", 0.84
    if label == "rain":
        return label, "asphalt-wet", 0.58
    if label == "snow":
        return label, "snow", 0.30
    if label == "storm":
        return label, "asphalt-wet", 0.50
    return label, "asphalt-dry", 0.85


@dataclass
class EnvironmentSnapshot:
    """One-shot capture of the world around the ego. Refreshed at scenario
    start and (optionally) periodically. Drives every environment-coupled
    behaviour in the physics integrator."""
    fetched_at: str = ""
    source: str = "fallback"
    lat: float = 12.9716
    lng: float = 77.5946
    ambient_temp_c: float = 28.0
    humidity_pct: float = 65.0
    wind_speed_mps: float = 2.5         # convert from kph at ingest
    wind_dir_deg: float = 180.0
    pressure_hpa: float = 1013.0
    cloud_cover_pct: float = 25.0
    is_day: bool = True
    weather_code: int = 0
    weather_label: str = "clear"
    visibility_m: float = 10000.0
    uv_index: float = 6.0
    pm25_ugm3: float = 14.0
    pm10_ugm3: float = 30.0
    pavement: str = "asphalt-dry"
    pavement_grip_mu: float = 0.88


# --- Weather cache --------------------------------------------------------
# In-process cache keyed by (lat, lng, ts). Lookup walks the entries and
# serves any hit within 5 km haversine of the requested location and
# younger than 2 h. Reduces Open-Meteo load when many users in the same
# city click "Start" — and survives the free-tier 10 000 calls/day cap
# comfortably. Each Cloud Run instance keeps its own cache; multi-instance
# coverage is best-effort (cache miss costs one ~200 ms fetch).
WEATHER_CACHE_TTL_S = 2 * 3600          # 2 hours
WEATHER_CACHE_RADIUS_KM = 5.0           # 10 km diameter
WEATHER_CACHE_MAX = 128
_weather_cache: List[Tuple[float, float, float, "EnvironmentSnapshot"]] = []
_weather_cache_lock = threading.Lock()


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km using the haversine formula."""
    R_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
        * math.sin(dlng / 2.0) ** 2
    )
    return 2.0 * R_km * math.asin(min(1.0, math.sqrt(a)))


def fetch_environment(lat: float, lng: float, log) -> EnvironmentSnapshot:
    """Cache-aware wrapper around the network fetcher. Returns a snapshot
    whose lat/lng match the caller's coordinates (so GPS frame derivation
    anchors at the actual location) but whose weather payload may be reused
    from a nearby cached entry to save Open-Meteo round-trips."""
    now_unix = time.time()
    with _weather_cache_lock:
        # Drop expired entries first so the list stays bounded.
        _weather_cache[:] = [
            (la, ln, ts, sn)
            for (la, ln, ts, sn) in _weather_cache
            if now_unix - ts < WEATHER_CACHE_TTL_S
        ]
        for (la, ln, ts, sn) in _weather_cache:
            if _haversine_km(lat, lng, la, ln) <= WEATHER_CACHE_RADIUS_KM:
                age_min = (now_unix - ts) / 60.0
                if log:
                    log(
                        f"[chaos] weather cache HIT for ({lat:.4f},{lng:.4f}) "
                        f"-> centre ({la:.4f},{ln:.4f}) age={age_min:.1f}min "
                        f"({sn.weather_label} {sn.ambient_temp_c:.1f}C)"
                    )
                # Re-anchor the snapshot to the caller's coords so GPS
                # frames are accurate even when the weather is shared.
                tag = sn.source if sn.source.endswith("-cache") else f"{sn.source}-cache"
                return dataclasses.replace(sn, lat=lat, lng=lng, source=tag)

    snap = _do_fetch_environment(lat, lng, log)
    with _weather_cache_lock:
        _weather_cache.append((lat, lng, now_unix, snap))
        # Evict oldest if over capacity.
        if len(_weather_cache) > WEATHER_CACHE_MAX:
            _weather_cache.sort(key=lambda e: e[2])  # oldest first
            del _weather_cache[: len(_weather_cache) - WEATHER_CACHE_MAX]
    return snap


def _do_fetch_environment(lat: float, lng: float, log) -> EnvironmentSnapshot:
    """Fetch current weather + air-quality from Open-Meteo (free, no key).
    All values fall back to sensible Bangalore defaults if the fetch fails;
    scenario continues either way."""
    snap = EnvironmentSnapshot(fetched_at=now_iso(), lat=lat, lng=lng)
    try:
        r = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lng,
                "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,"
                           "wind_direction_10m,pressure_msl,cloud_cover,weather_code,"
                           "is_day,visibility",
                "wind_speed_unit": "kmh",
                "timezone": "auto",
            },
            timeout=5.0,
        )
        if r.status_code == 200:
            d = r.json().get("current", {}) or {}
            snap.ambient_temp_c = float(d.get("temperature_2m", snap.ambient_temp_c))
            snap.humidity_pct = float(d.get("relative_humidity_2m", snap.humidity_pct))
            snap.wind_speed_mps = float(d.get("wind_speed_10m", 9.0)) / 3.6
            snap.wind_dir_deg = float(d.get("wind_direction_10m", 180.0))
            snap.pressure_hpa = float(d.get("pressure_msl", snap.pressure_hpa))
            snap.cloud_cover_pct = float(d.get("cloud_cover", snap.cloud_cover_pct))
            snap.weather_code = int(d.get("weather_code", 0))
            snap.is_day = bool(d.get("is_day", 1))
            snap.visibility_m = float(d.get("visibility", snap.visibility_m))
            snap.weather_label, snap.pavement, snap.pavement_grip_mu = _interpret_weather(snap.weather_code)
            snap.source = "open-meteo"
            if log:
                log(f"[chaos] weather: {snap.weather_label} {snap.ambient_temp_c:.1f}°C "
                    f"wind={snap.wind_speed_mps*3.6:.1f}kph cloud={snap.cloud_cover_pct:.0f}% "
                    f"μ={snap.pavement_grip_mu}")
    except Exception as e:
        if log:
            log(f"[chaos] weather fetch failed, using defaults: {e}")
    try:
        r = httpx.get(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            params={
                "latitude": lat,
                "longitude": lng,
                "current": "pm2_5,pm10,uv_index",
            },
            timeout=5.0,
        )
        if r.status_code == 200:
            d = r.json().get("current", {}) or {}
            snap.pm25_ugm3 = float(d.get("pm2_5", snap.pm25_ugm3))
            snap.pm10_ugm3 = float(d.get("pm10", snap.pm10_ugm3))
            snap.uv_index = float(d.get("uv_index", snap.uv_index))
    except Exception:
        pass
    return snap


def solar_altitude_deg(lat_deg: float, hour_local: float, day_of_year: int) -> float:
    """Cooper-formula solar declination + spherical-astronomy altitude.
    Accurate to ~0.5° which is plenty for irradiance modulation."""
    declination = 23.45 * math.sin(math.radians(360.0 * (284 + day_of_year) / 365.0))
    hour_angle = 15.0 * (hour_local - 12.0)
    sin_alt = (
        math.sin(math.radians(lat_deg)) * math.sin(math.radians(declination))
        + math.cos(math.radians(lat_deg)) * math.cos(math.radians(declination))
        * math.cos(math.radians(hour_angle))
    )
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_alt))))


def solar_irradiance_w_m2(altitude_deg: float, cloud_cover_pct: float, is_day: bool) -> float:
    """Direct-normal-irradiance approximation with cloud attenuation. ~1100
    W/m² at zenith on a clear day, drops to ~250 W/m² overcast at noon, 0
    at night."""
    if not is_day or altitude_deg <= 0.0:
        return 0.0
    base = 1100.0 * math.sin(math.radians(altitude_deg))
    cloud_factor = 1.0 - (cloud_cover_pct / 100.0) * 0.78
    return max(0.0, base * cloud_factor)


def _wheel_dict_factory() -> Dict[str, float]:
    return {"fl": 0.0, "fr": 0.0, "rl": 0.0, "rr": 0.0}


# ----------------------------------------------------------------------------
# Wear & remaining-useful-life (RUL) projector.
#
# Pure observer on top of the physics state. Each tick it (a) updates a
# rolling exponential-moving-average of the instantaneous wear rate per
# component, (b) accumulates wear into per-component health counters, and
# (c) projects when each component will hit its end-of-life threshold under
# the currently observed operating regime. The PHM panel on the dashboard
# treats these the same way it treats real-vehicle telemetry — same fields,
# same units, same semantics — so swapping CARLA back in changes nothing.
# ----------------------------------------------------------------------------

# Component lifetime nominals (from automotive lit / industry medians)
BRAKE_PAD_EOL_PCT = 15.0           # below 15% = service required
TIRE_TREAD_NEW_MM = 7.5             # new tyre
TIRE_TREAD_EOL_MM = 1.6             # IN / UK / EU minimum
BATTERY_WARRANTY_SOH_PCT = 80.0     # OEM warranty floor
BATTERY_REPLACE_SOH_PCT = 70.0      # practical replacement floor
MOTOR_BEARING_L10_HOURS = 50_000.0  # bearing L10 spec at rated load
INVERTER_CAP_L10_HOURS = 30_000.0   # capacitor lifetime at rated ripple


@dataclass
class WearTracker:
    """Per-component wear state + EMAs of wear rate. Drives the dashboard
    PHM panel: brake-pad RUL km, tire tread mm and km-to-EOL, HV pack
    SoH drift and time-to-warranty, motor bearing hours, inverter cap stress.
    """
    brake_pad_rate_pct_s: Dict[str, float] = field(default_factory=lambda: {w: 0.0 for w in ("fl", "fr", "rl", "rr")})
    tire_tread_mm: Dict[str, float] = field(default_factory=lambda: {w: 7.5 for w in ("fl", "fr", "rl", "rr")})
    tire_wear_rate_mm_s: Dict[str, float] = field(default_factory=lambda: {w: 0.0 for w in ("fl", "fr", "rl", "rr")})
    soh_drift_rate_pct_s: float = 0.0
    motor_bearing_hours_used: float = 0.0
    inverter_capacitor_stress_hours: float = 0.0
    coolant_hours_used: float = 0.0
    _last_brake_pad_pct: Dict[str, float] = field(default_factory=lambda: {w: 78.0 for w in ("fl", "fr", "rl", "rr")})
    _last_t: float = 0.0


def update_wear(wear: WearTracker, vs: VehicleState, t: float) -> None:
    """Per-tick wear observer. Reads vs (already advanced by step_physics)
    and updates wear's EMAs + per-component accumulators."""
    dt = max(0.0, t - wear._last_t)
    wear._last_t = t
    if dt <= 0:
        return

    alpha = 1.0 - math.exp(-dt / 5.0)  # ~5 s EMA time constant

    # Brake pads: derive instantaneous wear rate from observed drop in %.
    for w in ("fl", "fr", "rl", "rr"):
        delta = max(0.0, wear._last_brake_pad_pct[w] - vs.brake_pad_pct[w])
        rate = delta / dt
        wear.brake_pad_rate_pct_s[w] += alpha * (rate - wear.brake_pad_rate_pct_s[w])
        wear._last_brake_pad_pct[w] = vs.brake_pad_pct[w]

    # Tires: physically motivated wear model. A new tyre nominally loses
    # ~6 mm over 50 000 km of mixed driving — base rate ~1.2e-4 mm/km
    # under cruise. Lateral g, longitudinal g, hot tyres, and wet/snow
    # pavement all multiply the rate; off-throttle creep adds nothing.
    avg_cell_t = mean(vs.cell_t_c)
    for w in ("fl", "fr", "rl", "rr"):
        if vs.speed_mps > 0.5:
            lat_g = abs(math.radians(vs.yaw_rate_dps) * vs.speed_mps / 9.81)
            long_g = abs(vs.accel_mps2) / 9.81
            base_mm_per_km = 1.2e-4
            lat_mult = 1.0 + lat_g ** 1.5 * 4.5
            long_mult = 1.0 + long_g * 2.0
            temp_mult = 1.0 + max(0.0, vs.tire_temp_c[w] - 80.0) / 25.0
            if vs.env.pavement == "asphalt-wet":
                pav_mult = 1.4
            elif vs.env.pavement == "snow":
                pav_mult = 0.7
            elif vs.env.pavement == "ice":
                pav_mult = 0.5
            else:
                pav_mult = 1.0
            mm_per_km = base_mm_per_km * lat_mult * long_mult * temp_mult * pav_mult
            km_per_s = vs.speed_mps / 1000.0
            inst_mm_s = mm_per_km * km_per_s
        else:
            inst_mm_s = 0.0
        wear.tire_wear_rate_mm_s[w] += alpha * (inst_mm_s - wear.tire_wear_rate_mm_s[w])
        wear.tire_tread_mm[w] = max(0.4, wear.tire_tread_mm[w] - inst_mm_s * dt)

    # Battery SoH: NCA pouch cells lose ~0.005% per equivalent-full-cycle
    # under benign conditions; hot cells (>30 °C) double that rate every
    # +15 °C (Arrhenius rule of thumb). EFC fraction = |power|·dt / (2·E_cap).
    capacity_j = PC.battery_capacity_kwh * 3.6e6
    energy_dt = abs(vs.hv_bus_a * vs.hv_bus_v) * dt
    efc_inc = energy_dt / (2.0 * capacity_j)
    soh_drop = efc_inc * 0.005 * (2 ** max(0.0, (avg_cell_t - 30.0) / 15.0))
    vs.soh_percent = max(60.0, vs.soh_percent - soh_drop)
    inst_drop_per_s = soh_drop / dt
    wear.soh_drift_rate_pct_s += alpha * (inst_drop_per_s - wear.soh_drift_rate_pct_s)

    # Motor bearing: simplified L10 contribution — rotational stress accumulates
    # with RPM × torque^(10/3) (SKF bearing-life formula, ball-bearing exponent).
    if vs.motor_rpm > 100.0:
        load = max(20.0, abs(vs.motor_torque_nm))
        K_bearing = 5.0e11
        wear.motor_bearing_hours_used += dt / 3600.0 * (vs.motor_rpm * load ** (10.0 / 3.0)) / K_bearing

    # Inverter capacitor (Arrhenius + ripple²): life halves every +10 °C above 70 °C.
    if abs(vs.inverter_current_a) > 5.0:
        stress = (abs(vs.inverter_current_a) / 100.0) ** 2 * (2 ** max(0.0, (vs.inverter_temp_c - 70.0) / 10.0))
        wear.inverter_capacitor_stress_hours += dt / 3600.0 * stress

    # Coolant operating hours
    if vs.speed_mps > 0.5 or vs.hvac_compressor_w > 100.0:
        wear.coolant_hours_used += dt / 3600.0


def project_rul(wear: WearTracker, vs: VehicleState) -> Dict[str, Any]:
    """Project remaining useful life per component from the *current* operating
    regime. These are projections, not destiny — they recompute each tick as
    the regime changes (faster wear in a hot jam, slower on the highway)."""
    out: Dict[str, Any] = {}

    brake_pads: Dict[str, Any] = {}
    for w in ("fl", "fr", "rl", "rr"):
        margin_pct = max(0.0, vs.brake_pad_pct[w] - BRAKE_PAD_EOL_PCT)
        rate = wear.brake_pad_rate_pct_s[w]
        if rate > 1e-8:
            rul_s = margin_pct / rate
            rul_km_val = rul_s * vs.speed_mps / 1000.0 if vs.speed_mps > 0.5 else None
        else:
            rul_s = 99_999 * 3600.0
            rul_km_val = None
        if vs.brake_pad_pct[w] < 30:
            severity = "alert"
        elif vs.brake_pad_pct[w] < 50:
            severity = "watch"
        else:
            severity = "ok"
        brake_pads[w] = {
            "currentPct": round1(vs.brake_pad_pct[w]),
            "wearRatePctPerS": round3(rate),
            "rulHours": int(min(99_999, rul_s / 3600.0)),
            "rulKm": int(min(99_999, rul_km_val)) if rul_km_val is not None else None,
            "severity": severity,
        }
    out["brakePads"] = brake_pads

    tires: Dict[str, Any] = {}
    for w in ("fl", "fr", "rl", "rr"):
        margin_mm = max(0.0, wear.tire_tread_mm[w] - TIRE_TREAD_EOL_MM)
        rate_mm_s = wear.tire_wear_rate_mm_s[w]
        if rate_mm_s > 1e-12:
            rul_s = margin_mm / rate_mm_s
            rul_km_val = rul_s * vs.speed_mps / 1000.0 if vs.speed_mps > 0.5 else None
        else:
            rul_s = 99_999 * 3600.0
            rul_km_val = None
        tires[w] = {
            "treadDepthMm": round3(wear.tire_tread_mm[w]),
            "wearRateMmPerS": round(rate_mm_s * 1e6) / 1e6,
            "rulHours": int(min(99_999, rul_s / 3600.0)),
            "rulKm": int(min(99_999, rul_km_val)) if rul_km_val is not None else None,
        }
    out["tires"] = tires

    if wear.soh_drift_rate_pct_s > 1e-10:
        rul_warranty_s = max(0.0, vs.soh_percent - BATTERY_WARRANTY_SOH_PCT) / wear.soh_drift_rate_pct_s
        rul_replace_s = max(0.0, vs.soh_percent - BATTERY_REPLACE_SOH_PCT) / wear.soh_drift_rate_pct_s
    else:
        rul_warranty_s = 99_999 * 3600.0
        rul_replace_s = 99_999 * 3600.0
    out["battery"] = {
        "sohPct": round3(vs.soh_percent),
        "sohDriftPctPerS": round(wear.soh_drift_rate_pct_s * 1e6) / 1e6,
        "rulToWarrantyHours": int(min(99_999, rul_warranty_s / 3600.0)),
        "rulToReplaceHours": int(min(99_999, rul_replace_s / 3600.0)),
    }

    out["motorBearing"] = {
        "hoursUsed": round3(wear.motor_bearing_hours_used),
        "rulHours": int(max(0.0, MOTOR_BEARING_L10_HOURS - wear.motor_bearing_hours_used)),
        "fractionConsumed": round3(min(1.0, wear.motor_bearing_hours_used / MOTOR_BEARING_L10_HOURS)),
    }
    out["inverterCap"] = {
        "stressHoursUsed": round3(wear.inverter_capacitor_stress_hours),
        "rulHours": int(max(0.0, INVERTER_CAP_L10_HOURS - wear.inverter_capacitor_stress_hours)),
        "fractionConsumed": round3(min(1.0, wear.inverter_capacitor_stress_hours / INVERTER_CAP_L10_HOURS)),
    }
    out["coolant"] = {
        "hoursUsed": round3(wear.coolant_hours_used),
        "rulHours": int(max(0.0, 8000.0 - wear.coolant_hours_used)),
    }
    return out


@dataclass
class VehicleState:
    """Single-source-of-truth ego state. Everything the chaos driver publishes
    on /telemetry/ingest is read from here so values stay self-consistent
    (e.g., higher speed -> higher brake-energy-rate -> hotter discs).
    """

    # ---- Kinematics ----
    speed_mps: float = 0.0
    accel_mps2: float = 0.0
    yaw_deg: float = 90.0
    yaw_rate_dps: float = 0.0
    distance_traveled_m: float = 0.0
    lat_ref: float = 12.9716
    lng_ref: float = 77.5946

    # ---- Driver inputs (latched each tick by cruise controller / overrides) ----
    throttle: float = 0.0
    brake: float = 0.0
    steering: float = 0.0  # -1..1, mapped to ±33° road wheel

    # ---- Powertrain ----
    motor_torque_nm: float = 0.0
    motor_rpm: float = 0.0
    motor_temp_stator_c: float = 38.0
    motor_temp_rotor_c: float = 42.0
    inverter_temp_c: float = 38.0
    inverter_current_a: float = 0.0
    hv_bus_v: float = 392.0
    hv_bus_a: float = 0.0
    aux_12v_v: float = 13.4

    # ---- Battery ----
    soc_percent: float = 64.0
    soh_percent: float = 96.5
    sop_kw: float = 184.0
    hv_isolation_kohm: float = 820.0
    cell_v_mv: List[int] = field(default_factory=lambda: [3700] * 96)
    cell_t_c: List[float] = field(default_factory=lambda: [28.0] * 96)

    # ---- Brakes (per wheel) ----
    brake_temp_c: Dict[str, float] = field(default_factory=lambda: {"fl": 40.0, "fr": 40.0, "rl": 40.0, "rr": 40.0})
    brake_pad_pct: Dict[str, float] = field(default_factory=lambda: {"fl": 78.0, "fr": 78.0, "rl": 78.0, "rr": 78.0})
    brake_pressure_bar_front: float = 0.0
    brake_pressure_bar_rear: float = 0.0

    # ---- Wheels / tires ----
    wheel_rpm: Dict[str, float] = field(default_factory=_wheel_dict_factory)
    tire_temp_c: Dict[str, float] = field(default_factory=lambda: {"fl": 28.0, "fr": 28.0, "rl": 28.0, "rr": 28.0})
    tpms_kpa: Dict[str, float] = field(default_factory=lambda: {"fl": 230.0, "fr": 232.0, "rl": 228.0, "rr": 231.0})
    hub_temp_c: Dict[str, float] = field(default_factory=lambda: {"fl": 42.0, "fr": 42.0, "rl": 40.0, "rr": 40.0})

    # ---- Cooling ----
    coolant_motor_c: float = 38.0
    coolant_battery_c: float = 28.0
    coolant_inverter_c: float = 36.0

    # ---- Cabin ----
    cabin_temp_c: float = 22.0
    cabin_humidity_pct: float = 45.0
    co2_ppm: float = 620.0
    pm25_ugm3: float = 11.0

    # ---- Environment + HVAC (driven by real weather + sun angle) ----
    env: EnvironmentSnapshot = field(default_factory=EnvironmentSnapshot)
    ambient_temp_c: float = 28.0          # mirrors env.ambient_temp_c; held here for fast access
    pavement_temp_c: float = 38.0          # asphalt heats above ambient under sun
    solar_irradiance_w_m2: float = 0.0     # instantaneous DNI
    solar_altitude_deg: float = 45.0
    headwind_mps: float = 0.0              # component of wind opposing motion
    crosswind_mps: float = 0.0
    cabin_solar_gain_w: float = 0.0
    cabin_conduction_w: float = 0.0
    hvac_setpoint_c: float = 22.0
    hvac_ac_on: bool = True
    hvac_compressor_w: float = 0.0
    hvac_blower_w: float = 350.0
    hvac_cop: float = 3.0
    hvac_recirc: bool = True
    # Per-frame snapshot of derived totals (read back into telemetry)
    aux_load_w: float = 0.0                # HVAC + electronics
    regen_kw: float = 0.0
    odometer_km: float = 0.0
    scenario_start_unix: float = 0.0

    # ---- Bookkeeping ----
    last_t: float = 0.0
    # TPMS baseline for ideal-gas pressure-vs-temp: P/T = const.
    _tpms_base_kpa: Dict[str, float] = field(default_factory=lambda: {"fl": 230.0, "fr": 232.0, "rl": 228.0, "rr": 231.0})
    _tpms_base_t_k: float = 28.0 + 273.15


def _cruise_controller(target_mps: float, current_mps: float) -> tuple[float, float]:
    """Proportional cruise: throttle when below target, brake when above. The
    constants are tuned so a 30 kph target from rest reaches the band in ~5 s
    with realistic accel."""
    err = target_mps - current_mps
    if err > 0.3:
        throttle = clamp(0.18 + err * 0.07, 0.0, 1.0)
        brake = 0.0
    elif err < -0.3:
        throttle = 0.0
        brake = clamp(-err * 0.10, 0.0, 1.0)
    else:
        # Tight band: light coasting / regen
        throttle = clamp(0.10 + err * 0.04, 0.0, 0.3)
        brake = 0.0
    return throttle, brake


def step_physics(state: VehicleState, t: float, rng: random.Random) -> None:
    """Advance the integrated state by (t - state.last_t) seconds. Drives
    EVERY observable the dashboard reads — speed, accel, motor heat, brake
    temp, pad wear, cell voltages, TPMS, coolant — so the panels move
    together the way they would on a real vehicle.
    """
    dt = max(0.0, t - state.last_t)
    state.last_t = t
    if dt <= 0:
        return

    # ---- 1) Decide control inputs from scripted scenario + cruise law ----
    # Scripted overrides win (emergency brake, MRM creep, parking).
    override_throttle: Optional[float] = None
    override_brake: Optional[float] = None
    override_steer: Optional[float] = None

    if _in_window(t, EMERGENCY_STOPS) is not None:
        # Pedestrian dart-out emergency brake
        override_throttle, override_brake = 0.0, 0.92
    elif 295.0 <= t < 330.0:
        # R157 rung 2 → MRM lateral creep; tiny torque to keep ~8 kph
        override_throttle = 0.18 if state.speed_mps < 2.0 else 0.04
        override_brake = 0.0
        override_steer = 0.10  # creep toward shoulder
    elif _in_window(t, RED_LIGHTS) is not None:
        override_throttle, override_brake = 0.0, 0.55

    target_kph = _target_speed_for(t)
    target_mps = target_kph / 3.6
    if override_throttle is not None:
        throttle = override_throttle
        brake = override_brake if override_brake is not None else 0.0
    else:
        throttle, brake = _cruise_controller(target_mps, state.speed_mps)

    # Lane following: gentle sinusoidal heading correction; lane-shift event
    # nudges harder during the construction-zone phase.
    if override_steer is not None:
        steering = override_steer
    elif 155.0 <= t < 180.0:
        # Mandatory lane-shift over 12 m at 0.18 rad/s briefly
        steering = 0.18 if 158.0 <= t < 162.0 else math.sin(t / 9) * 0.02
    else:
        steering = math.sin(t / 11) * 0.02
    state.throttle = throttle
    state.brake = brake
    state.steering = steering

    # ---- 1b) Resolve environment forces for this tick ----
    # Wind component along heading: positive = headwind (opposes motion).
    rel_wind_deg = (state.env.wind_dir_deg - state.yaw_deg) % 360.0
    state.headwind_mps = -state.env.wind_speed_mps * math.cos(math.radians(rel_wind_deg))
    state.crosswind_mps = state.env.wind_speed_mps * math.sin(math.radians(rel_wind_deg))
    # Air density: ideal gas with cabin altitude assumed ~0; use ambient temp.
    rho_air = (state.env.pressure_hpa * 100.0) / (287.05 * (state.ambient_temp_c + 273.15))
    # Pavement state and grip: wet/snow/ice multiply rolling resistance and
    # cap effective braking force at μ·m·g (cannot brake harder than friction
    # will allow).
    grip_mu = state.env.pavement_grip_mu
    rr_mult = 1.0
    if state.env.pavement == "asphalt-wet":
        rr_mult = 1.25
    elif state.env.pavement == "snow":
        rr_mult = 1.6
    elif state.env.pavement == "ice":
        rr_mult = 1.1
    max_traction_force = grip_mu * PC.mass_kg * PC.g_m_s2  # N

    # ---- 2) Longitudinal forces (Newton's second law) ----
    f_drive_raw = throttle * PC.max_motor_torque_total_nm * PC.motor_efficiency / PC.wheel_radius_m
    f_drive = min(f_drive_raw, max_traction_force)  # cannot drive through ice
    f_brake_raw = brake * PC.max_brake_force_total_n
    f_brake = min(f_brake_raw, max_traction_force)  # ABS-equivalent: cap at μ·m·g
    sign_v = 1.0 if state.speed_mps > 0.05 else 0.0
    # Effective forward airspeed = ground speed + headwind component
    airspeed = max(0.0, state.speed_mps + state.headwind_mps)
    f_drag = 0.5 * rho_air * PC.drag_coeff * PC.frontal_area_m2 * airspeed ** 2 * sign_v
    f_roll = PC.rolling_resistance * rr_mult * PC.mass_kg * PC.g_m_s2 * sign_v
    f_net = f_drive - f_brake * sign_v - f_drag - f_roll
    state.accel_mps2 = f_net / PC.mass_kg
    new_speed = state.speed_mps + state.accel_mps2 * dt
    if state.speed_mps > 0 and new_speed < 0:
        # Brake-to-rest: clip at zero (no roll-back)
        state.accel_mps2 = -state.speed_mps / dt
        new_speed = 0.0
    state.speed_mps = max(0.0, new_speed)

    # ---- 3) Lateral kinematics (bicycle model) ----
    state.distance_traveled_m += state.speed_mps * dt
    if state.speed_mps > 1.0:
        max_steer_rad = math.radians(33.0)
        steer_rad = steering * max_steer_rad
        yaw_rate_rad_s = (state.speed_mps * math.tan(steer_rad)) / PC.wheelbase_m
        state.yaw_rate_dps = math.degrees(yaw_rate_rad_s)
        state.yaw_deg = (state.yaw_deg + state.yaw_rate_dps * dt) % 360.0
    else:
        state.yaw_rate_dps = 0.0

    # ---- 4) Powertrain electrical + torque ----
    omega_wheel = state.speed_mps / PC.wheel_radius_m  # rad/s
    state.motor_rpm = omega_wheel * 60.0 / (2 * math.pi) * PC.final_drive_ratio
    state.motor_torque_nm = f_drive * PC.wheel_radius_m / max(1.0, PC.final_drive_ratio)
    p_motor_w = max(0.0, f_drive * state.speed_mps / PC.motor_efficiency)
    # Regen is disabled at low SoC (>95%, no headroom) and very cold cells
    # (<5°C, lithium plating risk). Otherwise recovers ~40% of brake energy.
    avg_cell_t_pre = mean(state.cell_t_c)
    regen_enabled = state.soc_percent < 95.0 and avg_cell_t_pre > 5.0
    regen_eff = 0.40 if regen_enabled else 0.0
    p_regen_w = regen_eff * f_brake * state.speed_mps if state.speed_mps > 1.0 else 0.0
    state.regen_kw = p_regen_w / 1000.0

    # HVAC compressor: cooling load scales with cabin/ambient delta + solar
    # gain. AC stays ON at idle (red light, MRM creep) — that's the user's
    # 50°C-jam pain point: pack drains even when motor is off.
    if state.hvac_ac_on:
        cabin_err = state.cabin_temp_c - state.hvac_setpoint_c
        # Ambient-derated COP: at 25°C ambient COP≈3.4; at 50°C drops to ~2.0
        state.hvac_cop = clamp(3.6 - (state.ambient_temp_c - 25.0) * 0.05, 1.5, 4.0)
        # Cooling power demand (thermal W) based on cabin overshoot + a
        # baseline pull-down when ambient bakes everything.
        cooling_demand_w = max(0.0, cabin_err) * 700.0 + max(0.0, state.ambient_temp_c - 25.0) * 70.0
        cooling_demand_w = min(cooling_demand_w, 6000.0)
        state.hvac_compressor_w = cooling_demand_w / state.hvac_cop
    else:
        state.hvac_compressor_w = 0.0
        state.hvac_cop = 1.0
    # Other 12V/HV aux: blower, lights (day or night), DCDC, ECUs, AURIX,
    # camera/lidar electronics, infotainment, 5G modem.
    p_electronics_w = 850.0 + (200.0 if not state.env.is_day else 0.0)
    state.aux_load_w = state.hvac_compressor_w + state.hvac_blower_w + p_electronics_w
    p_net_w = max(-150_000.0, p_motor_w + state.aux_load_w - p_regen_w)
    state.hv_bus_v = 380.0 + (state.soc_percent - 50.0) * 0.6
    state.hv_bus_a = p_net_w / max(50.0, state.hv_bus_v)
    state.inverter_current_a = abs(state.hv_bus_a)

    # ---- 5) Battery SoC + per-cell voltage and heat ----
    energy_j = p_net_w * dt
    capacity_j = PC.battery_capacity_kwh * 3.6e6
    state.soc_percent = clamp(state.soc_percent - (energy_j / capacity_j) * 100.0, 5.0, 100.0)
    cell_current = state.inverter_current_a  # cells in series share current
    p_loss_per_cell = (cell_current ** 2) * (PC.cell_internal_r_mohm / 1000.0)
    avg_cell_t = mean(state.cell_t_c)
    for i in range(PC.cell_count):
        bad = (i == 7)  # one weak cell that sags harder under load
        # Heating: I²R loss minus conduction to battery coolant
        cool_w = 0.9 * max(0.0, state.cell_t_c[i] - state.coolant_battery_c)
        dT = (p_loss_per_cell * (1.25 if bad else 1.0) - cool_w) * dt / 220.0
        state.cell_t_c[i] = clamp(state.cell_t_c[i] + dT, state.ambient_temp_c - 1.0, 65.0)
        # Voltage: OCV(SoC) curve minus I·R sag (bad cell sags more)
        ocv_mv = 3300.0 + (state.soc_percent / 100.0) * 800.0
        i_drop_mv = cell_current * PC.cell_internal_r_mohm * (1.7 if bad else 1.0)
        state.cell_v_mv[i] = int(ocv_mv - i_drop_mv)

    # ---- 6) Motor + inverter heat ----
    p_loss_motor = p_motor_w * (1.0 - PC.motor_efficiency)
    motor_cool = 70.0 * max(0.0, state.motor_temp_stator_c - state.coolant_motor_c)
    dT_stator = (p_loss_motor - motor_cool) * dt / PC.motor_thermal_mass_jk
    state.motor_temp_stator_c = clamp(state.motor_temp_stator_c + dT_stator, state.ambient_temp_c, 200.0)
    # Rotor leads stator by a few degrees under load
    state.motor_temp_rotor_c = clamp(state.motor_temp_stator_c + 6.0 + abs(state.motor_torque_nm) * 0.01, state.ambient_temp_c, 220.0)
    p_loss_inv = (state.inverter_current_a ** 2) * 0.0007
    inv_cool = 40.0 * max(0.0, state.inverter_temp_c - state.coolant_inverter_c)
    state.inverter_temp_c = clamp(state.inverter_temp_c + (p_loss_inv - inv_cool) * dt / PC.inverter_thermal_mass_jk, state.ambient_temp_c, 130.0)

    # ---- 7) Brake heat + pad wear (per wheel) ----
    p_brake_total = f_brake * state.speed_mps  # mechanical power dissipated
    front_share = 0.65
    p_per_front = p_brake_total * front_share / 2.0
    p_per_rear = p_brake_total * (1.0 - front_share) / 2.0
    p_per = {"fl": p_per_front, "fr": p_per_front, "rl": p_per_rear, "rr": p_per_rear}
    for w in ("fl", "fr", "rl", "rr"):
        air_cool = (16.0 + 0.7 * state.speed_mps) * max(0.0, state.brake_temp_c[w] - state.ambient_temp_c)
        dT_b = (p_per[w] - air_cool) * dt / PC.brake_thermal_mass_per_wheel_jk
        state.brake_temp_c[w] = clamp(state.brake_temp_c[w] + dT_b, state.ambient_temp_c, 650.0)
        # Pad wear: scales with brake²·speed; pad fade above 200 °C accelerates wear.
        fade_factor = 1.0 + max(0.0, state.brake_temp_c[w] - 200.0) / 400.0
        wear_rate_pct_s = (brake ** 2) * (state.speed_mps / 30.0) * fade_factor * 0.0004
        state.brake_pad_pct[w] = max(15.0, state.brake_pad_pct[w] - wear_rate_pct_s * dt)
    state.brake_pressure_bar_front = brake * 110.0
    state.brake_pressure_bar_rear = brake * 80.0

    # ---- 8) Wheels + tires (TPMS via ideal gas P/T = const) ----
    rpm = omega_wheel * 60.0 / (2 * math.pi)
    for w in ("fl", "fr", "rl", "rr"):
        # Slight per-wheel jitter (road camber, sensor noise)
        jitter = 1.0 + 0.0008 * math.sin(t * 1.4 + ord(w[0]) * 0.7)
        state.wheel_rpm[w] = rpm * jitter
        # Tire heat: rolling-resistance dissipation per tire plus a sliver of
        # brake-disc conduction through the hub.
        p_roll = (PC.rolling_resistance * PC.mass_kg * PC.g_m_s2 / 4.0) * state.speed_mps
        p_hub_in = 0.05 * (state.brake_temp_c[w] - state.tire_temp_c[w])
        tire_cool = (5.5 + 0.4 * state.speed_mps) * max(0.0, state.tire_temp_c[w] - state.ambient_temp_c)
        state.tire_temp_c[w] = clamp(state.tire_temp_c[w] + (p_roll + p_hub_in - tire_cool) * dt / PC.tire_thermal_mass_jk, state.ambient_temp_c - 1.0, 110.0)
        T_k = state.tire_temp_c[w] + 273.15
        state.tpms_kpa[w] = state._tpms_base_kpa[w] * (T_k / state._tpms_base_t_k)
        # Hub temperature lags brake temp toward equilibrium
        state.hub_temp_c[w] = state.hub_temp_c[w] + (state.brake_temp_c[w] - state.hub_temp_c[w]) * min(1.0, 0.4 * dt)

    # ---- 9) Coolant loops (motor + battery; radiator effectiveness scales with airspeed) ----
    radiator_motor = 220.0 * (1.0 + state.speed_mps / 25.0) * max(0.0, state.coolant_motor_c - state.ambient_temp_c)
    motor_in = motor_cool + inv_cool  # heat just dumped from motor + inverter
    state.coolant_motor_c = clamp(state.coolant_motor_c + (motor_in - radiator_motor) * dt / PC.coolant_motor_thermal_mass_jk, state.ambient_temp_c, 110.0)
    state.coolant_inverter_c = state.coolant_motor_c - 4.0
    batt_heat_in = 96.0 * 0.9 * max(0.0, avg_cell_t - state.coolant_battery_c)
    radiator_batt = 130.0 * (1.0 + state.speed_mps / 30.0) * max(0.0, state.coolant_battery_c - state.ambient_temp_c)
    state.coolant_battery_c = clamp(state.coolant_battery_c + (batt_heat_in - radiator_batt) * dt / PC.coolant_battery_thermal_mass_jk, state.ambient_temp_c, 55.0)

    # ---- 10) Solar + pavement temperature ----
    # Compute solar altitude from current wall-clock (scenario_start_unix +
    # elapsed t). Use lat from the env snapshot.
    wall_unix = state.scenario_start_unix + t if state.scenario_start_unix > 0 else time.time()
    utc = datetime.fromtimestamp(wall_unix, tz=timezone.utc)
    # Hour at the env longitude (~UTC + lng/15). Good enough for sun angle.
    hour_local = (utc.hour + utc.minute / 60.0 + utc.second / 3600.0 + state.env.lng / 15.0) % 24.0
    day_of_year = utc.timetuple().tm_yday
    state.solar_altitude_deg = solar_altitude_deg(state.env.lat, hour_local, day_of_year)
    state.solar_irradiance_w_m2 = solar_irradiance_w_m2(
        state.solar_altitude_deg, state.env.cloud_cover_pct, state.env.is_day
    )

    # Pavement temp: asphalt absorbs solar and is poorly insulated; on a clear
    # 40°C day, asphalt reaches ~60-70°C. Approximation: ambient + irradiance
    # × absorption / convective-loss-coeff.
    p_avg_t = state.ambient_temp_c + state.solar_irradiance_w_m2 * 0.045
    # Lag toward equilibrium (asphalt thermal mass)
    state.pavement_temp_c = state.pavement_temp_c + (p_avg_t - state.pavement_temp_c) * min(1.0, 0.02 * dt)

    # ---- 11) Cabin thermal balance ----
    # Solar gain through glass + body absorption
    state.cabin_solar_gain_w = (
        state.solar_irradiance_w_m2 * PC.cabin_glass_area_m2 * PC.cabin_glass_solar_transmissivity
        + state.solar_irradiance_w_m2 * PC.cabin_surface_area_m2 * 0.25 * PC.cabin_solar_absorptance
    )
    # Conduction loss through bodywork to ambient (positive = into cabin)
    state.cabin_conduction_w = PC.cabin_insulation_w_per_k * (state.ambient_temp_c - state.cabin_temp_c)
    # Occupants: each adds ~115 W sensible heat
    p_occupants_w = 1 * 115.0
    # HVAC cooling power (thermal) delivered to cabin air (positive removes heat)
    p_hvac_cool_w = state.hvac_compressor_w * state.hvac_cop if state.hvac_ac_on else 0.0
    p_cabin_net_w = state.cabin_solar_gain_w + state.cabin_conduction_w + p_occupants_w - p_hvac_cool_w
    state.cabin_temp_c = clamp(state.cabin_temp_c + p_cabin_net_w * dt / PC.cabin_thermal_mass_jk, -10.0, 70.0)

    # Cabin humidity tracks env (slow drift). Recirc keeps it lower than fresh.
    target_humidity = state.env.humidity_pct * (0.4 if state.hvac_recirc else 0.85)
    state.cabin_humidity_pct = state.cabin_humidity_pct + (target_humidity - state.cabin_humidity_pct) * min(1.0, 0.02 * dt)

    # CO₂: respiration in, ventilation out. Recirc traps CO₂; fresh-air mode
    # ventilates aggressively. At idle in a jam with recirc on, CO₂ climbs
    # toward 1500-2000 ppm in 10 minutes — measurable, fatigue-inducing.
    co2_breath = 1 * 8.0  # ppm/s per occupant
    if state.hvac_recirc:
        vent_rate = 0.0008 * (1.0 + state.speed_mps / 80.0)  # leakage only
    else:
        vent_rate = 0.0050 * (1.0 + state.speed_mps / 30.0)  # fresh-air exchange
    vent_out = (state.co2_ppm - 420.0) * vent_rate
    state.co2_ppm = clamp(state.co2_ppm + (co2_breath - vent_out) * dt, 420.0, 5000.0)

    # Cabin PM2.5: env baseline filtered through HEPA-grade cabin filter (90%
    # reduction) when HVAC is on. When AC is off, equilibrates with outside.
    if state.hvac_ac_on:
        target_pm25 = state.env.pm25_ugm3 * 0.10
    else:
        target_pm25 = state.env.pm25_ugm3 * (0.85 if state.hvac_recirc else 0.95)
    state.pm25_ugm3 = state.pm25_ugm3 + (target_pm25 - state.pm25_ugm3) * min(1.0, 0.05 * dt)

    # ---- 12) Battery SoP/isolation drift + odometer ----
    # SoP is the power the pack can DELIVER right now. Penalised by hot cells
    # (above 30°C) AND cold cells (below 10°C, ionic mobility drops). At 50°C
    # ambient with bad thermal management the pack derates to ~120 kW.
    cell_t_penalty = max(0.0, avg_cell_t - 30.0) * 0.5 + max(0.0, 10.0 - avg_cell_t) * 1.2
    state.sop_kw = clamp(190.0 - cell_t_penalty - (100.0 - state.soc_percent) * 0.05, 60.0, 200.0)
    # Isolation resistance drops in humid + hot conditions
    iso_humidity_penalty = max(0.0, state.env.humidity_pct - 60.0) * 2.0
    state.hv_isolation_kohm = clamp(
        850.0 - max(0.0, avg_cell_t - 35.0) * 1.5 - iso_humidity_penalty + rng.uniform(-2.0, 2.0),
        200.0, 900.0,
    )
    state.odometer_km = state.distance_traveled_m / 1000.0
    # Ambient temp drift: slowly track env's value (refreshed by fetch_env)
    state.ambient_temp_c = state.ambient_temp_c + (state.env.ambient_temp_c - state.ambient_temp_c) * min(1.0, 0.001 * dt)


def build_frame(t: float, booking_id: str, rng: random.Random, vs: VehicleState, wt: WearTracker) -> Dict[str, Any]:
    # All physical fields below derive from the integrated VehicleState — the
    # cruise controller in step_physics decides throttle/brake/steering, the
    # forces compute speed, and every sensor reads from that single source of
    # truth so the dashboard stays self-consistent (high speed -> hot brakes
    # -> hotter coolant -> rising tire pressure, etc).
    speed_kph = vs.speed_mps * 3.6
    speed_mps = vs.speed_mps
    throttle = vs.throttle
    brake = vs.brake
    steering = round3(vs.steering)
    motor_torque = vs.motor_torque_nm
    motor_rpm = vs.motor_rpm
    inverter_current = vs.inverter_current_a
    hv_bus = vs.hv_bus_v
    hv_cells_mv = list(vs.cell_v_mv)
    hv_cells_temp_c = [round1(c) for c in vs.cell_t_c]
    # Worst (hottest, most worn) front pad surfaces on the dashboard "brake pad
    # front %" headline metric.
    brake_pad_front = min(vs.brake_pad_pct["fl"], vs.brake_pad_pct["fr"])
    hv_soc = vs.soc_percent
    coolant_motor = vs.coolant_motor_c
    coolant_battery = vs.coolant_battery_c
    coolant_inverter = vs.coolant_inverter_c
    wheel_rpm_base = vs.wheel_rpm["fl"]  # all 4 already integrated; use FL as headline

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

    # Heading comes from the integrated bicycle model in step_physics. No
    # local accumulator — the state owns it.
    heading_deg = vs.yaw_deg % 360.0
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
        # GPS derived from integrated displacement at the route's reference
        # latitude (1° lat ≈ 111 km; 1° lng at 13°N ≈ 108 km).
        "gps": {
            "lat": round(vs.lat_ref + (vs.distance_traveled_m * math.sin(math.radians(vs.yaw_deg)) / 111_000.0), 6),
            "lng": round(vs.lng_ref + (vs.distance_traveled_m * math.cos(math.radians(vs.yaw_deg)) / 108_000.0), 6),
        },
        # Accel from integrated longitudinal accel + lateral from yaw rate
        "accel": {
            "x": round3(vs.accel_mps2),
            "y": round3(math.radians(vs.yaw_rate_dps) * vs.speed_mps),
            "z": round3(9.81),
        },
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
            "accel": {
                "x": round3(vs.accel_mps2),
                "y": round3(math.radians(vs.yaw_rate_dps) * vs.speed_mps),
                "z": round3(9.81),
            },
            "gyro": {
                "x": round3(rng.gauss(0.0, 0.002)),
                "y": round3(rng.gauss(0.0, 0.002)),
                "z": round3(math.radians(vs.yaw_rate_dps)),
            },
            "magneto": {"x": 28.4, "y": -1.1, "z": 42.2},
            "tempC": round1(vs.cabin_temp_c + 12.0),
            "biasInstabilityDegHr": 0.05,
        },
        "wheels": {
            "rpm": {w: round1(vs.wheel_rpm[w]) for w in ("fl", "fr", "rl", "rr")},
            "hubTempC": {w: round1(vs.hub_temp_c[w]) for w in ("fl", "fr", "rl", "rr")},
            "tpmsKpa": {w: int(round(vs.tpms_kpa[w])) for w in ("fl", "fr", "rl", "rr")},
            "tpmsTempC": {w: round1(vs.tire_temp_c[w]) for w in ("fl", "fr", "rl", "rr")},
        },
        "chassis": {
            "steeringAngleDeg": round1(vs.steering * 33.0),  # ±33° road-wheel range
            "steeringTorqueNm": round1(steering * 4.0 + math.sin(t / 6) * 0.4),
            "brakePressureBar": {
                "front": round1(vs.brake_pressure_bar_front),
                "rear": round1(vs.brake_pressure_bar_rear),
            },
            "rideHeightMm": {"fl": 152, "fr": 152, "rl": 154, "rr": 154},
            # Friction drops a hair when tires get hot or pavement state changes
            "frictionCoef": round3(0.88 - max(0.0, mean(vs.tire_temp_c.values()) - 65.0) / 200.0 + rng.uniform(-0.005, 0.005)),
        },
        "powertrain": {
            "motorFront": {
                "torqueNm": round1(motor_torque * 0.45),
                "tempStatorC": round1(vs.motor_temp_stator_c),
                "tempRotorC": round1(vs.motor_temp_rotor_c),
                "rpm": round1(motor_rpm),
            },
            "motorRear": {
                "torqueNm": round1(motor_torque * 0.55),
                "tempStatorC": round1(vs.motor_temp_stator_c + 1.5),
                "tempRotorC": round1(vs.motor_temp_rotor_c + 1.5),
                "rpm": round1(motor_rpm),
            },
            "inverterTempC": round1(vs.inverter_temp_c),
            "inverterCurrentA": round1(inverter_current),
            "hvBusV": round1(hv_bus),
            "hvBusA": round1(vs.hv_bus_a),
            "aux12vV": round1(vs.aux_12v_v + rng.uniform(-0.04, 0.04)),
            "hvCellsMv": hv_cells_mv,
            "hvCellsTempC": hv_cells_temp_c,
            "hvIsolationKohm": int(vs.hv_isolation_kohm),
            "hvSocPercent": round1(hv_soc),
            "hvSohPercent": round1(vs.soh_percent),
            "hvSopKw": round1(vs.sop_kw),
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
            "cabinTempC": round1(vs.cabin_temp_c),
            "cabinHumidityPct": round1(vs.cabin_humidity_pct + math.sin(t / 25) * 2.0),
            "co2Ppm": int(vs.co2_ppm),
            "pm25Ugm3": round1(vs.pm25_ugm3 + rng.uniform(-0.5, 0.5)),
            "driverAttention": {
                "gazeOnRoad": round3(0.94 + rng.random() * 0.04),
                "eyesClosed": False,
                "handsOnWheel": True,
                "seatBelt": True,
            },
            "occupants": 1,
        },
        "environment": {
            "weather": vs.env.weather_label,
            "visibilityM": int(round(vs.env.visibility_m)),
            "ambientTempC": round1(vs.ambient_temp_c),
            "ambientHumidityPct": round1(vs.env.humidity_pct),
            "windKph": round1(vs.env.wind_speed_mps * 3.6),
            "pavement": vs.env.pavement,
            "timeOfDay": "day" if vs.env.is_day else "night",
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

    # Live HVAC + solar + pavement temperature surface. Passthrough block
    # (LiveTelemetryFrameSchema uses .passthrough(), so the dashboard's
    # cabin/environment panels see these without schema changes).
    frame["hvac"] = {
        "acOn": vs.hvac_ac_on,
        "setpointC": round1(vs.hvac_setpoint_c),
        "compressorW": int(round(vs.hvac_compressor_w)),
        "blowerW": int(round(vs.hvac_blower_w)),
        "cop": round3(vs.hvac_cop),
        "recirc": vs.hvac_recirc,
        "auxLoadW": int(round(vs.aux_load_w)),
        "regenKw": round1(vs.regen_kw),
        "modeReason": (
            "max-cool"
            if vs.cabin_temp_c - vs.hvac_setpoint_c > 5.0
            else "cool"
            if vs.cabin_temp_c - vs.hvac_setpoint_c > 0.5
            else "idle"
        ),
    }
    frame["envDetail"] = {
        "weatherSource": vs.env.source,
        "weatherCode": vs.env.weather_code,
        "cloudCoverPct": round1(vs.env.cloud_cover_pct),
        "pressureHpa": round1(vs.env.pressure_hpa),
        "windDirDeg": round1(vs.env.wind_dir_deg),
        "headwindMps": round1(vs.headwind_mps),
        "crosswindMps": round1(vs.crosswind_mps),
        "solarAltitudeDeg": round1(vs.solar_altitude_deg),
        "solarIrradianceWm2": int(round(vs.solar_irradiance_w_m2)),
        "uvIndex": round1(vs.env.uv_index),
        "pm25EnvUgm3": round1(vs.env.pm25_ugm3),
        "pm10EnvUgm3": round1(vs.env.pm10_ugm3),
        "pavementTempC": round1(vs.pavement_temp_c),
        "pavementGripMu": round3(vs.env.pavement_grip_mu),
        "cabinSolarGainW": int(round(vs.cabin_solar_gain_w)),
        "cabinConductionW": int(round(vs.cabin_conduction_w)),
        "isDay": vs.env.is_day,
    }
    frame["odometerKm"] = round3(vs.odometer_km)

    # Wear & RUL projections — current rates extrapolated to end-of-life
    # thresholds under the present operating regime. Each tick re-projects,
    # so the numbers chase reality as the scenario shifts (faster wear in a
    # hot jam, slower on the highway).
    frame["wear"] = project_rul(wt, vs)

    # BMS history — cycle count, last balance, runaway risk
    frame["bmsHistory"] = {
        "cycleCountTotal": int(412 + (t / 3600) * 0.1),
        "depthOfDischargePct": round1(100 - hv_soc),
        "balanceDecisionsLastHour": int(rng.random() * 4),
        "lastBalanceAtS": round1(t - 38 - rng.random() * 200),
        "thermalRunawayRiskScore": round3(0.002 + (min(hv_cells_mv) < 3500) * 0.04),
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
    lat: Optional[float] = None,
    lng: Optional[float] = None,
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
    # Single-source-of-truth physics state. Reset on loop restart.
    # If the caller passed live coordinates (browser geolocation), use them;
    # otherwise default to Bangalore-Indiranagar. Open-Meteo current weather
    # + air-quality is fetched once per scenario start — everything thermal
    # plays off that snapshot.
    route_lat = lat if lat is not None else 12.9716
    route_lng = lng if lng is not None else 77.5946
    if log:
        log(f"[chaos] route origin: lat={route_lat:.4f} lng={route_lng:.4f} "
            f"({'live-location' if lat is not None else 'fallback-bangalore'})")
    env_snapshot = fetch_environment(route_lat, route_lng, _log)
    vs = VehicleState(env=env_snapshot)
    vs.lat_ref = route_lat
    vs.lng_ref = route_lng
    vs.ambient_temp_c = env_snapshot.ambient_temp_c
    # On a cold-soaked vehicle the cabin starts AT ambient (it's been baking
    # in the sun or chilling overnight). HVAC has to pull it to setpoint.
    vs.cabin_temp_c = env_snapshot.ambient_temp_c
    vs.cabin_humidity_pct = env_snapshot.humidity_pct * 0.6
    vs.pm25_ugm3 = env_snapshot.pm25_ugm3 * 0.3
    # Coolant starts at ambient too (overnight cold-soak)
    vs.coolant_motor_c = max(env_snapshot.ambient_temp_c, 25.0)
    vs.coolant_battery_c = max(env_snapshot.ambient_temp_c - 4.0, 20.0)
    vs.coolant_inverter_c = vs.coolant_motor_c
    vs.motor_temp_stator_c = max(env_snapshot.ambient_temp_c, 25.0)
    vs.motor_temp_rotor_c = vs.motor_temp_stator_c + 2.0
    vs.inverter_temp_c = vs.coolant_inverter_c
    # Tires + brakes baseline at pavement / ambient
    for w in ("fl", "fr", "rl", "rr"):
        vs.brake_temp_c[w] = env_snapshot.ambient_temp_c + 10.0
        vs.tire_temp_c[w] = env_snapshot.ambient_temp_c + 2.0
        vs.hub_temp_c[w] = env_snapshot.ambient_temp_c + 14.0
    # Cell temps start at ambient (overnight equilibrium)
    for i in range(PC.cell_count):
        vs.cell_t_c[i] = env_snapshot.ambient_temp_c
    vs.scenario_start_unix = time.time()
    # Wear tracker — pure observer of vs; projects RUL each tick.
    wt = WearTracker()
    for w in ("fl", "fr", "rl", "rr"):
        wt._last_brake_pad_pct[w] = vs.brake_pad_pct[w]

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
                    # Re-fetch weather on loop restart (it may have changed)
                    env_snapshot = fetch_environment(12.9716, 77.5946, _log)
                    vs = VehicleState(env=env_snapshot)
                    vs.ambient_temp_c = env_snapshot.ambient_temp_c
                    vs.cabin_temp_c = env_snapshot.ambient_temp_c
                    vs.coolant_motor_c = max(env_snapshot.ambient_temp_c, 25.0)
                    vs.coolant_battery_c = max(env_snapshot.ambient_temp_c - 4.0, 20.0)
                    vs.coolant_inverter_c = vs.coolant_motor_c
                    vs.scenario_start_unix = time.time()
                    wt = WearTracker()
                    for w in ("fl", "fr", "rl", "rr"):
                        wt._last_brake_pad_pct[w] = vs.brake_pad_pct[w]
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

            # Advance physics by (t - vs.last_t); every observable downstream
            # reads from `vs` so the panels move together. Wear/RUL tracker
            # is a pure observer that runs after physics each tick.
            step_physics(vs, t, rng)
            update_wear(wt, vs, t)
            frame = build_frame(t, booking, rng, vs, wt)
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
