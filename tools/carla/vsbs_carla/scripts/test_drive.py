# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Web-triggered autonomous test-drive bridge.

Spawned by the API when a user clicks the home-page "Start autonomous
test drive" button. Drives a random ego in CARLA via BasicAgent, injects
a random fault after a brief warm-up, predicts the RUL, reroutes to the
nearest of two service centres when act-soon is breached, and halts +
requests a tow if criticality is reached before arrival.

All telemetry and events are streamed to the live-hub through the
existing /v1/autonomy/{bookingId}/{telemetry,events}/ingest endpoints.
The dashboard at /autonomy/{bookingId} subscribes via SSE and renders
without any further wiring.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import os
import random
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

LOG = logging.getLogger("vsbs_carla.test_drive")


# --- CARLA agents bootstrap (BasicAgent ships outside the wheel) -----------


def _ensure_agents_on_path() -> bool:
    """CARLA's agents/ dir is not part of the carla wheel — add it manually."""
    candidates = [
        os.environ.get("CARLA_AGENTS_PATH"),
        r"C:\Users\SPANDAN\Downloads\CARLA_0.9.16\PythonAPI\carla",
        "/opt/carla/PythonAPI/carla",
    ]
    for path in candidates:
        if path and os.path.isdir(path) and path not in sys.path:
            sys.path.insert(0, path)
    try:
        from agents.navigation.basic_agent import BasicAgent  # type: ignore[import-not-found]  # noqa: F401
        return True
    except Exception as err:
        LOG.warning("BasicAgent not importable: %s", err)
        return False


_AGENTS_OK = _ensure_agents_on_path()
import carla  # type: ignore[import-not-found]
from agents.navigation.basic_agent import BasicAgent  # type: ignore[import-not-found]

from ..faults import VirtualState
from ..live_frame import LiveFrameBuilder
from ..predictor_model import load_predictor

# Default location for the trained model; set CARLA_PREDICTOR_MODEL env
# to override or pass --model on the CLI. If absent, the bridge falls
# back to the linear OnlineRulPredictor.
HERE_THIS = os.path.dirname(os.path.abspath(__file__))
VSBS_TC_ROOT = os.path.normpath(os.path.join(HERE_THIS, "..", ".."))
# Prefer the quantile MLP (.pt) when present; predictor_model falls back
# to the XGB JSON (legacy point-estimate) if the .pt is missing.
DEFAULT_MODEL_PATH = os.path.join(VSBS_TC_ROOT, "models", "predictor.pt")


# --- Configuration constants -----------------------------------------------


# Where the bridge dumps live camera JPGs. Sits under apps/web/public so
# Next.js serves them at /cameras/{bookingId}/{quadrant}.jpg directly.
HERE = os.path.dirname(os.path.abspath(__file__))
VSBS_ROOT = os.path.normpath(os.path.join(HERE, "..", "..", "..", ".."))
DEFAULT_SNAPSHOT_ROOT = os.path.join(VSBS_ROOT, "apps", "web", "public", "cameras")
DEFAULT_RECORDINGS_ROOT = os.path.join(VSBS_ROOT, "apps", "web", "public", "recordings")


EGO_BLUEPRINT_WHITELIST = (
    "vehicle.tesla.model3",
    "vehicle.audi.tt",
    "vehicle.lincoln.mkz_2017",
    "vehicle.bmw.grandtourer",
    "vehicle.mini.cooper_s",
)

# Pool of blueprint patterns for ambient NPC traffic. Filtered through
# the live CARLA blueprint library at runtime — anything missing in the
# 0.9.16 build is silently skipped.
NPC_BLUEPRINTS = (
    "vehicle.audi.a2",
    "vehicle.audi.etron",
    "vehicle.bmw.grandtourer",
    "vehicle.chevrolet.impala",
    "vehicle.dodge.charger_2020",
    "vehicle.ford.mustang",
    "vehicle.lincoln.mkz_2017",
    "vehicle.mercedes.coupe_2020",
    "vehicle.nissan.patrol",
    "vehicle.toyota.prius",
    "vehicle.volkswagen.t2",
)

# Two service centres pinned in Town10HD. Spawn indices reused from
# destinations.py; geo lat/lng kept for the dashboard but unused for routing.
SERVICE_CENTRES = (
    {
        "sc_id": "SC-IN-DEL-01",
        "name": "GoMechanic Karol Bagh",
        "spawn_index": 42,
        "geo": (28.6519, 77.1909),
    },
    {
        "sc_id": "SC-IN-DEL-02",
        "name": "Mahindra First Choice Saket",
        "spawn_index": 88,
        "geo": (28.5273, 77.2174),
    },
)

# Random fault candidates with their visible-channel mapping. The bridge
# always degrades brakePadFrontPercent (visible on the existing dashboard
# tile) regardless of the fault label, but the event log records the
# actual fault kind for narrative.
FAULT_CHOICES = ("brake-pad-wear", "coolant-overheat", "hv-battery-imbalance")

# Health: 100 = fresh, 0 = catastrophic. Stochastic process — every run
# has a unique degradation shape with random trends, sudden drops, and
# plateaus. The reroute decision is driven by an online predictor that
# learns the shape from observations, so its accuracy directly determines
# whether the ego reaches the SC or critical-outs en route.
WARMUP_SECONDS = 60.0  # 60 s of normal driving in traffic before fault
WARMUP_JITTER_S = 10.0
# Stochastic fault parameters — chosen freshly per scenario.
DEGRADATION_TREND_INIT_RANGE = (0.10, 0.55)  # %/s starting trend rate
TREND_DRIFT_STDEV_PER_S = 0.05  # how the trend itself wanders
NOISE_STDEV_PCT = 0.6  # tick-to-tick health noise (%)
JUMP_PROB_PER_SEC = 0.08  # probability of a sudden drop per second
JUMP_MAGNITUDE_RANGE_PCT = (1.5, 7.0)
PLATEAU_PROB_PER_SEC = 0.04  # probability of entering a plateau
PLATEAU_DURATION_RANGE_S = (3.0, 12.0)
# Predictor + decision thresholds.
PREDICTOR_WINDOW = 80  # observations (~8 s at 10 Hz wire rate)
PREDICTOR_LOOKAHEAD_S = 5.0  # how far ahead we score predictions
# Bumped 90 → 150 s. With MLP MAE ~25 s on time-to-critical, firing at
# 90 s gave only ~64 s expected lead (drive-to-SC needs 60 s → near-miss
# territory). 150 s gives ~125 s expected lead with the same predictor —
# free safety win; no retraining required.
ACT_SOON_PREDICTED_RUL_S = 150.0
PREDICTOR_MIN_OBS_FOR_REROUTE = 30  # need this much data before trusting it
CRITICAL_HEALTH_PCT = 5.0  # Below this: halt + request tow (hard reality)
# Jump / plateau detection used by the engineered features below.
# A "jump" is a single-step health drop big enough to be unambiguously a
# failure event rather than tick noise (NOISE_STDEV_PCT=0.6 → 99th pct
# ≈ 1.4%). 1.5% threshold has <1% false-positive rate on pure noise.
JUMP_DETECT_PCT = 1.5
JUMP_LOOKBACK_S = 10.0
PLATEAU_SLOPE_THRESHOLD = 0.05  # %/s — below this slope looks "held"
PLATEAU_VOL_THRESHOLD = 0.05    # %/s — and slope variance is low

# Hold the ego visible after the scenario ends so the user can observe
# the parked / arrived state, screenshot, etc.
POST_EVENT_HOLD_SECONDS = 45.0
# Hard cap so a runaway bridge can't sit on a CARLA seat forever.
HARD_TIMEOUT_SECONDS = 540.0  # 9 minutes

# Ambient traffic — TM-controlled NPC vehicles spawned around the ego.
NPC_TRAFFIC_COUNT = 20

# Hang watchdog: stuck-ego detection while we're supposed to be driving.
# Detected by sustained low speed in spite of CARLA control input. Ignores
# the legit reasons an autonomous car might stand still (red lights,
# yielding to traffic, post-event hold) — those don't keep throttle high.
HANG_SPEED_KPH = 1.0
HANG_THROTTLE_THRESHOLD = 0.15
HANG_DETECTION_SECONDS = 8.0  # this much sustained "moving but not moving"
HANG_RECOVERY_ATTEMPTS = 3
HANG_GIVEUP_SECONDS = 30.0  # if recovery doesn't help, exit cleanly

TICK_HZ = 20  # CARLA fixed_delta_seconds = 0.05
TELEMETRY_DECIMATE = 2  # 20 Hz / 2 = 10 Hz wire rate


# --- Helpers ---------------------------------------------------------------


def now_iso() -> str:
    n = datetime.now(timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def euclid2d(a: "carla.Location", b: "carla.Location") -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def speed_kph(velocity: "carla.Vector3D") -> float:
    return 3.6 * math.sqrt(velocity.x**2 + velocity.y**2 + velocity.z**2)


def heading_deg(transform: "carla.Transform") -> float:
    yaw = transform.rotation.yaw % 360.0
    return yaw + 360.0 if yaw < 0 else yaw


def gnss_from_actor(actor: "carla.Actor") -> dict[str, float]:
    """CARLA world (x,y) is metres on a flat plane — fake a plausible
    Delhi-region lat/lng anchor + per-metre offset for the dashboard map."""
    loc = actor.get_location()
    anchor_lat, anchor_lng = 28.60, 77.20
    # 1 deg lat ≈ 111_320 m; 1 deg lng ≈ 111_320 * cos(lat)
    lat = anchor_lat + (loc.y / 111_320.0)
    lng = anchor_lng + (loc.x / (111_320.0 * math.cos(math.radians(anchor_lat))))
    return {"lat": lat, "lng": lng}


# --- Telemetry frame builder ----------------------------------------------


# --- Stochastic fault model + online predictor ----------------------------


class StochasticFaultModel:
    """Health(t) generator with no fixed rate. Composed of:

      - a wandering trend (autocorrelated random walk on the slope)
      - tick-to-tick Gaussian noise
      - rare sudden drops (cracks, micro-failures)
      - rare plateaus (degradation pauses while a sub-system holds)

    Every scenario picks fresh parameters so two consecutive runs have
    visually distinct degradation curves. The predictor below has no
    knowledge of these parameters — it has to infer the slope from
    observations.
    """

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.health = 100.0
        self.trend = rng.uniform(*DEGRADATION_TREND_INIT_RANGE)
        self._plateau_until_t: Optional[float] = None
        self.last_jump_t: Optional[float] = None
        self.last_plateau_start_t: Optional[float] = None

    def step(self, t_now: float, dt: float) -> tuple[float, dict[str, Any]]:
        """Advance the model by `dt` seconds. Returns (health, debug)."""
        debug: dict[str, Any] = {}

        # Trend itself drifts (autocorrelated). Clamp so it stays plausible.
        self.trend += self.rng.gauss(0.0, TREND_DRIFT_STDEV_PER_S) * dt
        self.trend = max(0.05, min(1.5, self.trend))

        # Plateau check.
        in_plateau = (
            self._plateau_until_t is not None and t_now < self._plateau_until_t
        )
        if not in_plateau and self._plateau_until_t is not None:
            self._plateau_until_t = None
        if not in_plateau and self.rng.random() < PLATEAU_PROB_PER_SEC * dt:
            dur = self.rng.uniform(*PLATEAU_DURATION_RANGE_S)
            self._plateau_until_t = t_now + dur
            self.last_plateau_start_t = t_now
            in_plateau = True
            debug["event"] = f"plateau-start dur={dur:.1f}s"

        # Base degradation increment (or 0 if plateauing) + Gaussian noise.
        if in_plateau:
            delta = self.rng.gauss(0.0, NOISE_STDEV_PCT * 0.4) * dt
        else:
            delta = self.trend * dt + self.rng.gauss(0.0, NOISE_STDEV_PCT) * dt

        # Sudden drop event.
        if not in_plateau and self.rng.random() < JUMP_PROB_PER_SEC * dt:
            jump = self.rng.uniform(*JUMP_MAGNITUDE_RANGE_PCT)
            delta += jump
            self.last_jump_t = t_now
            debug["event"] = f"jump -{jump:.1f}%"

        # Health is monotonically non-increasing in expectation, but we
        # allow tiny upward noise (sensor jitter) so the predictor sees
        # realistic data, then clamp to never exceed 100.
        self.health = max(0.0, min(100.0, self.health - delta))
        debug["trend"] = round(self.trend, 3)
        debug["plateau"] = in_plateau
        return self.health, debug


class OnlineRulPredictor:
    """Sliding-window linear regression on (time, health). Refits every
    tick. Tracks its own prediction error: each tick we look back
    PREDICTOR_LOOKAHEAD_S ago and compare the prediction made then with
    the actual health now. The MAE over the last 50 such checks is the
    "did I learn yet?" signal the dashboard renders.
    """

    def __init__(self) -> None:
        self.obs: list[tuple[float, float]] = []  # (t, health)
        self.predictions: list[tuple[float, float]] = []  # (target_t, predicted_health)
        self.errors: list[float] = []
        self._cached_slope: float = 0.0
        # Jump tracking — populated in observe() so feature_vector can
        # surface time_since_last_jump and recent_jump_count without a
        # second pass over the window.
        self.last_jump_t: Optional[float] = None
        self.recent_jumps: list[float] = []

    def observe(self, t_now: float, health: float) -> None:
        # Detect a sudden drop relative to the previous observation. We
        # check before appending so prev is the genuine last sample.
        if self.obs:
            prev_t, prev_h = self.obs[-1]
            drop = prev_h - health
            if drop > JUMP_DETECT_PCT:
                self.last_jump_t = t_now
                self.recent_jumps.append(t_now)
        # Prune jumps outside the lookback window.
        cutoff = t_now - JUMP_LOOKBACK_S
        while self.recent_jumps and self.recent_jumps[0] < cutoff:
            self.recent_jumps.pop(0)

        # Score any past predictions whose lookahead has now elapsed.
        ready = [p for p in self.predictions if p[0] <= t_now]
        for target_t, predicted_health in ready:
            err = abs(predicted_health - health)
            self.errors.append(err)
            if len(self.errors) > 50:
                self.errors.pop(0)
        self.predictions = [p for p in self.predictions if p[0] > t_now]

        # Append observation, truncate window.
        self.obs.append((t_now, health))
        if len(self.obs) > PREDICTOR_WINDOW:
            self.obs.pop(0)

        # Refit slope on the current window.
        self._cached_slope = self._fit_slope()

        # Issue a fresh forecast for `PREDICTOR_LOOKAHEAD_S` ahead so a
        # future call to observe() can score it.
        if self._cached_slope > 0.01:
            self.predictions.append(
                (t_now + PREDICTOR_LOOKAHEAD_S,
                 health - self._cached_slope * PREDICTOR_LOOKAHEAD_S),
            )

    def _fit_slope(self) -> float:
        """Returns the *positive* degradation rate (%/s).
        0 if not enough data or trend looks flat/positive."""
        if len(self.obs) < 5:
            return 0.0
        ts = [o[0] for o in self.obs]
        hs = [o[1] for o in self.obs]
        n = len(ts)
        mt = sum(ts) / n
        mh = sum(hs) / n
        num = sum((ts[i] - mt) * (hs[i] - mh) for i in range(n))
        den = sum((ts[i] - mt) ** 2 for i in range(n))
        if den == 0:
            return 0.0
        slope_signed = num / den
        # Health is dropping → slope_signed < 0 → degradation rate > 0
        return max(0.0, -slope_signed)

    def predict_rul_seconds(self, current_health: float) -> float:
        if self._cached_slope <= 0.01:
            return float("inf")
        return max(0.0, (current_health - CRITICAL_HEALTH_PCT) / self._cached_slope)

    @property
    def slope(self) -> float:
        return self._cached_slope

    @property
    def observation_count(self) -> int:
        return len(self.obs)

    @property
    def mae(self) -> float:
        return sum(self.errors) / len(self.errors) if self.errors else 0.0

    @property
    def errors_scored(self) -> int:
        return len(self.errors)

    # Feature vector exposed for offline ML training. Order is fixed and
    # used both to dump training samples (eval_predictor.py) and at
    # inference time (when a trained model is loaded).
    def feature_vector(self, t_now: float, current_health: float) -> list[float]:
        # Recent windows.
        win5 = [(ot, oh) for ot, oh in self.obs if t_now - ot <= 5.0]
        win10 = [(ot, oh) for ot, oh in self.obs if t_now - ot <= 10.0]

        # Largest single-tick health drop in the last 5 s.
        max_drop = 0.0
        for i in range(1, len(win5)):
            d = win5[i - 1][1] - win5[i][1]
            if d > max_drop:
                max_drop = d

        # Slope volatility — std of slope estimates across non-overlapping
        # 4-observation chunks of the 10 s window.
        slopes_recent: list[float] = []
        for k in range(0, max(0, len(win10) - 4), 4):
            chunk = win10[k : k + 4]
            ts = [o[0] for o in chunk]
            hs = [o[1] for o in chunk]
            n = len(ts)
            mt = sum(ts) / n
            mh = sum(hs) / n
            num = sum((ts[i] - mt) * (hs[i] - mh) for i in range(n))
            den = sum((ts[i] - mt) ** 2 for i in range(n))
            if den > 0:
                slopes_recent.append(-num / den)
        if len(slopes_recent) >= 2:
            mean_s = sum(slopes_recent) / len(slopes_recent)
            volatility = (
                sum((s - mean_s) ** 2 for s in slopes_recent) / (len(slopes_recent) - 1)
            ) ** 0.5
        else:
            volatility = 0.0

        # Engineered features added 2026-05-09 to drop MAE on the
        # stochastic-fault label below the 25 s the original 7 features
        # bottomed out at. Hand-engineered because the underlying process
        # has discrete events (jumps, plateaus) the linear slope can't
        # see, and the slope×health interaction is the linear-model
        # closed-form RUL the predictor's job is to *correct*.
        time_since_last_jump = (
            t_now - self.last_jump_t if self.last_jump_t is not None else 600.0
        )
        recent_jump_count = float(len(self.recent_jumps))
        plateau_active = (
            1.0
            if (
                self._cached_slope < PLATEAU_SLOPE_THRESHOLD
                and volatility < PLATEAU_VOL_THRESHOLD
                and len(self.obs) >= 5
            )
            else 0.0
        )
        slope_x_health_margin = self._cached_slope * max(
            0.0, current_health - CRITICAL_HEALTH_PCT
        )

        return [
            float(current_health),
            float(self._cached_slope),
            float(volatility),
            float(max_drop),
            float(t_now),
            float(self.mae),
            float(self.observation_count),
            float(time_since_last_jump),
            float(recent_jump_count),
            float(plateau_active),
            float(slope_x_health_margin),
        ]


FEATURE_NAMES = (
    "health_pct",
    "slope_pct_per_s",
    "slope_volatility_pct_per_s",
    "max_drop_5s_pct",
    "t_since_fault_s",
    "predictor_mae_pct",
    "observation_count",
    "time_since_last_jump_s",
    "recent_jump_count_10s",
    "plateau_active",
    "slope_x_health_margin",
)


def _virtual_state_for(fault_name: str, health_pct: float) -> VirtualState:
    """Build a faults.VirtualState that mirrors the bridge's degradation
    so LiveFrameBuilder propagates the right channels to telemetry."""
    state = VirtualState()
    if fault_name == "brake-pad-wear":
        state.brake_pad_front_pct = max(0.0, min(100.0, health_pct))
    elif fault_name == "coolant-overheat":
        state.coolant_temp_c = 88.0 + (100.0 - health_pct) * 0.45
    elif fault_name == "hv-battery-imbalance":
        state.hv_battery_cell_delta_mv = 8.0 + (100.0 - health_pct) * 1.5
    return state


def build_frame(
    *,
    builder: LiveFrameBuilder,
    health_pct: float,
    rul_seconds: float,
    fault_name: str,
    fault_injected: bool,
    distance_to_sc_m: Optional[float],
    sc_target_location: Optional["carla.Location"],
    phase: str,
    predictor: Optional[OnlineRulPredictor] = None,
    rul_quantiles: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    """Build a fully-populated LiveTelemetryFrame from real CARLA truth via
    LiveFrameBuilder, then layer the test-drive's phase/fault overrides."""
    fault_progress = max(0.0, min(1.0, (100.0 - health_pct) / 100.0))
    frame = builder.build(
        _virtual_state_for(fault_name, health_pct),
        sc_target_location=sc_target_location,
        fault_progress=fault_progress if fault_injected else 0.0,
        active_fault=fault_name if fault_injected else "none",
    )
    if not frame:
        # Builder bails out when carla module is missing; fall through to a
        # minimal frame so the API still validates.
        frame = {
            "ts": now_iso(),
            "origin": "sim",
            "simSource": "carla-test-drive",
            "speedKph": 0.0,
            "headingDeg": 0.0,
            "brakePadFrontPercent": health_pct,
            "hvSocPercent": 72.0,
            "coolantTempC": 88.0,
            "tpms": {"fl": 230.0, "fr": 230.0, "rl": 230.0, "rr": 230.0},
        }

    frame["simSource"] = "carla-test-drive"

    # Phase-driven overrides.
    planner = frame.setdefault("planner", {})
    if phase in ("TOW", "ARRIVED"):
        planner["behavior"] = "park"
    safety = frame.setdefault("safety", {})
    if phase == "TOW":
        safety["mrmActive"] = True
        safety["mrmKind"] = "halt-on-shoulder-await-tow"
    elif "mrmKind" in safety and safety.get("mrmKind") in (None, ""):
        safety.pop("mrmKind", None)

    # Custom passthrough block — surfaces phase/health/RUL/predictor stats
    # so the dashboard can render the learning curve.
    test_drive: dict[str, Any] = {
        "phase": phase,
        "faultName": fault_name,
        "healthPct": health_pct,
    }
    if rul_seconds != float("inf") and not math.isnan(rul_seconds):
        test_drive["rulSeconds"] = rul_seconds
    if rul_quantiles:
        # Surface the quantile spread so the dashboard can show the
        # uncertainty band around the time-to-critical estimate.
        if "p10" in rul_quantiles:
            test_drive["rulP10Seconds"] = round(float(rul_quantiles["p10"]), 1)
        if "p50" in rul_quantiles:
            test_drive["rulP50Seconds"] = round(float(rul_quantiles["p50"]), 1)
        if "p90" in rul_quantiles:
            test_drive["rulP90Seconds"] = round(float(rul_quantiles["p90"]), 1)
    if predictor is not None:
        test_drive["predictorSlopePctPerS"] = round(predictor.slope, 3)
        test_drive["predictorMaePct"] = round(predictor.mae, 3)
        test_drive["predictorObservations"] = predictor.observation_count
        test_drive["predictorErrorsScored"] = predictor.errors_scored
    frame["testDrive"] = test_drive

    if distance_to_sc_m is not None:
        frame["distanceToServiceCentreM"] = distance_to_sc_m
    elif "distanceToServiceCentreM" in frame and frame["distanceToServiceCentreM"] is None:
        frame.pop("distanceToServiceCentreM", None)

    # Recursively drop any keys whose value is None — zod's .optional()
    # rejects null. LiveFrameBuilder leaves None for things like trafficLight
    # when the ego isn't near a signal, perception subfields, etc.
    return _strip_nulls(frame)


def _strip_nulls(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_nulls(v) for v in obj if v is not None]
    return obj


# --- HTTP fan-out to the API -----------------------------------------------


async def post_telemetry(client: httpx.AsyncClient, booking_id: str, frame: dict[str, Any]) -> None:
    try:
        await client.post(f"/v1/autonomy/{booking_id}/telemetry/ingest", json=frame, timeout=2.0)
    except Exception as err:
        LOG.debug("telemetry post failed: %s", err)


async def post_event(
    client: httpx.AsyncClient,
    booking_id: str,
    *,
    category: str,
    severity: str,
    title: str,
    detail: Optional[str] = None,
    data: Optional[dict[str, Any]] = None,
) -> None:
    payload: dict[str, Any] = {
        "ts": now_iso(),
        "category": category,
        "severity": severity,
        "title": title,
    }
    if detail:
        payload["detail"] = detail
    if data:
        payload["data"] = data
    try:
        await client.post(f"/v1/autonomy/{booking_id}/events/ingest", json=payload, timeout=2.0)
    except Exception as err:
        LOG.debug("event post failed: %s", err)


# --- Main loop -------------------------------------------------------------


async def run_test_drive(args: argparse.Namespace) -> int:
    rng = random.Random(args.seed if args.seed is not None else None)

    client_carla = carla.Client(args.carla_host, args.carla_port)
    client_carla.set_timeout(60.0)
    world = client_carla.get_world()
    map_name = world.get_map().name.split("/")[-1]
    if args.town and map_name != args.town:
        LOG.info("loading town %s (current=%s)", args.town, map_name)
        world = client_carla.load_world(args.town)

    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = 1.0 / TICK_HZ
    world.apply_settings(settings)

    # Traffic Manager runs the autopilot for the warmup phase. Sync mode
    # must propagate to TM or vehicles freeze when the world ticks.
    tm = client_carla.get_trafficmanager(8000)
    tm.set_synchronous_mode(True)

    # Spectator (the operator camera in CarlaUE4.exe) — we'll re-seat it on
    # the ego every tick so the user actually sees the car drive.
    spectator = world.get_spectator()

    actors_to_cleanup: list[Any] = []

    try:
        bp_lib = world.get_blueprint_library()
        spawn_points = world.get_map().get_spawn_points()
        if not spawn_points:
            LOG.error("no spawn points available")
            return 2

        # Pick random vehicle blueprint + random spawn.
        bp_choices = [b for b in EGO_BLUEPRINT_WHITELIST if bp_lib.filter(b)]
        if not bp_choices:
            LOG.error("no whitelisted vehicle blueprint matches in this CARLA build")
            return 2
        bp_name = rng.choice(bp_choices)
        ego_bp = bp_lib.filter(bp_name)[0]
        if ego_bp.has_attribute("color"):
            colors = ego_bp.get_attribute("color").recommended_values
            if colors:
                ego_bp.set_attribute("color", rng.choice(colors))
        spawn_pt = rng.choice(spawn_points)

        ego = world.try_spawn_actor(ego_bp, spawn_pt)
        if ego is None:
            # Try a few fallbacks if the chosen spawn collided.
            for sp in rng.sample(spawn_points, min(20, len(spawn_points))):
                ego = world.try_spawn_actor(ego_bp, sp)
                if ego is not None:
                    spawn_pt = sp
                    break
        if ego is None:
            LOG.error("failed to spawn ego at any candidate spawn point")
            return 2
        actors_to_cleanup.append(ego)
        LOG.info("spawned %s at spawn %s", bp_name, spawn_pt.location)

        # Resolve service-centre world locations from spawn indices.
        sc_locs: list[dict[str, Any]] = []
        for sc in SERVICE_CENTRES:
            idx = sc["spawn_index"] % len(spawn_points)
            sc_locs.append({**sc, "location": spawn_points[idx].location})

        # CARLA-truth frame builder. Spawns GNSS/IMU/radar/lidar/cameras +
        # 4 quadrant cameras that dump JPGs to disk. The dashboard fetches
        # those JPGs at /cameras/{bookingId}/{quadrant}.jpg directly from
        # Next.js's public/ folder.
        snapshot_dir = os.path.join(args.snapshot_root, args.booking_id)
        frame_builder: Optional[LiveFrameBuilder] = None
        try:
            frame_builder = LiveFrameBuilder(world, ego, snapshot_dir=snapshot_dir)
            LOG.info("LiveFrameBuilder attached; snapshot_dir=%s", snapshot_dir)
        except Exception as err:
            LOG.warning("LiveFrameBuilder failed to attach (%s); telemetry will be minimal", err)

        # Recording camera — dedicated 1280×720 chase view at 10 fps that
        # writes frames to disk. After the scenario ends we stitch the
        # frames into an MP4 the user can download from the dashboard.
        frames_dir = os.path.join(args.recordings_root, args.booking_id, "frames")
        os.makedirs(frames_dir, exist_ok=True)
        chase_counter = [0]
        chase_cam: Optional[Any] = None
        try:
            chase_bp = bp_lib.find("sensor.camera.rgb")
            chase_bp.set_attribute("image_size_x", "1280")
            chase_bp.set_attribute("image_size_y", "720")
            chase_bp.set_attribute("fov", "90")
            chase_bp.set_attribute("sensor_tick", "0.1")  # 10 fps
            for attr, value in (
                ("enable_postprocess_effects", "True"),
                ("exposure_mode", "histogram"),
                ("bloom_intensity", "0.5"),
                ("motion_blur_intensity", "0.3"),
            ):
                if chase_bp.has_attribute(attr):
                    chase_bp.set_attribute(attr, value)
            chase_tr = carla.Transform(
                carla.Location(x=-7.0, y=0.0, z=3.0),
                carla.Rotation(pitch=-15.0, yaw=0.0),
            )
            chase_cam = world.spawn_actor(chase_bp, chase_tr, attach_to=ego)
            actors_to_cleanup.append(chase_cam)

            def _on_chase(image, _ctr=chase_counter, _dir=frames_dir):  # type: ignore[no-untyped-def]
                path = os.path.join(_dir, f"{_ctr[0]:06d}.jpg")
                image.save_to_disk(path)
                _ctr[0] += 1

            chase_cam.listen(_on_chase)
            LOG.info("recording chase camera attached: 1280x720 @ 10 fps -> %s", frames_dir)
        except Exception as err:
            LOG.warning("recording chase camera failed to attach: %s", err)

        # Free-roam phase uses Traffic Manager autopilot — battle-tested under
        # synchronous mode. We swap to BasicAgent only when the fault triggers
        # a routed leg to the chosen service centre.
        ego.set_autopilot(True, tm.get_port())
        tm.ignore_lights_percentage(ego, 0)  # full road-rule compliance
        tm.vehicle_percentage_speed_difference(ego, 0)  # default speed limit
        LOG.info("controller=traffic-manager (autopilot) phase=free-roam")
        agent: Optional[BasicAgent] = None  # late-bound when we reroute

        # Spawn ambient NPC traffic so the ego isn't driving through an
        # empty city. Use spawn points far from the ego so we don't collide.
        npc_bp_choices = [bp for bp in NPC_BLUEPRINTS if bp_lib.filter(bp)]
        npc_pool = [
            sp for sp in spawn_points if euclid2d(sp.location, spawn_pt.location) > 30.0
        ]
        rng.shuffle(npc_pool)
        spawned_npcs = 0
        for sp in npc_pool[: NPC_TRAFFIC_COUNT * 3]:  # try 3× to absorb collisions
            if spawned_npcs >= NPC_TRAFFIC_COUNT:
                break
            if not npc_bp_choices:
                break
            bp_name_npc = rng.choice(npc_bp_choices)
            npc_bp = bp_lib.filter(bp_name_npc)[0]
            if npc_bp.has_attribute("color"):
                colors_npc = npc_bp.get_attribute("color").recommended_values
                if colors_npc:
                    npc_bp.set_attribute("color", rng.choice(colors_npc))
            npc = world.try_spawn_actor(npc_bp, sp)
            if npc is None:
                continue
            actors_to_cleanup.append(npc)
            try:
                npc.set_autopilot(True, tm.get_port())
                # Mild speed variation so traffic looks natural.
                tm.vehicle_percentage_speed_difference(npc, rng.uniform(-15.0, 25.0))
            except Exception:
                pass
            spawned_npcs += 1
        LOG.info("spawned %d NPC vehicles for ambient traffic", spawned_npcs)

        # Random fault selection. Degradation is generated by a fresh
        # stochastic process per scenario — no two runs share parameters.
        fault_name = rng.choice(FAULT_CHOICES)
        warmup_s = WARMUP_SECONDS + rng.uniform(-WARMUP_JITTER_S, WARMUP_JITTER_S)
        fault_model = StochasticFaultModel(rng)
        predictor = OnlineRulPredictor()

        # Load the trained model if present. It supersedes the linear
        # OnlineRulPredictor's own RUL output but we keep the predictor
        # alive for slope/MAE telemetry so the dashboard still renders.
        model_predict = load_predictor(args.model_path) if args.model_path else None
        if model_predict is not None:
            LOG.info("trained model loaded: %s", args.model_path)
        else:
            LOG.info("no trained model; using linear OnlineRulPredictor for RUL")

        LOG.info(
            "fault=%s warmup=%.1fs initialTrend=%.2f%%/s",
            fault_name, warmup_s, fault_model.trend,
        )

        api = httpx.AsyncClient(base_url=args.api_base)

        try:
            await post_event(
                api, args.booking_id,
                category="scenario", severity="info",
                title="Test drive started",
                detail=f"{bp_name} spawned; free-roaming for ~{warmup_s:.0f}s before fault.",
                data={
                    "vehicleBp": bp_name,
                    "fault": fault_name,
                    "initialTrendPctPerS": round(fault_model.trend, 3),
                    "rerouteThresholdRulS": ACT_SOON_PREDICTED_RUL_S,
                },
            )

            phase = "WARMUP"
            fault_injected_at: Optional[float] = None
            health = 100.0
            t_start = time.time()
            tick_idx = 0
            sc_target: Optional[dict[str, Any]] = None
            tow_announced = False
            arrived_announced = False
            # Hang watchdog state.
            hang_since_t: Optional[float] = None
            hang_recovery_count = 0

            while True:
                world.tick()
                tick_idx += 1
                t_now = time.time() - t_start

                # Chase camera: 7 m behind, 3 m above, pitched 15° down at the ego.
                ego_tf = ego.get_transform()
                yaw_rad = math.radians(ego_tf.rotation.yaw)
                spectator.set_transform(
                    carla.Transform(
                        carla.Location(
                            x=ego_tf.location.x - 7.0 * math.cos(yaw_rad),
                            y=ego_tf.location.y - 7.0 * math.sin(yaw_rad),
                            z=ego_tf.location.z + 3.0,
                        ),
                        carla.Rotation(pitch=-15.0, yaw=ego_tf.rotation.yaw, roll=0.0),
                    )
                )

                # Fault injection at warmup boundary.
                if phase == "WARMUP" and t_now >= warmup_s:
                    fault_injected_at = t_now
                    phase = "NORMAL"
                    await post_event(
                        api, args.booking_id,
                        category="fault", severity="watch",
                        title=f"Fault injected: {fault_name}",
                        detail=(
                            f"PHM detected onset. Degradation will be stochastic "
                            f"(initial trend ~{fault_model.trend:.2f}%/s, with random "
                            f"plateaus and sudden drops). Predictor begins learning."
                        ),
                        data={"fault": fault_name, "initialTrendPctPerS": round(fault_model.trend, 3)},
                    )

                # Drive — TM autopilot handles WARMUP/NORMAL; BasicAgent owns
                # the routed leg to the SC; we apply a brake-stop on TOW.
                if phase == "REROUTING" and agent is not None:
                    if agent.done() and not arrived_announced and sc_target is not None:
                        phase = "ARRIVED"
                        arrived_announced = True
                        await post_event(
                            api, args.booking_id,
                            category="navigation", severity="info",
                            title=f"Arrived at {sc_target['name']}",
                            detail="Vehicle reached service centre with health margin remaining.",
                            data={"scId": sc_target["sc_id"], "healthPct": health},
                        )
                        ego.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0, hand_brake=True))
                    else:
                        ego.apply_control(agent.run_step())

                # Health update — stochastic fault model takes over after
                # injection. Feed every observation to the online predictor
                # so it can refit its slope estimate and score itself.
                dt = 1.0 / TICK_HZ
                if fault_injected_at is not None and phase != "ARRIVED":
                    new_health, fault_dbg = fault_model.step(t_now, dt)
                    health = new_health
                    predictor.observe(t_now, health)
                    if "event" in fault_dbg:
                        LOG.info("fault.%s @ t=%.1f health=%.1f%%", fault_dbg["event"], t_now, health)

                rul_quantiles: Optional[dict[str, float]] = None
                if fault_injected_at is not None and phase not in ("ARRIVED", "TOW"):
                    if model_predict is not None and predictor.observation_count >= PREDICTOR_MIN_OBS_FOR_REROUTE:
                        try:
                            features_now = predictor.feature_vector(t_now, health)
                            # When the loaded model is a quantile head, it
                            # returns the conservative P10 (the value we
                            # act on) and exposes .quantiles for telemetry.
                            rul_s = float(max(0.0, model_predict(features_now)))
                            qfn = getattr(model_predict, "quantiles", None)
                            if qfn is not None:
                                rul_quantiles = qfn(features_now)
                        except Exception as err:
                            LOG.warning("model inference failed (%s); falling back to linear", err)
                            rul_s = predictor.predict_rul_seconds(health)
                    else:
                        rul_s = predictor.predict_rul_seconds(health)
                else:
                    rul_s = float("inf")

                # --- Hang watchdog ---------------------------------------
                # Detect "stuck-in-place" while we should be driving. CARLA
                # sometimes deadlocks the ego (TM port glitch, BasicAgent
                # local plan stall, physics tunneling). We re-engage the
                # controller, then escalate to a clean abort if it persists.
                if phase in ("WARMUP", "NORMAL", "REROUTING"):
                    cur_speed_kph = speed_kph(ego.get_velocity())
                    cur_ctrl = ego.get_control()
                    trying_to_move = (
                        cur_ctrl.throttle > HANG_THROTTLE_THRESHOLD
                        and cur_ctrl.brake < 0.5
                    )
                    stuck = trying_to_move and cur_speed_kph < HANG_SPEED_KPH
                    if stuck:
                        if hang_since_t is None:
                            hang_since_t = t_now
                            hang_recovery_count = 0
                        hang_duration = t_now - hang_since_t
                        # Fire a recovery attempt every HANG_DETECTION_SECONDS
                        # of sustained hang, up to HANG_RECOVERY_ATTEMPTS.
                        attempts_due = int(hang_duration // HANG_DETECTION_SECONDS)
                        if (
                            attempts_due > hang_recovery_count
                            and hang_recovery_count < HANG_RECOVERY_ATTEMPTS
                        ):
                            hang_recovery_count = attempts_due
                            LOG.warning(
                                "hang detected (%.1fs sustained); recovery #%d/%d",
                                hang_duration, hang_recovery_count, HANG_RECOVERY_ATTEMPTS,
                            )
                            try:
                                if phase in ("WARMUP", "NORMAL"):
                                    ego.set_autopilot(False)
                                    await asyncio.sleep(0.05)
                                    ego.set_autopilot(True, tm.get_port())
                                elif phase == "REROUTING" and sc_target is not None:
                                    agent = BasicAgent(ego, target_speed=30)
                                    agent.set_destination(sc_target["location"])
                                # Brief manual nudge so the physics knocks loose.
                                ego.apply_control(
                                    carla.VehicleControl(
                                        throttle=0.5, brake=0.0, hand_brake=False
                                    )
                                )
                            except Exception as err:
                                LOG.warning("hang recovery raised: %s", err)
                            await post_event(
                                api, args.booking_id,
                                category="safety", severity="watch",
                                title=f"Auto-recovery: re-engaged {('autopilot' if phase != 'REROUTING' else 'BasicAgent')}",
                                detail=(
                                    f"Ego stuck for {hang_duration:.1f}s with throttle commanded; "
                                    f"re-issued controller. Attempt {hang_recovery_count}/{HANG_RECOVERY_ATTEMPTS}."
                                ),
                                data={
                                    "phase": phase,
                                    "attempt": hang_recovery_count,
                                    "hangDurationS": round(hang_duration, 1),
                                    "speedKph": round(cur_speed_kph, 2),
                                    "throttle": round(cur_ctrl.throttle, 3),
                                },
                            )
                        # Hard giveup if recovery didn't help.
                        if hang_duration >= HANG_GIVEUP_SECONDS:
                            LOG.error("hang unrecoverable after %.0fs; aborting scenario", hang_duration)
                            await post_event(
                                api, args.booking_id,
                                category="safety", severity="critical",
                                title="Ego hang unrecoverable",
                                detail=(
                                    f"Auto-recovery exhausted after {HANG_RECOVERY_ATTEMPTS} attempts "
                                    f"({hang_duration:.0f}s total). Bridge exiting so the queue can spawn "
                                    f"a fresh run."
                                ),
                                data={"phase": phase, "hangDurationS": round(hang_duration, 1)},
                            )
                            break
                    else:
                        # Moving freely again — clear the watchdog.
                        if hang_since_t is not None:
                            recovered_after = t_now - hang_since_t
                            if hang_recovery_count > 0:
                                LOG.info("hang cleared after %.1fs (recovery worked)", recovered_after)
                                await post_event(
                                    api, args.booking_id,
                                    category="safety", severity="info",
                                    title="Auto-recovery succeeded",
                                    detail=f"Ego unstuck after {recovered_after:.1f}s.",
                                )
                        hang_since_t = None
                        hang_recovery_count = 0

                # Threshold transitions — reroute is now driven by the
                # *predictor's* RUL estimate. If the predictor is wrong,
                # the ego may critical-out before reaching the SC, which
                # is exactly the demo we want to show.
                predictor_ready = (
                    phase == "NORMAL"
                    and predictor.observation_count >= PREDICTOR_MIN_OBS_FOR_REROUTE
                )
                if (
                    predictor_ready
                    and rul_s <= ACT_SOON_PREDICTED_RUL_S
                    and sc_target is None
                ):
                    # Pick nearest SC by world Euclidean distance from current pos.
                    ego_loc = ego.get_location()
                    sc_target = min(sc_locs, key=lambda s: euclid2d(s["location"], ego_loc))
                    # Hand off from Traffic Manager autopilot to BasicAgent so we
                    # can route to a specific destination.
                    ego.set_autopilot(False)
                    agent = BasicAgent(ego, target_speed=30)
                    agent.set_destination(sc_target["location"])
                    phase = "REROUTING"
                    reroute_data: dict[str, Any] = {
                        "scId": sc_target["sc_id"],
                        "distanceM": euclid2d(sc_target["location"], ego_loc),
                        "healthPct": health,
                        "rulSeconds": rul_s,
                        "rerouteThresholdS": ACT_SOON_PREDICTED_RUL_S,
                        "predictorSlope": round(predictor.slope, 3),
                        "predictorMae": round(predictor.mae, 3),
                        "predictorObservations": predictor.observation_count,
                    }
                    if rul_quantiles:
                        for k, v in rul_quantiles.items():
                            reroute_data[f"rul{k.upper()}Seconds"] = round(float(v), 1)
                    quantile_detail = ""
                    if rul_quantiles and "p10" in rul_quantiles and "p90" in rul_quantiles:
                        quantile_detail = (
                            f" Quantile band: P10={float(rul_quantiles['p10']):.0f}s "
                            f"P50={float(rul_quantiles.get('p50', rul_s)):.0f}s "
                            f"P90={float(rul_quantiles['p90']):.0f}s."
                        )
                    await post_event(
                        api, args.booking_id,
                        category="navigation", severity="alert",
                        title=f"Rerouting to {sc_target['name']}",
                        detail=(
                            f"Predicted RUL {rul_s:.0f}s ≤ {ACT_SOON_PREDICTED_RUL_S:.0f}s threshold "
                            f"(predictor slope {predictor.slope:.2f}%/s, "
                            f"MAE {predictor.mae:.2f}% across {predictor.errors_scored} forecasts).{quantile_detail} "
                            f"Diverting to nearest service centre."
                        ),
                        data=reroute_data,
                    )

                if (
                    phase in ("NORMAL", "REROUTING")
                    and health <= CRITICAL_HEALTH_PCT
                    and not tow_announced
                ):
                    phase = "TOW"
                    tow_announced = True
                    # Take back manual control from TM/BasicAgent and stop hard.
                    ego.set_autopilot(False)
                    halt_control = carla.VehicleControl(
                        throttle=0.0, brake=1.0, hand_brake=True, reverse=False
                    )
                    ego.apply_control(halt_control)
                    try:
                        # Hazards via CARLA's light state (0.9.16 supports light_state on vehicles).
                        ls = carla.VehicleLightState
                        ego.set_light_state(carla.VehicleLightState(ls.Position | ls.LowBeam | ls.RightBlinker | ls.LeftBlinker))
                    except Exception:
                        pass
                    await post_event(
                        api, args.booking_id,
                        category="safety", severity="critical",
                        title="Vehicle halted - tow required",
                        detail=(
                            f"{fault_name} reached criticality before reaching service centre. "
                            f"Ego safely parked; user notified to dispatch tow."
                        ),
                        data={
                            "healthPct": health,
                            "fault": fault_name,
                            "ego": {
                                "lat": gnss_from_actor(ego)["lat"],
                                "lng": gnss_from_actor(ego)["lng"],
                            },
                            "userNotification": {
                                "channel": ["push", "sms"],
                                "severity": "high",
                                "title": "Vehicle halted - tow required",
                                "body": (
                                    f"Your vehicle has stopped. {fault_name} reached criticality before "
                                    f"reaching the nearest service centre. A tow truck will be dispatched."
                                ),
                            },
                        },
                    )

                # Telemetry decimation: emit at 10 Hz.
                if tick_idx % TELEMETRY_DECIMATE == 0 and frame_builder is not None:
                    distance_to_sc_m: Optional[float] = None
                    sc_loc: Optional[Any] = None
                    if sc_target is not None:
                        sc_loc = sc_target["location"]
                        distance_to_sc_m = euclid2d(sc_loc, ego.get_location())
                    frame = build_frame(
                        builder=frame_builder,
                        health_pct=health,
                        rul_seconds=rul_s,
                        fault_name=fault_name,
                        fault_injected=fault_injected_at is not None,
                        distance_to_sc_m=distance_to_sc_m,
                        sc_target_location=sc_loc,
                        phase=phase,
                        predictor=predictor,
                        rul_quantiles=rul_quantiles,
                    )
                    await post_telemetry(api, args.booking_id, frame)

                # Termination — hold the ego visible for POST_EVENT_HOLD_SECONDS
                # so the user has time to observe the final state, screenshot,
                # talk through it. We keep ticking the world (so traffic stays
                # alive) and keep streaming telemetry so the dashboard doesn't
                # silently switch to the deterministic fallback.
                if phase in ("ARRIVED", "TOW"):
                    LOG.info(
                        "test drive in terminal phase=%s; holding %.0fs",
                        phase, POST_EVENT_HOLD_SECONDS,
                    )
                    hold_ticks = int(TICK_HZ * POST_EVENT_HOLD_SECONDS)
                    hold_decimate = TELEMETRY_DECIMATE
                    for h in range(hold_ticks):
                        world.tick()
                        # Re-seat the chase camera so it doesn't drift off.
                        ego_tf2 = ego.get_transform()
                        yaw_rad2 = math.radians(ego_tf2.rotation.yaw)
                        spectator.set_transform(
                            carla.Transform(
                                carla.Location(
                                    x=ego_tf2.location.x - 7.0 * math.cos(yaw_rad2),
                                    y=ego_tf2.location.y - 7.0 * math.sin(yaw_rad2),
                                    z=ego_tf2.location.z + 3.0,
                                ),
                                carla.Rotation(pitch=-15.0, yaw=ego_tf2.rotation.yaw, roll=0.0),
                            )
                        )
                        # Keep telemetry flowing so the API doesn't fall back.
                        if h % hold_decimate == 0 and frame_builder is not None:
                            distance_to_sc_m_h: Optional[float] = None
                            sc_loc_h: Optional[Any] = None
                            if sc_target is not None:
                                sc_loc_h = sc_target["location"]
                                distance_to_sc_m_h = euclid2d(sc_loc_h, ego.get_location())
                            frame_h = build_frame(
                                builder=frame_builder,
                                health_pct=health,
                                rul_seconds=rul_s,
                                fault_name=fault_name,
                                fault_injected=fault_injected_at is not None,
                                distance_to_sc_m=distance_to_sc_m_h,
                                sc_target_location=sc_loc_h,
                                phase=phase,
                                predictor=predictor,
                                rul_quantiles=rul_quantiles,
                            )
                            await post_telemetry(api, args.booking_id, frame_h)
                        await asyncio.sleep(1.0 / TICK_HZ)
                    break

                # Hard cap.
                if t_now > HARD_TIMEOUT_SECONDS:
                    LOG.warning("hard timeout (%.0fs); aborting", HARD_TIMEOUT_SECONDS)
                    break

                await asyncio.sleep(1.0 / TICK_HZ)

            await post_event(
                api, args.booking_id,
                category="scenario", severity="info",
                title="Test drive ended",
                detail=f"final phase={phase} health={health:.1f}% fault={fault_name}",
            )

            # Stitch the recording chase frames into an MP4 the user can
            # download. We stop the listener first so no further frames land
            # while we're zipping them up.
            if chase_cam is not None:
                try:
                    chase_cam.stop()
                except Exception:
                    pass
            await _stitch_recording(api, args.booking_id, frames_dir, args.recordings_root)
            return 0
        finally:
            await api.aclose()
    finally:
        # CARLA cleanup: destroy LiveFrameBuilder sensors + ego + restore async.
        try:
            if "frame_builder" in locals() and frame_builder is not None:
                frame_builder.destroy()
        except Exception:
            pass
        for actor in actors_to_cleanup:
            try:
                actor.destroy()
            except Exception:
                pass
        try:
            settings = world.get_settings()
            settings.synchronous_mode = False
            world.apply_settings(settings)
        except Exception:
            pass
        try:
            tm.set_synchronous_mode(False)
        except Exception:
            pass


# --- Video stitching -------------------------------------------------------


async def _stitch_recording(
    api: httpx.AsyncClient,
    booking_id: str,
    frames_dir: str,
    recordings_root: str,
) -> None:
    """Stitch the chase-camera JPGs into an MP4 under public/recordings/
    and post a 'Recording ready' event with the download URL."""
    import glob
    import shutil

    try:
        import imageio.v2 as imageio  # type: ignore[import-not-found]
    except Exception as err:
        LOG.warning("imageio missing; skipping video stitch (%s)", err)
        return

    frames = sorted(glob.glob(os.path.join(frames_dir, "*.jpg")))
    if not frames:
        LOG.info("no recording frames to stitch")
        return

    out_path = os.path.join(recordings_root, f"{booking_id}.mp4")
    os.makedirs(recordings_root, exist_ok=True)
    LOG.info("stitching %d frames -> %s", len(frames), out_path)
    try:
        # 30 fps means 10-fps capture plays back at 3× speed — keeps the
        # video watchable for a 5-minute scenario.
        with imageio.get_writer(out_path, fps=30, codec="libx264", quality=7) as w:
            for f in frames:
                w.append_data(imageio.imread(f))
        LOG.info("stitched recording: %s", out_path)
    except Exception as err:
        LOG.warning("stitch failed (%s); leaving frames on disk", err)
        return

    # Best-effort cleanup of the per-booking frames dir.
    try:
        booking_dir = os.path.dirname(frames_dir)
        shutil.rmtree(booking_dir, ignore_errors=True)
    except Exception:
        pass

    video_url = f"/recordings/{booking_id}.mp4"
    await post_event(
        api,
        booking_id,
        category="scenario",
        severity="info",
        title="Recording ready",
        detail=f"{len(frames)} frames stitched at 30 fps; ready to download.",
        data={"videoUrl": video_url, "frameCount": len(frames)},
    )


# --- CLI -------------------------------------------------------------------


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="VSBS web-triggered test-drive bridge.")
    p.add_argument("--booking-id", required=True)
    p.add_argument("--api-base", default=os.getenv("VSBS_API_BASE", "http://localhost:8787"))
    p.add_argument("--carla-host", default=os.getenv("CARLA_HOST", "127.0.0.1"))
    p.add_argument("--carla-port", default=int(os.getenv("CARLA_PORT", "2000")), type=int)
    p.add_argument("--town", default=os.getenv("CARLA_TOWN", "Town10HD"))
    p.add_argument("--seed", default=None, type=int)
    p.add_argument(
        "--snapshot-root",
        default=os.environ.get("VSBS_SNAPSHOT_ROOT", DEFAULT_SNAPSHOT_ROOT),
        help="Directory under which per-booking camera JPGs are written.",
    )
    p.add_argument(
        "--recordings-root",
        default=os.environ.get("VSBS_RECORDINGS_ROOT", DEFAULT_RECORDINGS_ROOT),
        help="Directory under which the recording MP4 is written.",
    )
    p.add_argument(
        "--model-path",
        default=os.environ.get(
            "CARLA_PREDICTOR_MODEL",
            DEFAULT_MODEL_PATH if os.path.isfile(DEFAULT_MODEL_PATH) else "",
        ),
        help="Trained-predictor model path. Empty to use the linear baseline.",
    )
    return p.parse_args(argv)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = parse_args()
    return asyncio.run(run_test_drive(args))


if __name__ == "__main__":
    sys.exit(main())
