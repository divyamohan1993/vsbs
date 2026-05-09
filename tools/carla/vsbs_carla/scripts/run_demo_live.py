# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Live CARLA runner.

Connects to a running CARLA 0.9.16 server, spawns the ego vehicle and a
small NPC fleet through the TrafficManager, drives normally for a warm-up
window, then injects a progressive brake-pad fault. PHM detection,
autonomous booking, command-grant minting, and the route to the chosen
service centre are all exercised against the live VSBS API.

Distinct from `run_demo.py`, which uses the JSONL trace replayer for CI
machines without CARLA, this script ticks against a real Unreal world.
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
from typing import Any, Optional

# CARLA's PythonAPI tarball ships an `agents` module alongside the wheel
# (PythonAPI/carla/agents). When the user installs `pip install carla==0.9.16`
# only the `carla` C-extension is vended, so the `agents.navigation.basic_agent`
# import is unavailable unless we add the tarball's PythonAPI/carla path to
# sys.path. CARLA_PYTHONAPI can be set to point at the unpacked tarball.
def _maybe_import_agents() -> bool:
    candidates = [
        os.environ.get("CARLA_PYTHONAPI"),
        "/mnt/experiments/carla-0.9.16/CARLA_0.9.16/PythonAPI/carla",
        "/mnt/experiments/carla-0.9.16/PythonAPI/carla",
        "/opt/carla/PythonAPI/carla",
    ]
    for path in candidates:
        if path and os.path.isdir(path):
            if path not in sys.path:
                sys.path.insert(0, path)
            break
    try:
        global BasicAgent
        from agents.navigation.basic_agent import BasicAgent  # type: ignore[import-not-found]
        return True
    except Exception:
        return False


HAS_AGENTS = _maybe_import_agents()

import carla  # type: ignore[import-not-found]

from ..agent import DemoOrchestrator, OrchestratorContext
from ..api import VsbsApi
from ..config import load_settings
from ..faults import FaultScheduler, build_fault
from ..live_frame import LiveFrameBuilder
from ..replay import TraceFrame
from ..schemas import PhmReadingPayload, now_iso
from ..sensors import build_samples as _shared_build_samples

LOG = logging.getLogger("vsbs_carla.live")

FAULT_TO_COMPONENT = {
    "brake-pad-wear": "brakes-pads-front",
    "coolant-overheat": "cooling-system",
    "hv-battery-imbalance": "battery-hv",
    "tpms-dropout": "tire-fl",
    "oil-low": "engine-oil-system",
    "drive-belt-age": "drive-belt",
}

FAULT_DESCRIPTION = {
    "brake-pad-wear": "front brake-pad thickness",
    "coolant-overheat": "coolant temperature",
    "hv-battery-imbalance": "HV battery cell imbalance",
    "tpms-dropout": "front-left tyre pressure",
    "oil-low": "engine-oil age",
    "drive-belt-age": "drive-belt health",
}

FAULT_UNIT = {
    "brake-pad-wear": "%",
    "coolant-overheat": "C",
    "hv-battery-imbalance": "mV",
    "tpms-dropout": "kPa",
    "oil-low": "km",
    "drive-belt-age": "score",
}

ALL_FAULTS = tuple(FAULT_TO_COMPONENT.keys())

EGO_BLUEPRINTS = (
    "vehicle.tesla.model3",
    "vehicle.audi.tt",
    "vehicle.lincoln.mkz_2017",
    "vehicle.bmw.grandtourer",
    "vehicle.mini.cooper_s",
)

NPC_BLUEPRINTS = (
    "vehicle.audi.a2",
    "vehicle.audi.etron",
    "vehicle.bmw.grandtourer",
    "vehicle.chevrolet.impala",
    "vehicle.dodge.charger_2020",
    "vehicle.ford.mustang",
    "vehicle.mercedes.coupe_2020",
    "vehicle.nissan.patrol",
    "vehicle.toyota.prius",
    "vehicle.volkswagen.t2",
)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the VSBS x CARLA live demo.")
    parser.add_argument("--carla-host", default=os.getenv("CARLA_HOST", "127.0.0.1"))
    parser.add_argument("--carla-port", default=int(os.getenv("CARLA_PORT", "2000")), type=int)
    parser.add_argument("--town", default=os.getenv("CARLA_TOWN", "Town01"))
    parser.add_argument("--ego-blueprint", default=os.getenv("CARLA_EGO_BP", "vehicle.tesla.model3"))
    parser.add_argument("--npc-count", default=int(os.getenv("CARLA_NPC_COUNT", "12")), type=int)
    parser.add_argument("--warmup-seconds", default=10.0, type=float)
    parser.add_argument(
        "--fault",
        default="random",
        help="brake-pad-wear | coolant-overheat | hv-battery-imbalance | "
             "tpms-dropout | oil-low | drive-belt-age | random",
    )
    parser.add_argument("--fault-duration-s", default=30.0, type=float,
                        help="Time to fully ramp the fault from healthy to critical.")
    parser.add_argument("--vehicle-id", default="carla-veh-live")
    parser.add_argument("--max-runtime-s", default=480.0, type=float,
                        help="Hard ceiling on the entire demo (in sim seconds).")
    parser.add_argument("--no-traffic", action="store_true")
    parser.add_argument("--seed", default=42, type=int)
    parser.add_argument("--scenario-only", action="store_true",
                        help="Skip /v1/sensors/ingest; useful for low-disk smoke runs.")
    parser.add_argument("--no-render", action="store_true",
                        help="Set CARLA world to no_rendering_mode=True. Server still "
                             "ticks physics, traffic, autopilot, and BasicAgent, but "
                             "skips per-tick rendering. Drops VRAM use to ~150 MB. "
                             "Required on iGPUs with <2 GB dedicated VRAM.")
    parser.add_argument("--api-base", default=None)
    parser.add_argument("--screenshot-dir", default=None,
                        help="If set, attaches a 1080p Epic HDR cinematic chase camera "
                             "at 60 FPS plus a 1080p top-down drone camera every 5 sim "
                             "seconds, both saved as PNG into <dir>/{chase,drone}/. "
                             "World ticks at 60 Hz so the chase frames can be stitched "
                             "into a 60 FPS MP4. Off by default.")
    parser.add_argument("--cinematic-quality", default="epic",
                        choices=("epic", "high", "low"),
                        help="Hint only; CARLA quality is set at server start.")
    return parser.parse_args(argv)


# -----------------------------------------------------------------------------
# CARLA helpers
# -----------------------------------------------------------------------------


def _connect(host: str, port: int, timeout_s: float = 180.0) -> carla.Client:
    """Connect to a CARLA server. 180 s timeout covers Town10HD/Epic load
    on freshly-booted servers, where get_available_maps() can take 60-90 s."""
    client = carla.Client(host, port)
    client.set_timeout(timeout_s)
    LOG.info("connected to CARLA %s:%d server-version=%s client-version=%s",
             host, port, client.get_server_version(), client.get_client_version())
    return client


def _load_world(
    client: carla.Client,
    town: str,
    *,
    no_render: bool = False,
    fixed_delta_seconds: float = 0.05,
) -> carla.World:
    """Reuse the currently loaded world if it matches; otherwise load.

    Map loads can take 30+ seconds on a low-VRAM box. The currently loaded
    map after `CarlaUE4.sh` boot is Town10HD by default, which works fine
    for the demo. We only load_world when the requested town differs.
    """
    current = client.get_world()
    current_name = current.get_map().name.split("/")[-1]
    if town and current_name != town:
        available = [m.split("/")[-1] for m in client.get_available_maps()]
        if town not in available and f"{town}_Opt" in available:
            LOG.info("requested town=%s missing; falling back to %s_Opt", town, town)
            town = f"{town}_Opt"
        if town in available:
            LOG.info("loading town=%s (was %s)", town, current_name)
            world = client.load_world(town)
        else:
            LOG.warning("town=%s not in this build; using current=%s", town, current_name)
            world = current
    else:
        LOG.info("reusing current world town=%s", current_name)
        world = current
    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = fixed_delta_seconds
    settings.substepping = True
    settings.max_substep_delta_time = 0.01
    settings.max_substeps = 10
    LOG.info("world tick = %.4fs (%.1f Hz)", fixed_delta_seconds, 1.0 / fixed_delta_seconds)
    if no_render:
        # Server still ticks physics, traffic, autopilot, BasicAgent.
        # It just skips per-tick rendering of the world. Drops VRAM
        # use from ~2 GB to ~150 MB. Required on iGPUs with very
        # small dedicated frame buffers (e.g. AMD APU @ 512 MB).
        settings.no_rendering_mode = True
        LOG.info("no_rendering_mode = True (low-VRAM path; no spectator visuals)")
    world.apply_settings(settings)
    weather = carla.WeatherParameters(
        cloudiness=20.0, precipitation=0.0, sun_altitude_angle=70.0,
        fog_density=0.0,
    )
    world.set_weather(weather)
    return world


def _spawn_ego(world: carla.World, blueprint: str) -> carla.Vehicle:
    bp_lib = world.get_blueprint_library()
    chosen = None
    for candidate in (blueprint, *EGO_BLUEPRINTS):
        bps = bp_lib.filter(candidate)
        if bps:
            chosen = bps[0]
            break
    if chosen is None:
        raise RuntimeError("no usable vehicle blueprint")
    chosen.set_attribute("role_name", "vsbs-ego")
    if chosen.has_attribute("color"):
        chosen.set_attribute("color", "10,30,140")
    spawn_points = world.get_map().get_spawn_points()
    if not spawn_points:
        raise RuntimeError("no spawn points in this map")
    spawn = spawn_points[0]
    ego = world.try_spawn_actor(chosen, spawn)
    if ego is None:
        # retry on next available spawn until one succeeds.
        for sp in spawn_points[1:]:
            ego = world.try_spawn_actor(chosen, sp)
            if ego is not None:
                break
    if ego is None:
        raise RuntimeError("failed to spawn ego at any spawn point")
    LOG.info("ego spawned id=%d blueprint=%s at %s",
             ego.id, chosen.id, ego.get_transform().location)
    return ego


def _spawn_npcs(
    world: carla.World, tm: carla.TrafficManager, count: int, seed: int
) -> list[carla.Vehicle]:
    if count <= 0:
        return []
    rng = random.Random(seed)
    bp_lib = world.get_blueprint_library()
    npcs: list[carla.Vehicle] = []
    spawns = world.get_map().get_spawn_points()
    rng.shuffle(spawns)
    for sp in spawns:
        if len(npcs) >= count:
            break
        bp_id = rng.choice(NPC_BLUEPRINTS)
        bps = bp_lib.filter(bp_id)
        if not bps:
            continue
        bp = bps[0]
        if bp.has_attribute("color"):
            bp.set_attribute("color", rng.choice(["255,255,255", "20,20,20",
                                                  "200,30,30", "30,60,200"]))
        bp.set_attribute("role_name", "npc")
        actor = world.try_spawn_actor(bp, sp)
        if actor is None:
            continue
        actor.set_autopilot(True, tm.get_port())
        tm.ignore_lights_percentage(actor, 0)  # respect lights
        tm.distance_to_leading_vehicle(actor, 2.5)
        tm.vehicle_percentage_speed_difference(actor, rng.randint(-10, 30))
        npcs.append(actor)
    LOG.info("spawned %d NPCs (requested %d)", len(npcs), count)
    return npcs


def _service_centre_target(
    world: carla.World, ego: carla.Vehicle, *, min_distance_m: float = 80.0
) -> carla.Transform:
    """Pick a spawn point a meaningful distance from the ego as the SC."""
    spawns = world.get_map().get_spawn_points()
    here = ego.get_transform().location
    farthest = max(spawns, key=lambda s: here.distance(s.location))
    distance = here.distance(farthest.location)
    if distance < min_distance_m:
        LOG.warning("SC distance only %.1fm; map may be tiny", distance)
    LOG.info("service centre target: %s (%.1fm from ego)", farthest.location, distance)
    return farthest


def _home_target(world: carla.World) -> carla.Transform:
    return world.get_map().get_spawn_points()[0]


def _attach_screenshot_cameras(
    world: carla.World, ego: carla.Vehicle, output_dir: str
) -> list:
    """Attach a 1080p HDR cinematic chase + 1080p top-down drone camera.

    Chase: 1920x1080 @ 60 FPS, fov 85, slung 7 m behind and 2.8 m above
    the ego, pitched -10 degrees. The 1080p / Epic / 60-FPS combo with
    histogram auto-exposure renders Unreal's full HDR pipeline (bloom,
    SSAO, cascaded shadows, atmospheric fog, motion blur, lens flare).
    Designed to be encoded as HEVC Main10 (10-bit) via NVENC so highlights
    and shadow detail survive the trip from linear-HDR internal render
    to the final container.

    Drone: 1920x1080 every 5 sim seconds, straight down from 22 m. Lower
    cadence + lower res so the disk doesn't fill with sky views.

    Both cameras' listeners fire on CARLA's sensor delivery thread, so
    save_to_disk is non-blocking from the world tick's perspective. PNG
    encoding may drop some frames under load; ffmpeg renders whatever
    lands as a contiguous 60 FPS stream.
    """
    chase_dir = os.path.join(output_dir, "chase")
    drone_dir = os.path.join(output_dir, "drone")
    os.makedirs(chase_dir, exist_ok=True)
    os.makedirs(drone_dir, exist_ok=True)

    bp_lib = world.get_blueprint_library()
    sensors: list = []

    def _make(
        rel_x: float, rel_z: float, pitch: float,
        fov: float, width: int, height: int, sensor_tick: float,
        out_dir: str,
    ) -> Any:
        bp = bp_lib.find("sensor.camera.rgb")
        bp.set_attribute("image_size_x", str(width))
        bp.set_attribute("image_size_y", str(height))
        bp.set_attribute("fov", str(fov))
        bp.set_attribute("sensor_tick", str(sensor_tick))
        # Cinematic post-processing: full Unreal HDR pipeline. Histogram
        # auto-exposure mimics the human eye's dynamic-range adaptation, so
        # bright skies + dark interiors both retain detail. Bloom + lens
        # flare give bright sources their characteristic HDR halo; motion
        # blur keeps fast-moving wheels and trees from strobing at 60 FPS.
        for attr, value in (
            ("enable_postprocess_effects", "True"),
            ("exposure_mode", "histogram"),
            ("exposure_compensation", "0.0"),
            ("exposure_min_bright", "7.0"),
            ("exposure_max_bright", "9.0"),
            ("exposure_speed_up", "3.0"),
            ("exposure_speed_down", "1.0"),
            ("motion_blur_intensity", "0.5"),
            ("motion_blur_max_distortion", "0.35"),
            ("motion_blur_min_object_screen_size", "0.1"),
            ("bloom_intensity", "0.85"),
            ("lens_flare_intensity", "0.3"),
            ("chromatic_aberration_intensity", "0.0"),
            ("gamma", "2.4"),
            ("shutter_speed", "60.0"),
        ):
            if bp.has_attribute(attr):
                bp.set_attribute(attr, value)
        transform = carla.Transform(
            carla.Location(x=rel_x, y=0.0, z=rel_z),
            carla.Rotation(pitch=pitch, yaw=0.0, roll=0.0),
        )
        cam = world.spawn_actor(bp, transform, attach_to=ego)
        cam.listen(lambda image: image.save_to_disk(
            os.path.join(out_dir, f"frame-{image.frame:08d}.png")
        ))
        return cam

    # Chase: 1080p HDR @ 30 FPS (smooth cinematic, sustainable on L4 headless)
    sensors.append(_make(
        rel_x=-7.0, rel_z=2.8, pitch=-10.0, fov=85.0,
        width=1920, height=1080, sensor_tick=1.0 / 30.0,
        out_dir=chase_dir,
    ))
    # Drone: 1080p every 5 sim seconds for context
    sensors.append(_make(
        rel_x=0.0, rel_z=22.0, pitch=-90.0, fov=90.0,
        width=1920, height=1080, sensor_tick=5.0,
        out_dir=drone_dir,
    ))
    LOG.info("attached cinematic 1080p@60 HDR chase + 1080p drone cameras -> %s", output_dir)
    return sensors


# -----------------------------------------------------------------------------
# Telemetry / sensor sample assembly
# -----------------------------------------------------------------------------


def _vehicle_kph(vehicle: carla.Vehicle) -> float:
    v = vehicle.get_velocity()
    return math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3.6


def _fault_observable(fault_name: str, state: Any) -> tuple[float, float, float]:
    """Return (current_value, healthy_value, critical_value) for the fault.

    Used to compute progress toward failure, predicted RUL, and to print
    audience-facing PHM forecasts during the ramp.
    """
    if fault_name == "brake-pad-wear":
        return float(state.brake_pad_front_pct), 70.0, 18.0
    if fault_name == "coolant-overheat":
        return float(state.coolant_temp_c), 88.0, 110.0
    if fault_name == "hv-battery-imbalance":
        return float(state.hv_battery_cell_delta_mv), 8.0, 150.0
    if fault_name == "tpms-dropout":
        # Use the front-left tyre pressure as the observable.
        return float(state.tyre_pressure_kpa.get("fl", 230.0)), 230.0, 180.0
    if fault_name == "oil-low":
        return float(state.engine_oil_age_km), 9_500.0, 15_000.0
    if fault_name == "drive-belt-age":
        return float(state.drive_belt_health), 0.92, 0.45
    return 0.0, 1.0, 0.0


def _ramp_progress(value: float, healthy: float, critical: float) -> float:
    """0 healthy, 1 critical. Linearly maps the observable onto [0, 1]."""
    span = critical - healthy
    if span == 0:
        return 0.0
    p = (value - healthy) / span
    return max(0.0, min(1.0, p))


def _make_predictive_phm(
    vehicle_id: str,
    fault_name: str,
    progress: float,
    seconds_to_critical: float,
) -> PhmReadingPayload:
    """Produce an act-soon PHM reading whose RUL declines as progress grows."""
    component = FAULT_TO_COMPONENT.get(fault_name, "brakes-pads-front")
    rul_mean = max(8.0, 200.0 * (1.0 - progress))
    rul_lower = max(2.0, rul_mean * 0.4)
    rul_upper = rul_mean * 1.4
    p_fail = max(0.05, min(0.95, 0.05 + 0.85 * progress))
    return PhmReadingPayload(
        vehicleId=vehicle_id,
        component=component,  # type: ignore[arg-type]
        tier=1,
        state="act-soon",
        pFail1000km=p_fail,
        pFailLower=max(0.01, p_fail - 0.15),
        pFailUpper=min(0.99, p_fail + 0.15),
        rulKmMean=rul_mean,
        rulKmLower=rul_lower,
        modelSource="physics-of-failure",
        featuresVersion="v1",
        updatedAt=now_iso(),
        suspectedSensorFailure=False,
    )


def _frame_from_carla(ego: carla.Vehicle, state: Any, t: float) -> TraceFrame:
    """Build a TraceFrame from live CARLA telemetry + virtual fault state."""
    tr = ego.get_transform()
    v = ego.get_velocity()
    a = ego.get_acceleration()
    av = ego.get_angular_velocity()
    speed_kph = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3.6
    return TraceFrame(
        t=t,
        x=tr.location.x,
        y=tr.location.y,
        heading_deg=tr.rotation.yaw,
        speed_kph=speed_kph,
        accel_x=a.x,
        accel_y=a.y,
        yaw_rate=av.z,
        gnss_lat=tr.location.x,
        gnss_lng=tr.location.y,
        brake_pad_pct=float(getattr(state, "brake_pad_front_pct", 70.0)),
        coolant_temp_c=float(getattr(state, "coolant_temp_c", 88.0)),
        hv_battery_soc_pct=float(getattr(state, "hv_battery_soc_pct", 78.0)),
        hv_battery_cell_delta_mv=float(getattr(state, "hv_battery_cell_delta_mv", 8.0)),
        tpms=dict(getattr(state, "tpms_status", {"fl": "ok", "fr": "ok", "rl": "ok", "rr": "ok"})),
        tyre_pressure_kpa=dict(getattr(state, "tyre_pressure_kpa", {"fl": 230.0, "fr": 230.0, "rl": 230.0, "rr": 230.0})),
        engine_oil_age_km=float(getattr(state, "engine_oil_age_km", 9500.0)),
        drive_belt_health=float(getattr(state, "drive_belt_health", 0.92)),
    )


def _build_live_frame(
    ego: carla.Vehicle, state: Any, control: Optional[carla.VehicleControl] = None
) -> dict:
    """Build a minimal-plus LiveTelemetryFrame for the autonomy live hub.

    Populates the schema's required fields (ts, origin, speedKph, headingDeg,
    brakePadFrontPercent, hvSocPercent, coolantTempC, tpms) plus driver-input
    + GPS + acceleration so the dashboard's KPI band, sensor strip, and
    chassis section all light up with real CARLA values.
    """
    tr = ego.get_transform()
    v = ego.get_velocity()
    a = ego.get_acceleration()
    speed_kph = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3.6
    heading = float(tr.rotation.yaw) % 360.0
    if heading < 0:
        heading += 360.0
    tyre_p = getattr(state, "tyre_pressure_kpa", {}) or {}
    frame: dict = {
        "ts": now_iso(),
        "origin": "sim",
        "simSource": "carla-live",
        "speedKph": float(min(400.0, max(0.0, speed_kph))),
        "headingDeg": float(min(360.0, max(0.0, heading))),
        "brakePadFrontPercent": float(min(100.0, max(0.0,
            float(getattr(state, "brake_pad_front_pct", 70.0))))),
        "hvSocPercent": float(min(100.0, max(0.0,
            float(getattr(state, "hv_battery_soc_pct", 78.0))))),
        "coolantTempC": float(min(150.0, max(-40.0,
            float(getattr(state, "coolant_temp_c", 88.0))))),
        "tpms": {
            "fl": float(tyre_p.get("fl", 230.0)),
            "fr": float(tyre_p.get("fr", 230.0)),
            "rl": float(tyre_p.get("rl", 230.0)),
            "rr": float(tyre_p.get("rr", 230.0)),
        },
        "gps": {"lat": float(tr.location.x), "lng": float(tr.location.y)},
        "accel": {"x": float(a.x), "y": float(a.y), "z": float(a.z)},
    }
    if control is not None:
        frame["throttle"] = float(min(1.0, max(0.0, getattr(control, "throttle", 0.0))))
        frame["brake"] = float(min(1.0, max(0.0, getattr(control, "brake", 0.0))))
        frame["steering"] = float(min(1.0, max(-1.0, getattr(control, "steer", 0.0))))
        frame["gear"] = int(getattr(control, "gear", 1))
    return frame


def _make_phm(vehicle_id: str, fault_name: str) -> PhmReadingPayload:
    component = FAULT_TO_COMPONENT.get(fault_name, "brakes-pads-front")
    return PhmReadingPayload(
        vehicleId=vehicle_id,
        component=component,  # type: ignore[arg-type]
        tier=1,
        state="critical",
        pFail1000km=0.92,
        pFailLower=0.78,
        pFailUpper=0.97,
        rulKmMean=22.0,
        rulKmLower=8.0,
        modelSource="physics-of-failure",
        featuresVersion="v1",
        updatedAt=now_iso(),
        suspectedSensorFailure=False,
    )


# -----------------------------------------------------------------------------
# Brake degradation effect
# -----------------------------------------------------------------------------


def _apply_brake_degradation(
    base_control: carla.VehicleControl, brake_pad_pct: float
) -> carla.VehicleControl:
    """Simulate the effect of failing brakes on the vehicle.

    As pad thickness drops below 35%, brake demand only partially translates
    to wheel friction. The agent commands brake=1.0 but the car only delivers
    a fraction. Below 15% the brake effort barely registers — exactly the
    failure mode that makes prompt service safety-critical.
    """
    if brake_pad_pct >= 50:
        return base_control
    if brake_pad_pct >= 35:
        factor = 0.85
    elif brake_pad_pct >= 25:
        factor = 0.6
    elif brake_pad_pct >= 15:
        factor = 0.35
    else:
        factor = 0.18
    new_control = carla.VehicleControl(
        throttle=base_control.throttle,
        steer=base_control.steer,
        brake=max(0.0, min(1.0, base_control.brake * factor)),
        hand_brake=base_control.hand_brake,
        reverse=base_control.reverse,
        manual_gear_shift=base_control.manual_gear_shift,
        gear=base_control.gear,
    )
    return new_control


# -----------------------------------------------------------------------------
# Driving controller: TrafficManager autopilot for warm-up + return,
# BasicAgent for the routed leg to/from the service centre when available.
# -----------------------------------------------------------------------------


class DrivingController:
    def __init__(
        self,
        ego: carla.Vehicle,
        tm: carla.TrafficManager,
        world: carla.World,
    ) -> None:
        self.ego = ego
        self.tm = tm
        self.world = world
        self._mode = "autopilot"
        self._agent = None
        self._target: Optional[carla.Transform] = None

    def use_autopilot(self) -> None:
        self.ego.set_autopilot(True, self.tm.get_port())
        self._mode = "autopilot"
        self._agent = None
        LOG.info("controller: autopilot")

    def route_to(self, target: carla.Transform) -> None:
        self._target = target
        if HAS_AGENTS:
            self.ego.set_autopilot(False)
            self._agent = BasicAgent(self.ego, target_speed=30)
            self._agent.set_destination(target.location)
            self._agent.follow_speed_limits(True)
            self._mode = "agent"
            LOG.info("controller: BasicAgent routing to %s", target.location)
        else:
            # Fallback: keep autopilot enabled but ask TM to navigate near the
            # target. CARLA's TM doesn't expose a true goal API, so we set a
            # high speed-difference penalty if we're past the target.
            self.ego.set_autopilot(True, self.tm.get_port())
            self._mode = "tm-toward-target"
            LOG.info("controller: TM-only mode (agents module not installed); will check arrival manually")

    def arrival_distance_m(self) -> float:
        if self._target is None:
            return float("inf")
        here = self.ego.get_transform().location
        return here.distance(self._target.location)

    def step(self, brake_pad_pct: float) -> None:
        if self._mode == "agent" and self._agent is not None:
            ctrl = self._agent.run_step()
            ctrl = _apply_brake_degradation(ctrl, brake_pad_pct)
            self.ego.apply_control(ctrl)
        elif self._mode == "autopilot":
            # When brakes are degraded, tell the TM to slow this vehicle.
            if brake_pad_pct < 35:
                self.tm.vehicle_percentage_speed_difference(self.ego, 60)
            elif brake_pad_pct < 50:
                self.tm.vehicle_percentage_speed_difference(self.ego, 30)


# -----------------------------------------------------------------------------
# Main async loop
# -----------------------------------------------------------------------------


async def run_live(args: argparse.Namespace) -> int:
    settings = load_settings()
    api_base = args.api_base or settings.vsbs_api_base
    vehicle_id = args.vehicle_id

    # Resolve --fault random at runtime so each demo picks a different
    # subsystem. This makes the audience see a different failure mode
    # each time the demo runs and proves the predictive pipeline is
    # generic across the six fault families.
    if args.fault == "random":
        rng = random.Random(args.seed if args.seed else None)
        args.fault = rng.choice(ALL_FAULTS)
        LOG.info("random fault selected: %s", args.fault)

    # Connect to CARLA and load town. When the cinematic capture is on,
    # tick the world at 30 Hz — high enough to keep cinematic motion
    # smooth, low enough that CARLA's render thread keeps up with our
    # 6-camera load on a single L4 in headless mode (Epic + 60 Hz tripped
    # GameThread/RenderThread mismatch).
    client = _connect(args.carla_host, args.carla_port)
    world_dt = (1.0 / 30.0) if args.screenshot_dir else 0.05
    world = _load_world(client, args.town, no_render=args.no_render,
                        fixed_delta_seconds=world_dt)
    tm = client.get_trafficmanager(8000)
    tm.set_synchronous_mode(True)
    tm.set_global_distance_to_leading_vehicle(2.5)
    tm.global_percentage_speed_difference(15.0)

    ego = _spawn_ego(world, args.ego_blueprint)
    npcs: list[carla.Vehicle] = []
    if not args.no_traffic:
        npcs = _spawn_npcs(world, tm, args.npc_count, args.seed)

    sc_target = _service_centre_target(world, ego)
    home_target = _home_target(world)

    controller = DrivingController(ego, tm, world)
    controller.use_autopilot()

    # API + orchestrator.
    api = VsbsApi(api_base, owner_id=vehicle_id)
    bootstrap = await api.bootstrap_consent(vehicle_id)
    if bootstrap:
        LOG.info("bootstrap-consent granted %d purposes",
                 len(bootstrap.get("purposes", [])))

    component = FAULT_TO_COMPONENT.get(args.fault, "brakes-pads-front")
    ctx = OrchestratorContext(
        vehicle_id=vehicle_id,
        fault_name=args.fault,
        component_id=component,
        sc_count=3,
        dwell_seconds_at_sc=8.0,
        warmup_seconds=args.warmup_seconds,
    )
    orchestrator = DemoOrchestrator(api, ctx)

    # Build the fault scheduler. We override the default duration so the
    # demo runs in ~30s of fault ramp (you can tune via --fault-duration-s).
    scheduler = FaultScheduler()
    fault = build_fault(args.fault)
    if hasattr(fault, "duration_s"):
        fault.duration_s = args.fault_duration_s  # type: ignore[attr-defined]
    scheduler.schedule(fault, after_s=args.warmup_seconds)

    fault_triggered = False
    routed_to_sc = False
    arrived_at_sc = False
    services_started_at: Optional[float] = None
    return_grant_minted = False
    routed_home = False
    halted_for_tow = False

    sim_t = 0.0
    last_ingest = -1.0
    last_forecast = -10.0  # seconds; throttle audience-facing forecasts
    last_live_post = -1.0  # seconds; throttle autonomy live-hub posts
    INGEST_PERIOD = 1.0  # 1 sample batch per simulated second
    FORECAST_PERIOD = 3.0  # one PHM forecast line every 3 sim seconds
    LIVE_POST_PERIOD = 0.1  # 10 Hz LiveTelemetryFrame to autonomy hub
    # Trigger booking *predictively* once the fault ramp crosses 60% of
    # the way to critical. That means the booking is created BEFORE the
    # observable hits the critical threshold - the audience sees PHM
    # extrapolating forward and acting on the prediction.
    PREDICT_TRIGGER = 0.6
    # Hard halt. If the predictive booking happens but the fault still
    # crosses full-critical before the ego reaches the SC, the autopilot
    # cannot continue safely. We force a tow.
    TOW_HALT_PROGRESS = 0.99
    # Stuck watchdog. While routed (DRIVING_TO_SC or DRIVING_HOME),
    # if speed stays under 1 km/h for STUCK_SECONDS consecutive sim
    # seconds, treat the autopilot as failed and trigger a tow.
    STUCK_SECONDS = 12.0
    stuck_since: Optional[float] = None

    screenshot_cameras: list = []
    if args.screenshot_dir:
        screenshot_cameras = _attach_screenshot_cameras(world, ego, args.screenshot_dir)

    # Spawn a full CARLA-native sensor suite (GNSS + IMU + 8 cams + 4 radars
    # + LiDAR + obstacle + collision). Their listeners cache the latest
    # samples; LiveFrameBuilder.build() pulls from them every 100 ms to
    # emit a complete LiveTelemetryFrame keyed off CARLA truth.
    live_builder: Optional[LiveFrameBuilder] = None
    snapshot_dir = os.environ.get("VSBS_CAMERA_SNAPSHOT_DIR")
    if snapshot_dir:
        snapshot_dir = os.path.join(snapshot_dir, vehicle_id)
    try:
        live_builder = LiveFrameBuilder(world, ego, snapshot_dir=snapshot_dir)
        LOG.info("LiveFrameBuilder attached %d CARLA-native sensors (snapshots -> %s)",
                 len(live_builder._sensors), snapshot_dir or "disabled")
    except Exception as err:
        LOG.warning("LiveFrameBuilder failed to attach (%s); dashboard will use minimal frames", err)

    # Dashboard booking id == vehicle id. The autonomy live hub keys by this
    # id; the bridge posts a LiveTelemetryFrame at ~10 Hz so the web
    # dashboard at /autonomy/<vehicle_id> shows real CARLA values live.
    dashboard_booking_id = vehicle_id
    public_dashboard_path = f"/autonomy/{dashboard_booking_id}"
    LOG.info("=" * 72)
    LOG.info("DASHBOARD URL: http://<vm-public-ip>:3000%s", public_dashboard_path)
    LOG.info("(replace <vm-public-ip> with the VM's external IP)")
    LOG.info("=" * 72)

    LOG.info("=== entering main loop ===")
    await orchestrator.begin()
    try:
        await api.autonomy_event(
            dashboard_booking_id,
            category="scenario",
            severity="info",
            title=f"CARLA live demo started: town={args.town} fault={args.fault}",
            detail=f"vehicleId={vehicle_id} warmup={args.warmup_seconds}s "
                   f"fault-duration={args.fault_duration_s}s",
        )
    except Exception:
        pass

    try:
        start_wall = time.monotonic()
        while sim_t < args.max_runtime_s:
            world.tick()
            sim_t += 0.05
            scheduler.tick(sim_t)

            # Stream telemetry once per simulated second using the same
            # SensorSamplePayload channels as the replay bridge so consent
            # gate, schema validators and PHM ingest don't see two flavours.
            if not args.scenario_only and sim_t - last_ingest >= INGEST_PERIOD:
                last_ingest = sim_t
                frame = _frame_from_carla(ego, scheduler.state, sim_t)
                samples = _shared_build_samples(
                    vehicle_id, scheduler.state, frame, sim_source="carla"
                )
                try:
                    await api.ingest_samples(vehicle_id, samples)
                except Exception as err:
                    LOG.warning("ingest failed (%s)", err)

            # Compute fault progress first so the live frame builder can
            # surface R157 ladder + capability budget tied to real progress.
            brake_pad_pct = float(getattr(scheduler.state, "brake_pad_front_pct", 70.0))
            controller.step(brake_pad_pct)

            value, healthy, critical = _fault_observable(args.fault, scheduler.state)
            progress = _ramp_progress(value, healthy, critical)
            unit = FAULT_UNIT.get(args.fault, "")

            # 10 Hz LiveTelemetryFrame to the autonomy live hub so the
            # /autonomy/<id> dashboard renders real CARLA values. Frames
            # are tagged with a `provenance` map for downstream auditability.
            if sim_t - last_live_post >= LIVE_POST_PERIOD and live_builder is not None:
                last_live_post = sim_t
                try:
                    sc_loc = sc_target.location if sc_target is not None else None
                    live_frame = live_builder.build(
                        scheduler.state,
                        sc_target_location=sc_loc,
                        fault_progress=progress,
                        active_fault=args.fault,
                    )
                    await api.autonomy_telemetry(dashboard_booking_id, live_frame)
                except Exception as err:
                    LOG.debug("autonomy.telemetry failed: %s", err)

            # Periodic forecast print so the audience watches the prediction
            # trend BEFORE the booking fires. e.g.:
            #   PHM forecast t=14s  brake-pad 41.3% (28% to critical)  RUL=87 km
            if sim_t - last_forecast >= FORECAST_PERIOD and sim_t > args.warmup_seconds:
                last_forecast = sim_t
                pct_to_crit = (1.0 - progress) * 100.0
                rul_km = max(8.0, 200.0 * (1.0 - progress))
                LOG.info(
                    "PHM forecast t=%4.1fs  %s  obs=%6.1f%s  progress=%5.1f%%  RUL=%5.1f km  trend=declining",
                    sim_t,
                    FAULT_DESCRIPTION.get(args.fault, args.fault),
                    value,
                    unit,
                    progress * 100.0,
                    rul_km,
                )

            # Predictive trigger: once the fault is 60% of the way to its
            # critical threshold, fire fault_detected. This is BEFORE the
            # underlying fault reports critical itself (which happens at
            # progress = 1.0). The booking is therefore the result of a
            # forward-looking PHM forecast, not a reaction.
            if not fault_triggered and progress >= PREDICT_TRIGGER:
                fault_triggered = True
                eta_to_critical_s = max(
                    1.0,
                    args.fault_duration_s * (1.0 - progress),
                )
                LOG.info(
                    "PHM predictive alert at t=%.1f  observable=%.1f%s  progress=%.1f%%  "
                    "predicted-critical-in=%.0fs  ===> drafting booking pre-emptively",
                    sim_t, value, unit, progress * 100.0, eta_to_critical_s,
                )
                reading = _make_predictive_phm(
                    vehicle_id, args.fault, progress, eta_to_critical_s,
                )
                await orchestrator.fault_detected(reading)
                try:
                    await api.autonomy_event(
                        dashboard_booking_id,
                        category="phm",
                        severity="alert",
                        title=f"Predictive {args.fault} alert",
                        detail=f"observable={value:.1f}{unit} progress={progress*100:.0f}% "
                               f"predicted-critical-in={eta_to_critical_s:.0f}s",
                    )
                except Exception:
                    pass

            if fault_triggered and not routed_to_sc and orchestrator.record.state == "DRIVING_TO_SC":
                LOG.info("outbound grant minted; switching driver to BasicAgent -> SC")
                controller.route_to(sc_target)
                routed_to_sc = True
                try:
                    await api.autonomy_event(
                        dashboard_booking_id,
                        category="autonomy",
                        severity="info",
                        title="Outbound CommandGrant active",
                        detail="ego routing to chosen service centre",
                    )
                except Exception:
                    pass

            # Tow-truck watchdog. Active only while routed and not yet
            # at the SC / home. Two trip-wires:
            #   1. fault progress >= 0.99 while still en route -> the
            #      prediction came true and the auto-driver can no
            #      longer be trusted to finish the leg safely;
            #   2. ego speed < 1 km/h for STUCK_SECONDS consecutive
            #      sim seconds while a route is set -> stuck / blocked
            #      / controller bug.
            if (
                not halted_for_tow
                and orchestrator.record.state in ("DRIVING_TO_SC", "DRIVING_HOME")
            ):
                ego_speed = _vehicle_kph(ego)
                if progress >= TOW_HALT_PROGRESS:
                    halted_for_tow = True
                    LOG.warning(
                        "TOW REQUIRED  fault progress=%.0f%% (full critical reached "
                        "en route)  observable=%.1f%s  ===> halting + escalating",
                        progress * 100.0, value, unit,
                    )
                    controller.ego.set_autopilot(False)
                    controller.ego.apply_control(
                        carla.VehicleControl(brake=1.0, hand_brake=True)
                    )
                    await orchestrator.halt_for_tow(
                        f"{FAULT_DESCRIPTION.get(args.fault, args.fault)} reached "
                        f"critical en route (progress {progress * 100:.0f}%); "
                        f"auto-driving cannot safely continue"
                    )
                    break
                if ego_speed < 1.0:
                    if stuck_since is None:
                        stuck_since = sim_t
                    elif sim_t - stuck_since >= STUCK_SECONDS:
                        halted_for_tow = True
                        LOG.warning(
                            "TOW REQUIRED  ego stuck for %.0fs (speed < 1 km/h)  "
                            "===> halting + escalating",
                            sim_t - stuck_since,
                        )
                        controller.ego.set_autopilot(False)
                        controller.ego.apply_control(
                            carla.VehicleControl(brake=1.0, hand_brake=True)
                        )
                        await orchestrator.halt_for_tow(
                            f"auto-driver stuck for {sim_t - stuck_since:.0f}s "
                            f"(speed < 1 km/h while routed). Sensor fault or "
                            f"blocked route suspected."
                        )
                        break
                else:
                    stuck_since = None

            if routed_to_sc and not arrived_at_sc:
                d = controller.arrival_distance_m()
                if d < 8.0:
                    LOG.info("arrived at SC (distance=%.1fm)", d)
                    await orchestrator.arrive_at_sc()
                    arrived_at_sc = True
                    services_started_at = sim_t
                    # Stop the ego at the SC.
                    controller.ego.apply_control(carla.VehicleControl(brake=1.0))
                    controller.ego.set_autopilot(False)
                    try:
                        await api.autonomy_event(
                            dashboard_booking_id,
                            category="navigation",
                            severity="info",
                            title="Arrived at service centre",
                            detail=f"distance-to-target={d:.1f}m",
                        )
                    except Exception:
                        pass

            if (services_started_at is not None and not return_grant_minted
                    and sim_t - services_started_at >= ctx.dwell_seconds_at_sc):
                LOG.info("service complete; minting return grant")
                await orchestrator.service_complete()
                return_grant_minted = True
                try:
                    await api.autonomy_event(
                        dashboard_booking_id,
                        category="autonomy",
                        severity="info",
                        title="Service complete; return grant minted",
                    )
                except Exception:
                    pass

            if (return_grant_minted and not routed_home
                    and orchestrator.record.state == "DRIVING_HOME"):
                LOG.info("return grant active; routing home")
                controller.route_to(home_target)
                routed_home = True

            if routed_home and controller.arrival_distance_m() < 8.0:
                LOG.info("arrived home; closing loop")
                await orchestrator.returned_home()
                try:
                    await api.autonomy_event(
                        dashboard_booking_id,
                        category="scenario",
                        severity="info",
                        title="Returned home; booking closed",
                    )
                except Exception:
                    pass
                break

            # Wall-clock guard: if the server is slow, abort early.
            if time.monotonic() - start_wall > args.max_runtime_s + 60:
                LOG.error("wall-clock guard tripped; aborting")
                break

        LOG.info("=== final state: %s ===", orchestrator.record.state)
    finally:
        for cam in screenshot_cameras:
            try:
                cam.stop()
            except Exception:
                pass
            try:
                cam.destroy()
            except Exception:
                pass
        if live_builder is not None:
            try:
                live_builder.destroy()
            except Exception:
                pass
        try:
            tm.set_synchronous_mode(False)
            settings = world.get_settings()
            settings.synchronous_mode = False
            world.apply_settings(settings)
        except Exception:
            pass
        for npc in npcs:
            try:
                npc.destroy()
            except Exception:
                pass
        try:
            ego.destroy()
        except Exception:
            pass
        await api.aclose()

    return 0 if orchestrator.record.state == "DONE" else 1


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = parse_args(argv)
    try:
        return asyncio.run(run_live(args))
    except KeyboardInterrupt:
        return 130
    except RuntimeError as err:
        print(f"live demo failed: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
