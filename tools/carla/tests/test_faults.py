# SPDX-License-Identifier: Apache-2.0
"""Verify FaultScheduler ramp math and critical detection."""

from __future__ import annotations

import pytest

from vsbs_carla.faults import (
    BeltAgeFault,
    BrakePadWearFault,
    CoolantOverheatFault,
    FaultScheduler,
    HvBatteryImbalanceFault,
    OilLowFault,
    TpmsDropoutFault,
    VirtualState,
    build_fault,
)


def test_brake_pad_ramp_reaches_end_value_at_duration():
    fault = BrakePadWearFault(start_pct=70.0, end_pct=12.0, duration_s=90.0)
    state = VirtualState()
    fault.update(state, now_s=90.0)
    assert state.brake_pad_front_pct == pytest.approx(12.0, rel=1e-6)


def test_brake_pad_critical_below_threshold():
    fault = BrakePadWearFault()
    state = VirtualState(brake_pad_front_pct=10.0)
    assert fault.critical(state) is True


def test_coolant_ramp_monotonic_increasing():
    fault = CoolantOverheatFault()
    state = VirtualState()
    prev = state.coolant_temp_c
    for t_s in (5.0, 15.0, 30.0, 45.0, 60.0):
        fault.update(state, now_s=t_s)
        assert state.coolant_temp_c >= prev
        prev = state.coolant_temp_c


def test_hv_battery_imbalance_critical_at_threshold():
    fault = HvBatteryImbalanceFault()
    state = VirtualState()
    fault.update(state, now_s=fault.duration_s)
    assert fault.critical(state) is True


def test_tpms_dropout_marks_corner():
    fault = TpmsDropoutFault(corner="fl", dropout_at_s=15.0)
    state = VirtualState()
    fault.update(state, now_s=20.0)
    assert state.tpms_status["fl"] == "dropout"
    assert state.tpms_status["fr"] == "ok"


def test_oil_low_critical_after_threshold():
    fault = OilLowFault()
    state = VirtualState()
    fault.update(state, now_s=fault.duration_s)
    assert fault.critical(state) is True


def test_belt_age_critical_below_threshold():
    fault = BeltAgeFault()
    state = VirtualState()
    fault.update(state, now_s=fault.duration_s)
    assert fault.critical(state) is True


def test_build_fault_unknown_raises():
    with pytest.raises(ValueError):
        build_fault("not-a-fault")


def test_scheduler_chains_multiple_faults():
    scheduler = FaultScheduler()
    scheduler.schedule(BrakePadWearFault(), after_s=0.0)
    scheduler.schedule(CoolantOverheatFault(), after_s=10.0)
    scheduler.tick(60.0)
    # Both ramps should have advanced.
    assert scheduler.state.brake_pad_front_pct < 70.0
    assert scheduler.state.coolant_temp_c > 88.0


def test_scheduler_any_critical_returns_first_matching_fault():
    scheduler = FaultScheduler()
    scheduler.schedule(BrakePadWearFault(duration_s=5.0), after_s=0.0)
    scheduler.tick(5.0)
    triggered = scheduler.any_critical()
    assert triggered is not None
    assert triggered.name == "brake-pad-wear"


def test_progress_clamps_above_one():
    fault = BrakePadWearFault()
    state = VirtualState()
    fault.update(state, now_s=10_000.0)
    assert state.brake_pad_front_pct == fault.end_pct
