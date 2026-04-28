# SPDX-License-Identifier: Apache-2.0
"""DemoOrchestrator state-machine tests with a mocked VsbsApi."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from vsbs_carla.agent import DemoOrchestrator, OrchestratorContext, VALID_STATES
from vsbs_carla.schemas import PhmReadingPayload, now_iso


class FakeVsbsApi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def scenario_start(self, vehicle_id, fault, sc_count=3):
        self.calls.append(("scenario_start", {"vehicleId": vehicle_id, "fault": fault}))
        return {"scenarioId": "11111111-1111-4111-8111-111111111111", "state": "IDLE"}

    async def scenario_transition(self, scenario_id, state, **kwargs):
        self.calls.append(("scenario_transition", {"scenario_id": scenario_id, "state": state, **kwargs}))
        return {"scenarioId": scenario_id, "state": state}

    async def phm_trigger_booking(self, reading, in_motion=True):
        self.calls.append(("phm_trigger_booking", {"reading": reading.to_wire()}))
        return {
            "draft": {
                "vehicleId": reading.vehicle_id,
                "issue": {
                    "symptoms": "front brake pads worn",
                    "canDriveSafely": "yes-cautiously",
                    "redFlags": ["brake-failure"],
                },
                "safety": {
                    "severity": "amber",
                    "rationale": "PHM act-soon",
                    "triggered": ["brake-failure"],
                },
                "requiredParts": ["BOSCH-BP1234"],
                "serviceSkill": "brakes",
            },
        }

    async def dispatch_shortlist(self, vehicle_id, candidates, *, required_parts=None, mode="drive-in"):
        self.calls.append(("dispatch_shortlist", {"vehicleId": vehicle_id, "requiredParts": required_parts}))
        return {
            "recommendation": {"scId": "SC-IN-DEL-01", "wellbeing": 0.84, "driveEtaMinutes": 12, "composite": 0.8},
            "partsRationale": {"chosen": "SC-IN-DEL-01", "rationale": []},
        }

    async def booking_create(self, *, phone, vehicle, issue, safety):
        self.calls.append(("booking_create", {"phone": phone}))
        return {"id": "22222222-2222-4222-8222-222222222222", "status": "accepted"}

    async def dispatch_start(self, booking_id, sc_id):
        self.calls.append(("dispatch_start", {"bookingId": booking_id, "scId": sc_id}))
        return {"bookingId": booking_id, "leg": "en-route"}

    async def dispatch_arrive(self, booking_id):
        self.calls.append(("dispatch_arrive", {"bookingId": booking_id}))
        return {"bookingId": booking_id, "leg": "at-sc"}

    async def dispatch_begin_service(self, booking_id):
        self.calls.append(("dispatch_begin_service", {"bookingId": booking_id}))
        return {"bookingId": booking_id, "leg": "servicing"}

    async def dispatch_complete(self, booking_id):
        self.calls.append(("dispatch_complete", {"bookingId": booking_id}))
        return {"bookingId": booking_id, "leg": "serviced"}

    async def dispatch_return_leg(self, booking_id):
        self.calls.append(("dispatch_return_leg", {"bookingId": booking_id}))
        return {"bookingId": booking_id, "leg": "returning"}

    async def dispatch_returned(self, booking_id):
        self.calls.append(("dispatch_returned", {"bookingId": booking_id}))
        return {"bookingId": booking_id, "leg": "closed"}


def _phm_reading() -> PhmReadingPayload:
    return PhmReadingPayload(
        vehicleId="veh-1",
        component="brakes-pads-front",
        tier=1,
        state="critical",
        pFail1000km=0.8,
        pFailLower=0.7,
        pFailUpper=0.9,
        rulKmMean=80.0,
        rulKmLower=30.0,
        modelSource="physics-of-failure",
        featuresVersion="v1",
        updatedAt=now_iso(),
    )


def test_state_constants_match_spec():
    assert "DRIVING_TO_SC" in VALID_STATES
    assert "DONE" in VALID_STATES
    assert "FAILED" in VALID_STATES


@pytest.mark.asyncio
async def test_full_loop_reaches_done():
    api = FakeVsbsApi()
    ctx = OrchestratorContext(
        vehicle_id="veh-1",
        fault_name="brake-pad-wear",
        component_id="brakes-pads-front",
    )
    orch = DemoOrchestrator(api, ctx)  # type: ignore[arg-type]
    await orch.begin()
    assert orch.record.state == "DRIVING_HOME_AREA"
    await orch.fault_detected(_phm_reading())
    assert orch.record.state == "DRIVING_TO_SC"
    assert orch.record.booking_id is not None
    assert orch.record.outbound_grant_id is not None
    await orch.arrive_at_sc()
    assert orch.record.state == "SERVICING"
    await orch.service_complete()
    assert orch.record.state == "DRIVING_HOME"
    assert orch.record.return_grant_id is not None
    await orch.returned_home()
    assert orch.record.state == "DONE"


@pytest.mark.asyncio
async def test_fail_path_records_failed_state():
    api = FakeVsbsApi()
    ctx = OrchestratorContext(
        vehicle_id="veh-2",
        fault_name="brake-pad-wear",
        component_id="brakes-pads-front",
    )
    orch = DemoOrchestrator(api, ctx)  # type: ignore[arg-type]
    await orch.begin()
    await orch.fail("simulated breaker")
    assert orch.record.state == "FAILED"


@pytest.mark.asyncio
async def test_history_is_appended_in_order():
    api = FakeVsbsApi()
    ctx = OrchestratorContext(
        vehicle_id="veh-3",
        fault_name="brake-pad-wear",
        component_id="brakes-pads-front",
    )
    orch = DemoOrchestrator(api, ctx)  # type: ignore[arg-type]
    await orch.begin()
    await orch.fault_detected(_phm_reading())
    states = [evt.state for evt in orch.record.history]
    assert states[0] == "DRIVING_HOME_AREA"
    assert "BOOKING_PENDING" in states
    assert states[-1] == "DRIVING_TO_SC"


def test_grant_id_is_uuid():
    grant = DemoOrchestrator._mint_grant_id()
    assert len(grant) == 36
