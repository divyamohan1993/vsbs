# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Fault scheduler — controls the virtual-channel envelope for the demo.

Each fault is a stateful object that updates the simulator's view of the
relevant virtual channel at every tick. Faults are deterministic given a
fixed `start_time_s` and `current_time_s`, so the trace recorder + replayer
produce the same signal.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


def _ramp(progress: float) -> float:
    if progress <= 0.0:
        return 0.0
    if progress >= 1.0:
        return 1.0
    return progress


class Fault(Protocol):
    name: str

    def update(self, state: "VirtualState", now_s: float) -> None: ...

    def critical(self, state: "VirtualState") -> bool: ...

    def affects_component(self) -> str: ...


@dataclass
class VirtualState:
    """Channels that are not directly read from CARLA but emitted by the
    bridge so PHM can reason about wear-out signals end-to-end."""

    brake_pad_front_pct: float = 70.0
    coolant_temp_c: float = 88.0
    hv_battery_soc_pct: float = 72.0
    hv_battery_cell_delta_mv: float = 8.0
    tpms_status: dict[str, str] = field(
        default_factory=lambda: {"fl": "ok", "fr": "ok", "rl": "ok", "rr": "ok"},
    )
    tyre_pressure_kpa: dict[str, float] = field(
        default_factory=lambda: {"fl": 230.0, "fr": 230.0, "rl": 230.0, "rr": 230.0},
    )
    engine_oil_age_km: float = 9_500.0
    drive_belt_health: float = 0.92


@dataclass
class BrakePadWearFault:
    name: str = "brake-pad-wear"
    start_pct: float = 70.0
    end_pct: float = 12.0
    duration_s: float = 90.0
    start_time_s: float = 0.0
    critical_threshold_pct: float = 18.0

    def update(self, state: VirtualState, now_s: float) -> None:
        elapsed = max(0.0, now_s - self.start_time_s)
        progress = _ramp(elapsed / self.duration_s)
        state.brake_pad_front_pct = self.start_pct + progress * (self.end_pct - self.start_pct)

    def critical(self, state: VirtualState) -> bool:
        return state.brake_pad_front_pct <= self.critical_threshold_pct

    def affects_component(self) -> str:
        return "brakes-pads-front"


@dataclass
class CoolantOverheatFault:
    name: str = "coolant-overheat"
    start_c: float = 88.0
    end_c: float = 118.0
    duration_s: float = 60.0
    start_time_s: float = 0.0
    critical_threshold_c: float = 110.0

    def update(self, state: VirtualState, now_s: float) -> None:
        elapsed = max(0.0, now_s - self.start_time_s)
        progress = _ramp(elapsed / self.duration_s)
        state.coolant_temp_c = self.start_c + progress * (self.end_c - self.start_c)

    def critical(self, state: VirtualState) -> bool:
        return state.coolant_temp_c >= self.critical_threshold_c

    def affects_component(self) -> str:
        return "cooling-system"


@dataclass
class HvBatteryImbalanceFault:
    name: str = "hv-battery-imbalance"
    start_mv_delta: float = 8.0
    end_mv_delta: float = 180.0
    duration_s: float = 120.0
    start_time_s: float = 0.0
    critical_threshold_mv: float = 130.0

    def update(self, state: VirtualState, now_s: float) -> None:
        elapsed = max(0.0, now_s - self.start_time_s)
        progress = _ramp(elapsed / self.duration_s)
        state.hv_battery_cell_delta_mv = self.start_mv_delta + progress * (
            self.end_mv_delta - self.start_mv_delta
        )

    def critical(self, state: VirtualState) -> bool:
        return state.hv_battery_cell_delta_mv >= self.critical_threshold_mv

    def affects_component(self) -> str:
        return "battery-hv"


@dataclass
class TpmsDropoutFault:
    name: str = "tpms-dropout"
    corner: str = "fl"
    dropout_at_s: float = 15.0
    start_time_s: float = 0.0
    pressure_drop_kpa: float = 50.0

    def update(self, state: VirtualState, now_s: float) -> None:
        elapsed = max(0.0, now_s - self.start_time_s)
        if elapsed < self.dropout_at_s:
            return
        state.tpms_status[self.corner] = "dropout"
        state.tyre_pressure_kpa[self.corner] = max(
            120.0,
            state.tyre_pressure_kpa[self.corner] - self.pressure_drop_kpa,
        )

    def critical(self, state: VirtualState) -> bool:
        return state.tpms_status[self.corner] == "dropout"

    def affects_component(self) -> str:
        return f"tire-{self.corner}"


@dataclass
class OilLowFault:
    name: str = "oil-low"
    start_age_km: float = 9_500.0
    end_age_km: float = 13_500.0
    duration_s: float = 90.0
    start_time_s: float = 0.0
    critical_age_km: float = 12_000.0

    def update(self, state: VirtualState, now_s: float) -> None:
        elapsed = max(0.0, now_s - self.start_time_s)
        progress = _ramp(elapsed / self.duration_s)
        state.engine_oil_age_km = self.start_age_km + progress * (
            self.end_age_km - self.start_age_km
        )

    def critical(self, state: VirtualState) -> bool:
        return state.engine_oil_age_km >= self.critical_age_km

    def affects_component(self) -> str:
        return "engine-oil-system"


@dataclass
class BeltAgeFault:
    name: str = "drive-belt-age"
    start_health: float = 0.92
    end_health: float = 0.40
    duration_s: float = 90.0
    start_time_s: float = 0.0
    critical_threshold: float = 0.55

    def update(self, state: VirtualState, now_s: float) -> None:
        elapsed = max(0.0, now_s - self.start_time_s)
        progress = _ramp(elapsed / self.duration_s)
        state.drive_belt_health = self.start_health + progress * (
            self.end_health - self.start_health
        )

    def critical(self, state: VirtualState) -> bool:
        return state.drive_belt_health <= self.critical_threshold

    def affects_component(self) -> str:
        return "drive-belt"


_FAULT_CONSTRUCTORS = {
    "brake-pad-wear": BrakePadWearFault,
    "coolant-overheat": CoolantOverheatFault,
    "hv-battery-imbalance": HvBatteryImbalanceFault,
    "tpms-dropout": TpmsDropoutFault,
    "oil-low": OilLowFault,
    "drive-belt-age": BeltAgeFault,
}


def build_fault(name: str, start_time_s: float = 0.0) -> Fault:
    ctor = _FAULT_CONSTRUCTORS.get(name)
    if ctor is None:
        raise ValueError(f"unknown fault {name}")
    fault = ctor()
    fault.start_time_s = start_time_s
    return fault


@dataclass
class FaultScheduler:
    """Compose one or more faults into a single update step."""

    faults: list[Fault] = field(default_factory=list)
    state: VirtualState = field(default_factory=VirtualState)

    def schedule(self, fault: Fault, after_s: float) -> None:
        fault.start_time_s = after_s
        self.faults.append(fault)

    def tick(self, now_s: float) -> None:
        for fault in self.faults:
            fault.update(self.state, now_s)

    def any_critical(self) -> Fault | None:
        for fault in self.faults:
            if fault.critical(self.state):
                return fault
        return None
