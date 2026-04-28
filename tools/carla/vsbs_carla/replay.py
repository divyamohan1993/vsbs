# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Trace recorder + replayer.

Recording: for every tick, write a JSON line capturing the ego pose,
velocity, and the virtual-channel state. Determinism is achieved by
seeding the synthetic physics path with a fixed PRNG seed and disabling
real-time sleeps when running headless.

Replaying: iterate the recorded JSONL and surface the same per-tick
view back through the SensorBridge pipeline. This is what makes the demo
runnable in CI on machines that cannot host the 30 GB CARLA binary.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterator, Optional


@dataclass
class TraceFrame:
    t: float
    x: float
    y: float
    heading_deg: float
    speed_kph: float
    accel_x: float
    accel_y: float
    yaw_rate: float
    gnss_lat: float
    gnss_lng: float
    brake_pad_pct: float
    coolant_temp_c: float
    hv_battery_soc_pct: float
    hv_battery_cell_delta_mv: float
    tpms: dict[str, str]
    tyre_pressure_kpa: dict[str, float]
    engine_oil_age_km: float
    drive_belt_health: float

    def to_json_line(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @classmethod
    def from_json_line(cls, line: str) -> "TraceFrame":
        data = json.loads(line)
        return cls(**data)


@dataclass
class DeterministicEgo:
    """A CARLA-free physics model used for trace recording.

    Constant 30 km/h on a synthetic loop with a 5 deg heading drift; the
    GNSS coordinates are projected from a fixed home (28.6139, 77.2090).
    The model is fully deterministic given its seed.
    """

    seed: int = 7
    speed_kph: float = 30.0
    heading_deg: float = 0.0
    x: float = 0.0
    y: float = 0.0
    home_lat: float = 28.6139
    home_lng: float = 77.2090
    rng: random.Random = field(default_factory=lambda: random.Random(7))

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)

    def step(self, dt_s: float) -> None:
        speed_ms = (self.speed_kph + self.rng.uniform(-0.3, 0.3)) / 3.6
        self.heading_deg = (self.heading_deg + 5.0 * dt_s) % 360.0
        rad = math.radians(self.heading_deg)
        self.x += math.cos(rad) * speed_ms * dt_s
        self.y += math.sin(rad) * speed_ms * dt_s

    def gnss(self) -> tuple[float, float]:
        # Approximate small-displacement projection (Earth radius 6378137 m).
        d_lat = (self.y / 6378137.0) * (180.0 / math.pi)
        d_lng = (self.x / 6378137.0) * (180.0 / math.pi) / max(
            1e-6, math.cos(math.radians(self.home_lat)),
        )
        return (self.home_lat + d_lat, self.home_lng + d_lng)


def write_trace(
    out_path: Path,
    frames: list[TraceFrame],
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        for frame in frames:
            fh.write(frame.to_json_line())
            fh.write("\n")


class TraceReplayer:
    """Yield recorded frames at their natural cadence."""

    def __init__(self, path: Path) -> None:
        self._path = path
        if not path.exists():
            raise FileNotFoundError(f"trace not found: {path}")

    def frames(self) -> Iterator[TraceFrame]:
        with self._path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                yield TraceFrame.from_json_line(line)

    def __len__(self) -> int:
        return sum(1 for _ in self.frames())


def first_frame(path: Path) -> Optional[TraceFrame]:
    replayer = TraceReplayer(path)
    for frame in replayer.frames():
        return frame
    return None
