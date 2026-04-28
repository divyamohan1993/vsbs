# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Sensor bridge: assemble VSBS-shaped SensorSamplePayload batches and POST.

For every tick we build samples for the channels VSBS knows about:
    speed_kph -> wheel-speed
    accel/gyro -> imu
    gnss -> gps
    brake-pressure / brake-pad pct -> brake-pressure (with virtual channel
    overlaid on .value)
    coolant temp + oil age -> obd-pid
    tpms / tyres -> tpms
    HV battery cell-delta + SoC -> bms

Every sample is stamped origin="sim", simSource="carla" or "replay" so the
fusion layer's origin summary surfaces the bridge's contribution. Real
samples never appear here.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Iterable, Optional

from .api import IngestResult, VsbsApi
from .faults import VirtualState
from .replay import TraceFrame
from .schemas import SensorSamplePayload, now_iso

LOG = logging.getLogger("vsbs_carla.sensors")


def build_samples(
    vehicle_id: str,
    state: VirtualState,
    frame: TraceFrame,
    *,
    sim_source: str,
) -> list[SensorSamplePayload]:
    """Return one full per-channel batch for the current tick."""

    ts = now_iso()
    common = {
        "origin": "sim",
        "vehicleId": vehicle_id,
        "timestamp": ts,
        "simSource": sim_source,
    }
    samples: list[SensorSamplePayload] = []

    samples.append(SensorSamplePayload(
        channel="wheel-speed",
        value={"speed_kph": frame.speed_kph},
        **common,
    ))

    samples.append(SensorSamplePayload(
        channel="imu",
        value={
            "accel_x": frame.accel_x,
            "accel_y": frame.accel_y,
            "yaw_rate": frame.yaw_rate,
            "heading_deg": frame.heading_deg,
        },
        **common,
    ))

    samples.append(SensorSamplePayload(
        channel="gps",
        value={"lat": frame.gnss_lat, "lng": frame.gnss_lng, "heading_deg": frame.heading_deg},
        **common,
    ))

    samples.append(SensorSamplePayload(
        channel="brake-pressure",
        value={
            "bar": 0.5,  # not under braking unless event; simulator-friendly
            "brake_pad_pct": state.brake_pad_front_pct,
        },
        **common,
    ))

    samples.append(SensorSamplePayload(
        channel="obd-pid",
        value={
            "coolant_c": state.coolant_temp_c,
            "engine_oil_age_km": state.engine_oil_age_km,
            "drive_belt_health": state.drive_belt_health,
        },
        **common,
    ))

    samples.append(SensorSamplePayload(
        channel="bms",
        value={
            "soc_pct": state.hv_battery_soc_pct,
            "cell_delta_mv": state.hv_battery_cell_delta_mv,
        },
        **common,
    ))

    for corner, status in state.tpms_status.items():
        samples.append(SensorSamplePayload(
            channel="tpms",
            value={
                "corner": corner,
                "status": status,
                "pressure_kpa": state.tyre_pressure_kpa.get(corner),
            },
            **common,
        ))

    return samples


class CarlaSensorBridge:
    """Owns the batch-flush queue and pushes samples to VSBS."""

    def __init__(
        self,
        api: VsbsApi,
        *,
        vehicle_id: str,
        sim_source: str = "carla",
        flush_every_ms: int = 100,
    ) -> None:
        self._api = api
        self._vehicle_id = vehicle_id
        self._sim_source = sim_source
        self._flush_interval = max(0.05, flush_every_ms / 1000.0)
        self._queue: list[SensorSamplePayload] = []
        self._flush_lock = asyncio.Lock()
        self._last_flush_ts = 0.0

    @property
    def queue_depth(self) -> int:
        return len(self._queue)

    @property
    def sim_source(self) -> str:
        return self._sim_source

    def drop_queue(self) -> int:
        n = len(self._queue)
        self._queue = []
        return n

    def emit(self, samples: Iterable[SensorSamplePayload]) -> None:
        for sample in samples:
            sample_dict = sample.model_dump(by_alias=True, exclude_none=True)
            sample_dict["simSource"] = self._sim_source
            self._queue.append(SensorSamplePayload.model_validate(sample_dict))

    async def maybe_flush(self, now_s: float) -> Optional[IngestResult]:
        if not self._queue:
            return None
        if now_s - self._last_flush_ts < self._flush_interval:
            return None
        return await self.flush()

    async def flush(self) -> IngestResult:
        async with self._flush_lock:
            if not self._queue:
                return IngestResult(
                    accepted=0,
                    real=0,
                    sim=0,
                    sim_sources={},
                    observation_id="",
                )
            # Cap each batch at 200 samples — the server enforces 500 and a
            # 1 MiB body cap, and our per-sample payload comfortably fits.
            batch = self._queue[:200]
            self._queue = self._queue[200:]
            try:
                result = await self._api.ingest_samples(self._vehicle_id, batch)
                self._last_flush_ts = (
                    asyncio.get_event_loop().time() if asyncio.get_event_loop().is_running() else 0.0
                )
                return result
            except Exception:
                # Drop the failed batch so we don't accumulate an unbounded
                # backlog; the orchestrator's state machine tolerates lost
                # ingest frames (the next tick re-emits the latest state).
                raise
