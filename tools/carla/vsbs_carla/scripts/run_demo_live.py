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
    parser.add_argument("--fault", default="brake-pad-wear")
    parser.add_argument("--fault-duration-s", default=30.0, type=float,
                        help="Time to fully ramp the fault from healthy to critical.")
    parser.add_argument("--vehicle-id", default="carla-veh-live")
    parser.add_argument("--max-runtime-s", default=480.0, type=float,
                        help="Hard ceiling on the entire demo (in sim seconds).")
    parser.add_argument("--no-traffic", action="store_true")
    parser.add_argument("--seed", default=42, type=int)
    parser.add_argument("--scenario-only", action="store_true",
                        help="Skip /v1/sensors/ingest; useful for low-disk smoke runs.")
    parser.add_argument("--api-base", default=None)
    return parser.parse_args(argv)


# -----------------------------------------------------------------------------
# CARLA helpers
# -----------------------------------------------------------------------------


def _connect(host: str, port: int, timeout_s: float = 60.0) -> carla.Client:
    client = carla.Client(host, port)
    client.set_timeout(timeout_s)
    LOG.info("connected to CARLA %s:%d server-version=%s client-version=%s",
             host, port, client.get_server_version(), client.get_client_version())
    return client


def _load_world(client: carla.Client, town: str) -> carla.World:
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
    settings.fixed_delta_seconds = 0.05  # 20 Hz
    settings.substepping = True
    settings.max_substep_delta_time = 0.01
    settings.max_substeps = 10
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


# -----------------------------------------------------------------------------
# Telemetry / sensor sample assembly
# -----------------------------------------------------------------------------


def _vehicle_kph(vehicle: carla.Vehicle) -> float:
    v = vehicle.get_velocity()
    return math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3.6


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

    # Connect to CARLA and load town.
    client = _connect(args.carla_host, args.carla_port)
    world = _load_world(client, args.town)
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

    sim_t = 0.0
    last_ingest = -1.0
    INGEST_PERIOD = 1.0  # 1 sample batch per simulated second

    LOG.info("=== entering main loop ===")
    await orchestrator.begin()

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

            # Detect critical fault.
            brake_pad_pct = float(getattr(scheduler.state, "brake_pad_front_pct", 70.0))
            controller.step(brake_pad_pct)

            if not fault_triggered and scheduler.any_critical() is not None:
                fault_triggered = True
                LOG.info("PHM critical at t=%.1f (brake_pad_pct=%.1f)", sim_t, brake_pad_pct)
                reading = _make_phm(vehicle_id, args.fault)
                await orchestrator.fault_detected(reading)

            if fault_triggered and not routed_to_sc and orchestrator.record.state == "DRIVING_TO_SC":
                LOG.info("outbound grant minted; switching driver to BasicAgent → SC")
                controller.route_to(sc_target)
                routed_to_sc = True

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

            if (services_started_at is not None and not return_grant_minted
                    and sim_t - services_started_at >= ctx.dwell_seconds_at_sc):
                LOG.info("service complete; minting return grant")
                await orchestrator.service_complete()
                return_grant_minted = True

            if (return_grant_minted and not routed_home
                    and orchestrator.record.state == "DRIVING_HOME"):
                LOG.info("return grant active; routing home")
                controller.route_to(home_target)
                routed_home = True

            if routed_home and controller.arrival_distance_m() < 8.0:
                LOG.info("arrived home; closing loop")
                await orchestrator.returned_home()
                break

            # Wall-clock guard: if the server is slow, abort early.
            if time.monotonic() - start_wall > args.max_runtime_s + 60:
                LOG.error("wall-clock guard tripped; aborting")
                break

        LOG.info("=== final state: %s ===", orchestrator.record.state)
    finally:
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
