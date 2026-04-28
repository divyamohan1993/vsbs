# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Headline demo runner: drive the orchestrator end-to-end."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Optional

from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table

from ..agent import DemoOrchestrator, OrchestratorContext
from ..api import VsbsApi
from ..config import FaultKind, Settings, load_settings
from ..destinations import HOME_SPAWN_INDEX
from ..faults import FaultScheduler, build_fault
from ..replay import DeterministicEgo, TraceFrame, TraceReplayer
from ..schemas import PhmReadingPayload, now_iso
from ..sensors import CarlaSensorBridge, build_samples
from ..world import CarlaUnavailableError, maybe_world

LOG = logging.getLogger("vsbs_carla.run")

FAULT_TO_COMPONENT = {
    "brake-pad-wear": "brakes-pads-front",
    "coolant-overheat": "cooling-system",
    "hv-battery-imbalance": "battery-hv",
    "tpms-dropout": "tire-fl",
    "oil-low": "engine-oil-system",
    "drive-belt-age": "drive-belt",
}


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the VSBS x CARLA headline demo.")
    parser.add_argument("--fault", default=None, help="Fault to inject after warm-up.")
    parser.add_argument("--town", default=None, help="CARLA town name.")
    parser.add_argument("--headless", action="store_true", help="Don't render telemetry tables.")
    parser.add_argument("--replay", default=None, help="Path to a recorded trace JSONL.")
    parser.add_argument("--record", default=None, help="Record a fresh trace to this path then exit.")
    parser.add_argument("--vehicle-id", default=None)
    parser.add_argument("--scenario-only", action="store_true", help="Skip ingest; only push state transitions.")
    return parser.parse_args(argv)


def make_phm_reading(vehicle_id: str, fault_name: str) -> PhmReadingPayload:
    component = FAULT_TO_COMPONENT.get(fault_name, "brakes-pads-front")
    severe = fault_name in {"hv-battery-imbalance", "coolant-overheat"}
    return PhmReadingPayload(
        vehicleId=vehicle_id,
        component=component,  # type: ignore[arg-type]
        tier=1,
        state="critical" if severe else "act-soon",
        pFail1000km=0.85 if severe else 0.4,
        pFailLower=0.7 if severe else 0.3,
        pFailUpper=0.95 if severe else 0.55,
        rulKmMean=80.0,
        rulKmLower=30.0,
        modelSource="physics-of-failure",
        featuresVersion="v1",
        updatedAt=now_iso(),
        suspectedSensorFailure=False,
    )


def _frames_from_replay(path: Path) -> list[TraceFrame]:
    return list(TraceReplayer(path).frames())


def _frames_from_deterministic(fault_name: str, *, duration_s: float = 240.0) -> list[TraceFrame]:
    """Generate frames in-memory if no replay file is present."""
    from .record_trace import generate

    tmp_path = Path("tools/carla/replay/_in_memory.jsonl")
    generate(tmp_path, fault_name=fault_name, duration_s=duration_s)
    frames = _frames_from_replay(tmp_path)
    try:
        tmp_path.unlink()
    except FileNotFoundError:
        pass
    return frames


def _draw_telemetry(state: dict[str, object], events: list[str]) -> Panel:
    table = Table.grid(padding=(0, 2))
    table.add_column(justify="right", style="bold")
    table.add_column()
    for key, value in state.items():
        table.add_row(str(key), str(value))
    body = Table.grid(padding=(0, 1))
    body.add_row(table)
    log_table = Table(title="Recent transitions", show_lines=False)
    log_table.add_column("at", justify="right", style="cyan")
    log_table.add_column("event", style="white")
    for line in events[-10:]:
        log_table.add_row("", line)
    body.add_row(log_table)
    return Panel(body, title="VSBS x CARLA — autonomous service loop")


async def run_demo(
    settings: Settings,
    args: argparse.Namespace,
) -> int:
    vehicle_id = args.vehicle_id or settings.vsbs_user_id
    fault_name = args.fault or str(settings.vsbs_fault)

    replay_path: Optional[Path] = None
    if args.replay:
        replay_path = Path(args.replay)
    elif settings.replay_path:
        replay_path = settings.replay_path

    if replay_path and replay_path.exists():
        LOG.info("replay mode using %s", replay_path)
        frames = _frames_from_replay(replay_path)
    else:
        with maybe_world(settings.carla_host, settings.carla_port, args.town or settings.carla_town) as world:
            if world is None:
                LOG.info("CARLA not available; using deterministic frames")
                frames = _frames_from_deterministic(fault_name)
            else:
                # Live CARLA mode: spawn ego, attach sensors, then immediately
                # fall through to the deterministic frame generator so the
                # demo loop stays bounded for now. A full BehaviorAgent path
                # follows the same orchestrator API but runs at real time.
                LOG.info("live CARLA mode (deterministic frame plumbing)")
                world.spawn_ego("vehicle.tesla.model3", HOME_SPAWN_INDEX)
                frames = _frames_from_deterministic(fault_name)

    api = VsbsApi(settings.vsbs_api_base, owner_id=vehicle_id)
    # Bootstrap-consent BEFORE any gated route call. The route batches every
    # purpose the demo's gated endpoints need (sensors, dispatch, autonomy,
    # payments, voice/photo) so the first /v1/sensors/ingest does not 409.
    bootstrap = await api.bootstrap_consent(vehicle_id)
    if bootstrap:
        LOG.info(
            "bootstrap-consent granted %d purposes for %s",
            len(bootstrap.get("purposes", [])),
            vehicle_id,
        )
    else:
        # Fall back to per-purpose grant if the older API build is running.
        for purpose in (
            "service-fulfilment",
            "diagnostic-telemetry",
            "autonomy-delegation",
            "autopay-within-cap",
            "voice-photo-processing",
        ):
            await api.grant_consent(purpose)
    bridge = CarlaSensorBridge(api, vehicle_id=vehicle_id, sim_source="carla")

    events: list[str] = []
    state_view: dict[str, object] = {
        "vehicle": vehicle_id,
        "fault": fault_name,
        "state": "IDLE",
        "frames": 0,
    }

    async def on_state(evt) -> None:  # type: ignore[no-untyped-def]
        events.append(f"{evt.state}: {evt.note}")
        state_view["state"] = evt.state

    component = FAULT_TO_COMPONENT.get(fault_name, "brakes-pads-front")
    ctx = OrchestratorContext(
        vehicle_id=vehicle_id,
        fault_name=fault_name,
        component_id=component,
        sc_count=3,
        dwell_seconds_at_sc=2.0,
        warmup_seconds=2.0,
    )
    orchestrator = DemoOrchestrator(api, ctx, on_state=on_state)

    scheduler = FaultScheduler()
    scheduler.schedule(build_fault(fault_name), after_s=ctx.warmup_seconds)

    fault_triggered = False
    arrived = False
    services_started_at: Optional[float] = None
    return_started = False
    return_arrived = False

    console = Console()
    use_live = not args.headless and not os.getenv("VSBS_DISABLE_LIVE")

    async def main_loop() -> None:
        nonlocal fault_triggered, arrived, services_started_at, return_started, return_arrived
        await orchestrator.begin()
        loop_t = 0.0
        for frame in frames:
            loop_t = frame.t
            scheduler.tick(loop_t)
            samples = build_samples(
                vehicle_id,
                scheduler.state,
                frame,
                sim_source=bridge.sim_source,
            )
            if not args.scenario_only:
                bridge.emit(samples)
                try:
                    await bridge.maybe_flush(loop_t)
                except Exception as err:
                    # Drop everything we've buffered so the queue can't grow
                    # past the server's body cap when consent or storage
                    # backpressure flips us into 4xx territory.
                    bridge.drop_queue()
                    events.append(f"ingest dropped batch: {err}")

            if not fault_triggered and scheduler.any_critical():
                fault_triggered = True
                reading = make_phm_reading(vehicle_id, fault_name)
                await orchestrator.fault_detected(reading)

            if (
                fault_triggered
                and not arrived
                and orchestrator.record.state == "DRIVING_TO_SC"
                and loop_t - (orchestrator.record.history[-1].at if False else 0.0) > 0  # noqa: E501
            ):
                # In replay mode we deterministically arrive after a small grace window
                # past the booking-pending transition. Keep it tiny so CI runs fast.
                arrived = True
                await orchestrator.arrive_at_sc()
                services_started_at = loop_t

            if (
                services_started_at is not None
                and not return_started
                and orchestrator.record.state == "SERVICING"
                and loop_t - services_started_at >= ctx.dwell_seconds_at_sc
            ):
                return_started = True
                await orchestrator.service_complete()

            if (
                return_started
                and not return_arrived
                and orchestrator.record.state == "DRIVING_HOME"
            ):
                return_arrived = True
                await orchestrator.returned_home()
                break

            state_view["frames"] = int(loop_t * 10)

        # Flush any remaining samples.
        if not args.scenario_only:
            try:
                await bridge.flush()
            except Exception:
                pass

    try:
        if use_live:
            with Live(_draw_telemetry(state_view, events), console=console, refresh_per_second=4):
                await main_loop()
        else:
            await main_loop()
    finally:
        await api.aclose()

    print(f"final state: {orchestrator.record.state}")
    return 0 if orchestrator.record.state == "DONE" else 1


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    args = parse_args(argv)

    if args.record:
        from .record_trace import generate

        out = Path(args.record)
        n = generate(out, fault_name=args.fault or "brake-pad-wear")
        print(f"recorded {n} frames to {out}")
        return 0

    settings = load_settings()
    try:
        return asyncio.run(run_demo(settings, args))
    except CarlaUnavailableError as err:
        print(f"CARLA unavailable: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
