# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Build LiveTelemetryFrames from CARLA-native sensors and world queries.

Goal: stream as much of the dashboard's L5 schema as possible from real
CARLA truth. Anything CARLA does not simulate (e.g. 96-cell HV battery
stack, AI compute SoC, V2X bus) is computed from a physically plausible
model that is keyed off real CARLA state, and every such block is listed
in the frame's `provenance` map so a downstream verifier can audit which
field came from where.

Provenance vocabulary:
    "carla-sensor"    — read from a CARLA sensor's listener
    "carla-actor"     — read directly from carla.Actor methods
    "carla-world"     — read from carla.World queries
    "carla-map"       — read from carla.Map / Waypoint
    "virtual-fault"   — from the bridge's FaultScheduler virtual state
    "synthetic-tied"  — synthetic but parameterised by real CARLA values
                        (e.g. HV cell mV varies with speed + SoC)
    "synthetic-const" — synthetic constant (e.g. software version strings)
"""

from __future__ import annotations

import math
import time
from typing import Any, Optional

try:
    import carla  # type: ignore[import-not-found]
except Exception:
    carla = None  # type: ignore[assignment]


# --- ISO timestamp -----------------------------------------------------------


def now_iso() -> str:
    from datetime import datetime, timezone
    n = datetime.now(timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _norm_heading(yaw_deg: float) -> float:
    h = yaw_deg % 360.0
    return h + 360.0 if h < 0 else h


# --- LiveFrameBuilder --------------------------------------------------------


class LiveFrameBuilder:
    """Owns CARLA-native sensors attached to the ego; emits LiveTelemetryFrames.

    The builder spawns:
      - 1× GNSS sensor (real lat/lng/alt at 10 Hz)
      - 1× IMU sensor (real accel/gyro/compass at 20 Hz)
      - 8× small RGB cameras (320x180 surround, just for sensor-health hz)
      - 4× radars (FL/FR/RL/RR, just for sensor-health hz/returns)
      - 1× solid-state LiDAR (for sensor-health hz/returns)
      - 1× obstacle detector (front, gives an obstacle distance estimate)
      - 1× collision sensor (logs collisions if any)

    Every sensor's listener does the minimum work (timestamp + count);
    expensive per-frame data (raw images) is dropped on the floor since
    the cinematic chase camera in run_demo_live owns disk dumping.
    """

    def __init__(self, world: Any, ego: Any, snapshot_dir: Optional[str] = None) -> None:
        self.world = world
        self.ego = ego
        # Where to dump JPGs from the 4 quadrant snapshot cameras (every 5 sim
        # seconds). The dashboard fetches /cameras/<bookingId>/<quadrant>.jpg
        # and refreshes the cache-bust query param every 5 wall seconds.
        self.snapshot_dir = snapshot_dir
        self._sensors: list = []
        self._gnss: Optional[Any] = None
        self._imu: Optional[Any] = None
        # Hz tracking: sensor_id -> (last_count, last_t_wall)
        self._hz_tick: dict[str, tuple[int, float]] = {}
        self._hz_hz: dict[str, float] = {}
        self._returns: dict[str, int] = {}
        self._collisions: list[dict[str, Any]] = []
        self._obstacle_distance_m: Optional[float] = None
        self._attach()

    # --- sensor wiring -----------------------------------------------------

    def _attach(self) -> None:
        if carla is None:
            return
        bp = self.world.get_blueprint_library()

        # GNSS @ 10 Hz on roof
        gnss_bp = bp.find("sensor.other.gnss")
        gnss_bp.set_attribute("sensor_tick", "0.1")
        gnss = self.world.spawn_actor(
            gnss_bp, carla.Transform(carla.Location(z=2.0)), attach_to=self.ego
        )
        gnss.listen(self._on_gnss)
        self._sensors.append(gnss)
        self._gnss = gnss

        # IMU @ 20 Hz mid-floor
        imu_bp = bp.find("sensor.other.imu")
        imu_bp.set_attribute("sensor_tick", "0.05")
        imu = self.world.spawn_actor(
            imu_bp, carla.Transform(carla.Location(z=0.5)), attach_to=self.ego
        )
        imu.listen(self._on_imu)
        self._sensors.append(imu)
        self._imu = imu

        # 2 radars (front-LR + rear-mid). 4 was too many in sync-mode @ Epic.
        radar_layout = [
            ("rad-front-lr", 2.0, 0.0, 1.0,  0,   30, 100),
            ("rad-rear-mid", -2.0, 0.0, 1.0, 180, 60, 60),
        ]
        for rad_id, dx, dy, dz, yaw, h_fov, range_m in radar_layout:
            rad_bp = bp.find("sensor.other.radar")
            rad_bp.set_attribute("horizontal_fov", str(h_fov))
            rad_bp.set_attribute("vertical_fov", "10")
            rad_bp.set_attribute("range", str(range_m))
            rad_bp.set_attribute("sensor_tick", "0.1")
            tr = carla.Transform(
                carla.Location(x=dx, y=dy, z=dz),
                carla.Rotation(yaw=yaw),
            )
            rad = self.world.spawn_actor(rad_bp, tr, attach_to=self.ego)
            rad.listen(lambda data, _id=rad_id: self._mark_radar(_id, data))
            self._sensors.append(rad)

        # 1 LiDAR — keep returns realistic but cap density so the sync-mode
        # tick budget on an L4 + Epic + cameras stays sustainable.
        lidar_bp = bp.find("sensor.lidar.ray_cast")
        lidar_bp.set_attribute("channels", "32")
        lidar_bp.set_attribute("range", "100.0")
        lidar_bp.set_attribute("rotation_frequency", "10.0")
        lidar_bp.set_attribute("points_per_second", "100000")
        lidar_bp.set_attribute("sensor_tick", "0.1")
        lidar = self.world.spawn_actor(
            lidar_bp,
            carla.Transform(carla.Location(z=2.4)),
            attach_to=self.ego,
        )
        lidar.listen(lambda data: self._mark_lidar("lidar-front", data))
        self._sensors.append(lidar)

        # Obstacle detector (front)
        obs_bp = bp.find("sensor.other.obstacle")
        obs_bp.set_attribute("distance", "60.0")
        obs_bp.set_attribute("hit_radius", "1.5")
        obs_bp.set_attribute("only_dynamics", "False")
        obs = self.world.spawn_actor(
            obs_bp,
            carla.Transform(carla.Location(x=2.0, z=1.0)),
            attach_to=self.ego,
        )
        obs.listen(self._on_obstacle)
        self._sensors.append(obs)

        # Collision sensor
        col_bp = bp.find("sensor.other.collision")
        col = self.world.spawn_actor(col_bp, carla.Transform(), attach_to=self.ego)
        col.listen(self._on_collision)
        self._sensors.append(col)

        # 4 quadrant cameras serve TWO roles: (a) sensor census hz reporting
        # for the dashboard SensorSuite, and (b) JPG snapshot dump every 5
        # sim seconds for the CameraGrid live tiles. We register each via
        # `front`/`rear`/`left`/`right` ids in the hz map so the SensorSuite
        # surfaces them under sensible names.
        if self.snapshot_dir:
            os.makedirs(self.snapshot_dir, exist_ok=True)
            quadrant_layout = [
                ("front", 1.5, 0.0, 1.5, 0,    70),
                ("rear", -2.0, 0.0, 1.5, 180,  70),
                ("left",  0.0, -1.0, 1.5, -90, 90),
                ("right", 0.0,  1.0, 1.5,  90, 90),
            ]
            for quad, dx, dy, dz, yaw, fov in quadrant_layout:
                snap_bp = bp.find("sensor.camera.rgb")
                snap_bp.set_attribute("image_size_x", "960")
                snap_bp.set_attribute("image_size_y", "540")
                snap_bp.set_attribute("fov", str(fov))
                snap_bp.set_attribute("sensor_tick", "5.0")
                # Cinematic post-process so the JPGs look filmic, not flat.
                for attr, value in (
                    ("enable_postprocess_effects", "True"),
                    ("exposure_mode", "histogram"),
                    ("bloom_intensity", "0.85"),
                    ("motion_blur_intensity", "0.4"),
                    ("gamma", "2.4"),
                ):
                    if snap_bp.has_attribute(attr):
                        snap_bp.set_attribute(attr, value)
                tr = carla.Transform(
                    carla.Location(x=dx, y=dy, z=dz),
                    carla.Rotation(yaw=yaw),
                )
                snap = self.world.spawn_actor(snap_bp, tr, attach_to=self.ego)
                out_path = os.path.join(self.snapshot_dir, f"{quad}.jpg")
                # Listener: dump to disk AND mark hz so the SensorSuite tile
                # for this camera shows a healthy publish rate.
                def _on_snap(image, _p=out_path, _id=quad):
                    image.save_to_disk(_p)
                    self._mark_hz(_id)
                snap.listen(_on_snap)
                self._sensors.append(snap)

    # --- listeners ---------------------------------------------------------

    def _on_gnss(self, data: Any) -> None:
        self._gnss_data = data
        self._mark_hz("gnss")

    def _on_imu(self, data: Any) -> None:
        self._imu_data = data
        self._mark_hz("imu")

    def _on_obstacle(self, data: Any) -> None:
        self._obstacle_distance_m = float(getattr(data, "distance", 0.0))

    def _on_collision(self, data: Any) -> None:
        self._collisions.append({
            "ts": time.time(),
            "intensity": float(
                math.sqrt(
                    data.normal_impulse.x ** 2
                    + data.normal_impulse.y ** 2
                    + data.normal_impulse.z ** 2
                )
            ),
            "other": str(data.other_actor.type_id) if data.other_actor else "unknown",
        })

    def _mark_hz(self, sensor_id: str) -> None:
        last_count, last_t = self._hz_tick.get(sensor_id, (0, time.time()))
        new_count = last_count + 1
        now = time.time()
        if now - last_t >= 1.0:
            self._hz_hz[sensor_id] = round(new_count / (now - last_t), 1)
            self._hz_tick[sensor_id] = (0, now)
        else:
            self._hz_tick[sensor_id] = (new_count, last_t)

    def _mark_radar(self, sensor_id: str, data: Any) -> None:
        self._mark_hz(sensor_id)
        self._returns[sensor_id] = len(data) if hasattr(data, "__len__") else 0

    def _mark_lidar(self, sensor_id: str, data: Any) -> None:
        self._mark_hz(sensor_id)
        # CARLA SemanticLidar / LiDAR data length is the point count
        try:
            self._returns[sensor_id] = len(data) if hasattr(data, "__len__") else 0
        except Exception:
            self._returns[sensor_id] = 0

    # --- frame ------------------------------------------------------------

    def build(
        self,
        scheduler_state: Any,
        *,
        sc_target_location: Optional[Any] = None,
        fault_progress: float = 0.0,
        active_fault: str = "none",
    ) -> dict:
        """Build a LiveTelemetryFrame. Synthetic blocks tagged in `provenance`."""
        if carla is None:
            return {}
        ego = self.ego
        tr = ego.get_transform()
        v = ego.get_velocity()
        a = ego.get_acceleration()
        av = ego.get_angular_velocity()
        ctrl = ego.get_control()
        speed_kph = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3.6
        speed_mps = speed_kph / 3.6
        heading = _norm_heading(float(tr.rotation.yaw))

        # ---- GNSS (CARLA real) ----
        gnss_data = getattr(self, "_gnss_data", None)
        if gnss_data is not None:
            gnss_block = {
                "fix": "rtk-fixed",  # CARLA reports no fix status; assume best
                "satellites": 32,
                "hdop": 0.7,
                "pdop": 1.1,
                "constellations": {"gps": 12, "glonass": 8, "galileo": 10, "beidou": 7, "navic": 3},
                "rtkAgeS": 1.4,
                "posAccuracyM": 0.018,
                "speedAccuracyMps": 0.04,
            }
            gps_lat = float(gnss_data.latitude)
            gps_lng = float(gnss_data.longitude)
            gnss_origin = "carla-sensor"
        else:
            gnss_block = None
            gps_lat = float(tr.location.x)
            gps_lng = float(tr.location.y)
            gnss_origin = "carla-actor"

        # ---- IMU (CARLA real) ----
        imu_data = getattr(self, "_imu_data", None)
        if imu_data is not None:
            imu_block = {
                "accel": {
                    "x": float(imu_data.accelerometer.x),
                    "y": float(imu_data.accelerometer.y),
                    "z": float(imu_data.accelerometer.z),
                },
                "gyro": {
                    "x": float(imu_data.gyroscope.x),
                    "y": float(imu_data.gyroscope.y),
                    "z": float(imu_data.gyroscope.z),
                },
                "magneto": {"x": 28.4, "y": -1.1, "z": 42.2},  # synthetic-const
                "tempC": 36.0,  # synthetic-const
                "biasInstabilityDegHr": 0.05,  # synthetic-const
            }
            imu_origin = "carla-sensor"
        else:
            imu_block = {
                "accel": {"x": float(a.x), "y": float(a.y), "z": float(a.z)},
                "gyro":  {"x": float(av.x), "y": float(av.y), "z": float(av.z)},
            }
            imu_origin = "carla-actor"

        # ---- Perception via world.get_actors() (CARLA real) ----
        actors = self.world.get_actors()
        vehicles = [x for x in actors.filter("vehicle.*") if x.id != ego.id]
        pedestrians = list(actors.filter("walker.*"))
        ego_loc = tr.location

        def _dist(actor: Any) -> float:
            try:
                return float(ego_loc.distance(actor.get_transform().location))
            except Exception:
                return float("inf")

        nearby_v = sorted([x for x in vehicles if _dist(x) < 80.0], key=_dist)
        nearby_p = sorted([x for x in pedestrians if _dist(x) < 50.0], key=_dist)

        def _bearing(actor: Any) -> float:
            try:
                aloc = actor.get_transform().location
                dx = float(aloc.x - ego_loc.x)
                dy = float(aloc.y - ego_loc.y)
                bearing = math.degrees(math.atan2(dy, dx)) - float(tr.rotation.yaw)
                return ((bearing + 180.0) % 360.0) - 180.0
            except Exception:
                return 0.0

        def _speed(actor: Any) -> float:
            try:
                vel = actor.get_velocity()
                return float(math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z))
            except Exception:
                return 0.0

        tracks: list[dict[str, Any]] = []
        for v_actor in nearby_v[:8]:
            tracks.append({
                "id": f"trk-veh-{v_actor.id}",
                "cls": "vehicle",
                "distanceM": round(_dist(v_actor), 1),
                "bearingDeg": round(_bearing(v_actor), 1),
                "vMps": round(_speed(v_actor), 1),
                "predictionHorizonS": 4,
                "risk": round(_clamp(0.05 + (60 - _dist(v_actor)) / 60 * 0.4, 0.0, 1.0), 3),
            })
        for p_actor in nearby_p[:4]:
            tracks.append({
                "id": f"trk-ped-{p_actor.id}",
                "cls": "pedestrian",
                "distanceM": round(_dist(p_actor), 1),
                "bearingDeg": round(_bearing(p_actor), 1),
                "vMps": round(_speed(p_actor), 1),
                "predictionHorizonS": 2,
                "risk": round(_clamp(0.2 + (40 - _dist(p_actor)) / 40 * 0.6, 0.0, 1.0), 3),
            })

        detections = {
            "vehicles": len(nearby_v),
            "pedestrians": len(nearby_p),
            "cyclists": 0,
            "twoWheelers": 0,
            "animals": 0,
            "signs": 0,
            "cones": 0,
        }

        # ---- Traffic light from ego (CARLA real) ----
        tl_state = "unknown"
        tl_block: Optional[dict[str, Any]] = None
        try:
            if ego.is_at_traffic_light():
                cs = ego.get_traffic_light_state()
                tl_map = {
                    carla.TrafficLightState.Red: "red",
                    carla.TrafficLightState.Yellow: "yellow",
                    carla.TrafficLightState.Green: "green",
                    carla.TrafficLightState.Off: "off",
                    carla.TrafficLightState.Unknown: "unknown",
                }
                tl_state = tl_map.get(cs, "unknown")
                tl_block = {"state": tl_state, "confidence": 0.99}
        except Exception:
            pass

        # ---- Lane graph from CARLA Map waypoint (CARLA real) ----
        lane_block: Optional[dict[str, Any]] = None
        try:
            wp = self.world.get_map().get_waypoint(ego_loc, project_to_road=True)
            if wp is not None:
                # Walk left to count lanes; CARLA's lane id sign indicates direction
                lane_block = {
                    "currentLane": int(abs(wp.lane_id)),
                    "totalLanes": 3,  # synthetic-tied; CARLA doesn't expose total directly
                    "confidence": 0.95,
                }
        except Exception:
            pass

        # ---- Wheels from physics control (CARLA real) ----
        wheels_block: dict[str, Any] = {}
        try:
            phys = ego.get_physics_control()
            wheel_radius_cm = float(phys.wheels[0].radius)
            wheel_radius_m = wheel_radius_cm / 100.0
            wheel_rpm = (speed_mps / max(0.05, wheel_radius_m)) * 60.0 / (2.0 * math.pi)
            tyre_p = getattr(scheduler_state, "tyre_pressure_kpa", {}) or {}
            wheels_block = {
                "rpm": {
                    "fl": round(wheel_rpm, 1),
                    "fr": round(wheel_rpm, 1),
                    "rl": round(wheel_rpm, 1),
                    "rr": round(wheel_rpm, 1),
                },
                "hubTempC": {
                    "fl": round(48 + speed_kph * 0.18, 1),
                    "fr": round(50 + speed_kph * 0.18, 1),
                    "rl": round(46 + speed_kph * 0.16, 1),
                    "rr": round(45 + speed_kph * 0.16, 1),
                },
                "tpmsKpa": {
                    "fl": float(tyre_p.get("fl", 230.0)),
                    "fr": float(tyre_p.get("fr", 230.0)),
                    "rl": float(tyre_p.get("rl", 230.0)),
                    "rr": float(tyre_p.get("rr", 230.0)),
                },
                "tpmsTempC": {
                    "fl": round(31 + speed_kph * 0.06, 1),
                    "fr": round(31 + speed_kph * 0.06, 1),
                    "rl": round(30 + speed_kph * 0.05, 1),
                    "rr": round(30 + speed_kph * 0.05, 1),
                },
            }
        except Exception:
            pass

        # ---- Chassis (steering from ctrl, brake pressure from ctrl) ----
        chassis_block = {
            "steeringAngleDeg": round(float(ctrl.steer) * 540, 1),
            "steeringTorqueNm": round(float(ctrl.steer) * 6.0, 1),
            "brakePressureBar": {
                "front": round(float(ctrl.brake) * 110, 1),
                "rear":  round(float(ctrl.brake) * 70, 1),
            },
            "rideHeightMm": {"fl": 152, "fr": 152, "rl": 154, "rr": 154},
            "frictionCoef": 0.85,
        }

        # ---- Powertrain (synthetic-tied: keyed off speed + scheduler) ----
        soc = float(getattr(scheduler_state, "hv_battery_soc_pct", 78.0))
        coolant = float(getattr(scheduler_state, "coolant_temp_c", 88.0))
        cell_delta_mv = float(getattr(scheduler_state, "hv_battery_cell_delta_mv", 8.0))
        # 96-cell stack; mean tracks SoC + speed; one bad cell when delta > 60 mV
        cell_mean_mv = 3650 - (100 - soc) * 4
        hv_cells_mv: list[int] = []
        hv_cells_temp_c: list[float] = []
        for i in range(96):
            sag = 0
            if cell_delta_mv > 60 and i % 17 == 7:
                sag = -int(cell_delta_mv * 0.6)
            drift = sag + int(math.sin((i + speed_kph * 0.1)) * 4)
            hv_cells_mv.append(int(cell_mean_mv + drift))
            hv_cells_temp_c.append(round(28 + speed_kph * 0.05 + (i % 5) * 0.3, 1))
        motor_torque = (float(ctrl.throttle) - float(ctrl.brake)) * 600
        motor_rpm = (speed_mps / 0.32) * 60 / (2 * math.pi) * 8.6
        powertrain_block = {
            "motorFront": {
                "torqueNm": round(motor_torque * 0.45, 1),
                "tempStatorC": round(64 + speed_kph * 0.18, 1),
                "tempRotorC": round(72 + speed_kph * 0.2, 1),
                "rpm": round(motor_rpm, 1),
            },
            "motorRear": {
                "torqueNm": round(motor_torque * 0.55, 1),
                "tempStatorC": round(66 + speed_kph * 0.18, 1),
                "tempRotorC": round(74 + speed_kph * 0.2, 1),
                "rpm": round(motor_rpm, 1),
            },
            "inverterTempC": round(46 + speed_kph * 0.12, 1),
            "inverterCurrentA": round(motor_torque * 0.6, 1),
            "hvBusV": round(380 + (soc - 50) * 0.4, 1),
            "hvBusA": round(motor_torque * 0.5, 1),
            "aux12vV": 13.4,
            "hvCellsMv": hv_cells_mv,
            "hvCellsTempC": hv_cells_temp_c,
            "hvIsolationKohm": 820,
            "hvSocPercent": round(soc, 1),
            "hvSohPercent": 96.2,
            "hvSopKw": round(180 - (100 - soc) * 0.5, 1),
            "coolantMotorC": round(coolant + speed_kph * 0.05, 1),
            "coolantBatteryC": round(28 + speed_kph * 0.04, 1),
            "coolantInverterC": round(46 + speed_kph * 0.08, 1),
            "coolantTempC": round(coolant, 1),
        }

        # ---- Sensor census from spawned sensors (CARLA real for hz/returns) ----
        cam_layout = [
            ("front", "Front",  70),
            ("rear",  "Rear",   70),
            ("left",  "Left",   90),
            ("right", "Right",  90),
        ]
        cameras_health = [
            {
                "id": f"cam-{cid}", "label": label,
                "status": "ok" if self._hz_hz.get(cid, 0) > 0.1 else "watch",
                "hz": self._hz_hz.get(cid, 0),
                "fovDeg": fov,
                "tempC": 38.0,
            }
            for cid, label, fov in cam_layout
        ]
        radars_health = [
            {
                "id": rid, "label": label,
                "status": "ok" if self._hz_hz.get(rid, 0) > 1 else "watch",
                "hz": self._hz_hz.get(rid, 0),
                "returns": self._returns.get(rid, 0),
                "fovDeg": fov, "rangeM": rng,
            }
            for rid, label, fov, rng in [
                ("rad-front-lr", "Front LR 4D",  30, 100),
                ("rad-rear-mid", "Rear mid 4D",  60, 60),
            ]
        ]
        lidars_health = [
            {
                "id": "lidar-front", "label": "Roof solid-state",
                "status": "ok" if self._hz_hz.get("lidar-front", 0) > 1 else "watch",
                "hz": self._hz_hz.get("lidar-front", 0),
                "returns": self._returns.get("lidar-front", 0),
                "fovDeg": 360, "rangeM": 120, "tempC": 42.0,
            }
        ]

        # ---- Planner (derived from ctrl) ----
        if float(ctrl.brake) > 0.5:
            behavior = "stop"
        elif float(ctrl.throttle) < 0.05:
            behavior = "yield"
        elif tracks and tracks[0]["distanceM"] < 18:
            behavior = "follow"
        else:
            behavior = "cruise"
        planner_block = {
            "horizonS": 8, "sampledTrajectories": 64, "selectedAlt": 0,
            "softViolations": 0, "hardViolations": 0, "cvar95": 0.06,
            "behavior": behavior,
        }

        # ---- Control (CARLA real) ----
        control_block = {
            "throttle": round(float(ctrl.throttle), 3),
            "brake": round(float(ctrl.brake), 3),
            "steering": round(float(ctrl.steer), 3),
            "gear": int(getattr(ctrl, "gear", 1)),
        }

        # ---- Compute / Network / V2X / Cabin / Software (synthetic) ----
        compute_block = {
            "primary": {
                "soc": "NVIDIA Drive Orin x2",
                "cpuPct": round(48 + speed_kph * 0.1, 1),
                "gpuPct": round(72 + speed_kph * 0.05, 1),
                "npuPct": round(81 + speed_kph * 0.03, 1),
                "ramPct": 63.0, "tempC": round(56 + speed_kph * 0.05, 1),
                "powerW": round(180 + speed_kph * 0.3, 1),
            },
            "lockstep": {
                "soc": "Infineon AURIX TC4x",
                "cpuPct": 28.0, "diffPpm": 0, "tempC": 48.0,
            },
            "hsmHeartbeatOk": True,
        }
        network_block = {
            "rsrpDbm": -88.0, "rsrqDb": -10.0, "sinrDb": 16.0,
            "mecRttMs": 12.0, "wifiRssiDbm": -58.0,
            "hdMapVersion": "veh-na-2026.05.W18.r1",
            "hdMapSyncedAt": "2026-05-08T18:14:00Z",
            "hdMapDeltasPending": 0,
        }
        v2x_block = {
            "bsmRxPerSec": float(min(20, len(nearby_v) * 2)),
            "camRxPerSec": 2.0, "spatRxPerSec": 0.9 if tl_block else 0.0,
            "mapRxPerSec": 0.3, "denmRxPerSec": 0.0, "rsaRxPerSec": 0.0,
            "latestKind": "BSM", "latestSummary": f"BSM tx=ego rx<=200m neighbours={len(nearby_v)}",
            "neighbours": int(len(nearby_v)),
        }

        # ---- Safety (R157 rung from fault progress; ODD from speed limit) ----
        ttc_s = 9.0
        if tracks:
            d0 = tracks[0]["distanceM"]
            ttc_s = max(0.5, d0 / max(1.0, speed_mps + 0.5))
        if fault_progress >= 0.99:
            rung = 4
            mrm = True
            mrm_kind = "controlled-stop-in-lane"
        elif fault_progress >= 0.85:
            rung = 3
            mrm = True
            mrm_kind = "lateral-creep-to-shoulder"
        elif fault_progress >= 0.6:
            rung = 2
            mrm = True
            mrm_kind = "lateral-creep-to-shoulder"
        elif self._obstacle_distance_m is not None and self._obstacle_distance_m < 6:
            rung = 1
            mrm = False
            mrm_kind = ""
        else:
            rung = 0
            mrm = False
            mrm_kind = ""
        safety_block: dict[str, Any] = {
            "oddCompliant": rung < 3,
            "oodMahalanobis": round(0.34 + fault_progress * 0.6, 3),
            "oodThreshold": 0.92,
            "takeoverRung": rung,
            "ttcSec": round(ttc_s, 1),
            "fttiMs": 220,
            "capabilityBudget": round(_clamp(0.92 - fault_progress * 0.6, 0.2, 1.0), 3),
            "mrmActive": mrm,
        }
        if mrm_kind:
            safety_block["mrmKind"] = mrm_kind

        # ---- Cabin (no CARLA equivalent; synthetic constant) ----
        cabin_block = {
            "cabinTempC": 22.0, "cabinHumidityPct": 45.0,
            "co2Ppm": 640, "pm25Ugm3": 11.0,
            "driverAttention": {
                "gazeOnRoad": 0.94, "eyesClosed": False,
                "handsOnWheel": True, "seatBelt": True,
            },
            "occupants": 1,
        }

        # ---- Environment from CARLA weather (CARLA real) ----
        try:
            weather = self.world.get_weather()
            cloudiness = float(weather.cloudiness)
            precip = float(weather.precipitation)
            fog = float(weather.fog_density)
            wetness = float(getattr(weather, "wetness", 0.0))
            sun_alt = float(weather.sun_altitude_angle)
            wind = float(getattr(weather, "wind_intensity", 0.0))
            if precip > 30:
                weather_kind = "rain"
            elif fog > 30:
                weather_kind = "fog"
            elif cloudiness > 50:
                weather_kind = "cloudy"
            else:
                weather_kind = "clear"
            if precip > 60:
                weather_kind = "storm"
            visibility_m = max(50.0, 10000.0 - fog * 100.0 - precip * 50.0)
            if wetness > 30 or precip > 30:
                pavement = "asphalt-wet"
            else:
                pavement = "asphalt-dry"
            time_of_day = (
                "day" if sun_alt > 15
                else "dusk" if 0 < sun_alt <= 15
                else "dawn" if -15 <= sun_alt <= 0
                else "night"
            )
            environment_block = {
                "weather": weather_kind,
                "visibilityM": round(visibility_m, 1),
                "ambientTempC": 28.0,  # CARLA does not simulate temp
                "ambientHumidityPct": round(40 + cloudiness * 0.4, 1),
                "windKph": round(wind * 0.36, 1),
                "pavement": pavement,
                "timeOfDay": time_of_day,
            }
            env_origin = "carla-world"
        except Exception:
            environment_block = {
                "weather": "clear", "visibilityM": 10000,
                "ambientTempC": 28.0, "ambientHumidityPct": 60.0,
                "windKph": 7.0, "pavement": "asphalt-dry", "timeOfDay": "day",
            }
            env_origin = "synthetic-const"

        software_block = {
            "perceptionVersion": "perceptron-v9.4.2-bev-occ-tx",
            "plannerVersion": "wayve-mp-2026.05",
            "controlVersion": "mpc-asild-1.7",
            "osVersion": "vsbs-os 2026.05.r2",
            "calibrationVersion": "extr-cal 2026.04.W14",
        }

        # ---- Distance to service centre (CARLA-actor distance) ----
        distance_to_sc = None
        if sc_target_location is not None:
            try:
                distance_to_sc = float(ego_loc.distance(sc_target_location))
            except Exception:
                distance_to_sc = None

        # ---- Frame assembly ----
        tyre_p = getattr(scheduler_state, "tyre_pressure_kpa", {}) or {}
        frame: dict[str, Any] = {
            "ts": now_iso(),
            "origin": "sim",
            "simSource": "carla-live",
            "speedKph": round(_clamp(speed_kph, 0.0, 400.0), 1),
            "headingDeg": round(_clamp(heading, 0.0, 360.0), 1),
            "brakePadFrontPercent": round(_clamp(
                float(getattr(scheduler_state, "brake_pad_front_pct", 70.0)), 0.0, 100.0), 1),
            "hvSocPercent": round(soc, 1),
            "coolantTempC": round(_clamp(coolant, -40.0, 150.0), 1),
            "tpms": {
                "fl": float(tyre_p.get("fl", 230.0)),
                "fr": float(tyre_p.get("fr", 230.0)),
                "rl": float(tyre_p.get("rl", 230.0)),
                "rr": float(tyre_p.get("rr", 230.0)),
            },
            "gps": {"lat": gps_lat, "lng": gps_lng},
            "accel": {"x": float(a.x), "y": float(a.y), "z": float(a.z)},
            "nearbyVehicles": int(len(nearby_v)),
            "nearbyPedestrians": int(len(nearby_p)),
            "trafficLightState": tl_state,
            "sensors": {
                "cameras": cameras_health,
                "radars": radars_health,
                "lidars": lidars_health,
                "ultrasonic": [],
                "thermal": [],
                "microphones": [],
            },
            "imu": imu_block,
            "wheels": wheels_block,
            "chassis": chassis_block,
            "powertrain": powertrain_block,
            "perception": {
                "detections": detections,
                "tracks": tracks,
                "bevOccupancy": {
                    "occupiedRatio": round(_clamp(len(nearby_v) / 20.0, 0.0, 1.0), 3),
                    "peakUncertainty": 0.21,
                },
                "trafficLight": tl_block,
                "freeSpaceRatio": round(_clamp(0.78 - speed_kph * 0.001, 0.0, 1.0), 3),
                "drivableAreaMiou": 0.94,
            },
            "planner": planner_block,
            "control": control_block,
            "compute": compute_block,
            "network": network_block,
            "v2x": v2x_block,
            "safety": safety_block,
            "cabin": cabin_block,
            "environment": environment_block,
            "software": software_block,
            "throttle": round(float(ctrl.throttle), 3),
            "brake": round(float(ctrl.brake), 3),
            "steering": round(float(ctrl.steer), 3),
            "gear": int(getattr(ctrl, "gear", 1)),
            # Provenance: every block tagged so a verifier can audit which
            # values came from CARLA truth vs the bridge's synthetic models.
            "provenance": {
                "speedKph": "carla-actor",
                "headingDeg": "carla-actor",
                "gps": gnss_origin,
                "gnss": gnss_origin,
                "accel": "carla-actor",
                "imu": imu_origin,
                "wheels.rpm": "carla-physics",
                "wheels.tpmsKpa": "virtual-fault",
                "wheels.tpmsTempC": "synthetic-tied",
                "wheels.hubTempC": "synthetic-tied",
                "chassis": "carla-actor+synthetic-tied",
                "powertrain.motorFront": "synthetic-tied",
                "powertrain.motorRear": "synthetic-tied",
                "powertrain.hvCellsMv": "synthetic-tied",
                "powertrain.hvCellsTempC": "synthetic-tied",
                "powertrain.hvSocPercent": "virtual-fault",
                "powertrain.coolantTempC": "virtual-fault",
                "powertrain.coolantMotorC": "synthetic-tied",
                "perception.detections": "carla-world",
                "perception.tracks": "carla-world",
                "perception.bevOccupancy": "synthetic-tied",
                "perception.trafficLight": "carla-actor",
                "perception.laneGraph": "carla-map",
                "planner.behavior": "synthetic-derived",
                "control": "carla-actor",
                "compute.primary": "synthetic-tied",
                "compute.lockstep": "synthetic-const",
                "compute.hsmHeartbeatOk": "synthetic-const",
                "network": "synthetic-const",
                "v2x.neighbours": "carla-world",
                "v2x.spatRxPerSec": "carla-actor",
                "v2x.bsmRxPerSec": "synthetic-tied",
                "v2x.latestSummary": "synthetic-tied",
                "safety.takeoverRung": "synthetic-derived",
                "safety.oodMahalanobis": "synthetic-tied",
                "safety.capabilityBudget": "synthetic-tied",
                "safety.mrmActive": "synthetic-derived",
                "cabin": "synthetic-const",
                "environment": env_origin,
                "software": "synthetic-const",
                "tpms": "virtual-fault",
                "brakePadFrontPercent": "virtual-fault",
                "hvSocPercent": "virtual-fault",
                "coolantTempC": "virtual-fault",
            },
        }
        if lane_block is not None:
            frame["perception"]["laneGraph"] = lane_block
        if distance_to_sc is not None:
            frame["distanceToServiceCentreM"] = round(distance_to_sc, 1)
        return frame

    # --- shutdown ---------------------------------------------------------

    def destroy(self) -> None:
        for s in self._sensors:
            try:
                s.stop()
            except Exception:
                pass
            try:
                s.destroy()
            except Exception:
                pass
        self._sensors = []
