# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Generate a deterministic JSONL trace of the demo loop.

Runs the deterministic ego model and the fault scheduler for ~4 minutes
(2400 ticks at 10 Hz). The output is the file the replayer iterates.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from ..faults import FaultScheduler, build_fault
from ..replay import DeterministicEgo, TraceFrame, write_trace


def generate(
    out: Path,
    *,
    fault_name: str,
    duration_s: float = 240.0,
    tick_hz: float = 10.0,
    fault_after_s: float = 30.0,
) -> int:
    dt = 1.0 / tick_hz
    ticks = int(duration_s * tick_hz)
    ego = DeterministicEgo()
    scheduler = FaultScheduler()
    scheduler.schedule(build_fault(fault_name), after_s=fault_after_s)

    frames: list[TraceFrame] = []
    last_speed = ego.speed_kph
    for i in range(ticks):
        t = i * dt
        ego.step(dt)
        scheduler.tick(t)
        speed_kph = ego.speed_kph + (ego.rng.uniform(-0.3, 0.3) if i > 0 else 0.0)
        accel_x = (speed_kph - last_speed) / 3.6 / dt
        last_speed = speed_kph
        rad = math.radians(ego.heading_deg)
        gnss = ego.gnss()
        frame = TraceFrame(
            t=round(t, 4),
            x=round(ego.x, 4),
            y=round(ego.y, 4),
            heading_deg=round(ego.heading_deg, 4),
            speed_kph=round(speed_kph, 4),
            accel_x=round(accel_x, 4),
            accel_y=round(0.0, 4),
            yaw_rate=round(math.radians(5.0), 6),
            gnss_lat=round(gnss[0], 6),
            gnss_lng=round(gnss[1], 6),
            brake_pad_pct=round(scheduler.state.brake_pad_front_pct, 3),
            coolant_temp_c=round(scheduler.state.coolant_temp_c, 3),
            hv_battery_soc_pct=round(scheduler.state.hv_battery_soc_pct, 3),
            hv_battery_cell_delta_mv=round(scheduler.state.hv_battery_cell_delta_mv, 3),
            tpms=dict(scheduler.state.tpms_status),
            tyre_pressure_kpa={k: round(v, 2) for k, v in scheduler.state.tyre_pressure_kpa.items()},
            engine_oil_age_km=round(scheduler.state.engine_oil_age_km, 3),
            drive_belt_health=round(scheduler.state.drive_belt_health, 4),
        )
        # Suppress unused-locals lint noise.
        _ = rad
        frames.append(frame)

    write_trace(out, frames)
    return len(frames)


def main() -> int:
    parser = argparse.ArgumentParser(description="Record a deterministic VSBS-CARLA trace.")
    parser.add_argument("--fault", default="brake-pad-wear")
    parser.add_argument("--duration", type=float, default=240.0)
    parser.add_argument("--tick-hz", type=float, default=10.0)
    parser.add_argument("--out", default="tools/carla/replay/town10hd-brake-failure.jsonl")
    args = parser.parse_args()

    out = Path(args.out)
    n = generate(out, fault_name=args.fault, duration_s=args.duration, tick_hz=args.tick_hz)
    print(f"wrote {n} frames to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
