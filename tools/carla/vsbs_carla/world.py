# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Optional CARLA wrapper.

If `carla` is not importable on this machine, every method here raises
`CarlaUnavailableError`. The bridge falls back to TraceReplayer and never
calls into this module.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

LOG = logging.getLogger("vsbs_carla.world")


class CarlaUnavailableError(RuntimeError):
    """Raised when the carla Python module isn't installed."""


def _import_carla() -> Any:
    try:
        import carla  # type: ignore[import-not-found]
        return carla
    except Exception as err:
        raise CarlaUnavailableError(
            "carla module is not installed on this machine. "
            "Install carla==0.10.0 from the CARLA release tarball."
        ) from err


class CarlaWorld:
    """Idiomatic CARLA 0.10.0 world wrapper.

    The class is intentionally minimal — every method maps 1:1 to a CARLA
    API call so the surface stays auditable. The CarlaWorld is only
    instantiated when the demo runs in live CARLA mode.
    """

    def __init__(self, host: str, port: int, town: str, *, timeout_s: float = 10.0) -> None:
        self._carla = _import_carla()
        self._client = self._carla.Client(host, port)
        self._client.set_timeout(timeout_s)
        self._world = self._client.load_world(town)
        self._town = town
        settings = self._world.get_settings()
        settings.synchronous_mode = True
        settings.fixed_delta_seconds = 0.05
        self._world.apply_settings(settings)
        self._actors: list[Any] = []
        LOG.info("CARLA world loaded town=%s host=%s:%d", town, host, port)

    @property
    def world(self) -> Any:
        return self._world

    def spawn_ego(self, blueprint: str, spawn_index: int) -> Any:
        bp_lib = self._world.get_blueprint_library()
        candidates = bp_lib.filter(blueprint)
        if not candidates:
            raise RuntimeError(f"no blueprint matching {blueprint}")
        ego_bp = candidates[0]
        spawn_points = self._world.get_map().get_spawn_points()
        if spawn_index >= len(spawn_points):
            raise RuntimeError(f"spawn index {spawn_index} out of range")
        ego = self._world.spawn_actor(ego_bp, spawn_points[spawn_index])
        self._actors.append(ego)
        return ego

    def attach_sensors(self, ego: Any) -> dict[str, Any]:
        bp_lib = self._world.get_blueprint_library()
        sensors: dict[str, Any] = {}
        for kind in ("sensor.other.gnss", "sensor.other.imu"):
            blueprints = bp_lib.filter(kind)
            if not blueprints:
                continue
            bp = blueprints[0]
            sensor = self._world.spawn_actor(bp, self._carla.Transform(), attach_to=ego)
            sensors[kind] = sensor
            self._actors.append(sensor)
        return sensors

    def tick(self) -> None:
        self._world.tick()

    def cleanup(self) -> None:
        for actor in self._actors:
            try:
                actor.destroy()
            except Exception:
                pass
        self._actors.clear()
        try:
            settings = self._world.get_settings()
            settings.synchronous_mode = False
            self._world.apply_settings(settings)
        except Exception:
            pass


@contextmanager
def maybe_world(
    host: str,
    port: int,
    town: str,
) -> Iterator[CarlaWorld | None]:
    """Yield a CarlaWorld if carla is available; otherwise yield None.

    Used by the demo runner so the same control-flow path works on both
    machines that have CARLA installed and machines that don't.
    """

    try:
        world = CarlaWorld(host, port, town)
    except CarlaUnavailableError:
        LOG.info("carla unavailable; running in replay-only mode")
        yield None
        return
    except Exception as err:
        LOG.warning("carla connect failed (%s); falling back to replay", err)
        yield None
        return
    try:
        yield world
    finally:
        world.cleanup()
