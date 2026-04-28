# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""DemoOrchestrator — owns the demo loop's state machine.

States:
    IDLE -> DRIVING_HOME_AREA -> FAULT_INJECTING ->
    BOOKING_PENDING -> AWAITING_GRANT -> DRIVING_TO_SC ->
    SERVICING -> AWAITING_RETURN_GRANT -> DRIVING_HOME -> DONE

The orchestrator is API-agnostic: it accepts a `VsbsApi` instance and a
`fault_factory`. CARLA-specific driving (BehaviorAgent navigation) lives in
`world.CarlaWorld`; a None world uses straight-line replay.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from .api import VsbsApi
from .destinations import (
    SERVICE_CENTRES,
    ServiceCentre,
    candidates_payload,
    find_centre,
)
from .schemas import PhmReadingPayload

LOG = logging.getLogger("vsbs_carla.agent")

OrchestratorState = str

VALID_STATES: tuple[str, ...] = (
    "IDLE",
    "DRIVING_HOME_AREA",
    "FAULT_INJECTING",
    "BOOKING_PENDING",
    "AWAITING_GRANT",
    "DRIVING_TO_SC",
    "SERVICING",
    "AWAITING_RETURN_GRANT",
    "DRIVING_HOME",
    "DONE",
    "FAILED",
    # Safety fallback: fault crossed full-critical mid-route, OR the
    # auto-driver got stuck / detected a sensor fault. Vehicle halts in
    # place, the user is notified to call a tow truck, the booking is
    # marked tow-required and the demo loop exits cleanly.
    "HALTED_AWAITING_TOW",
)


@dataclass
class OrchestratorContext:
    vehicle_id: str
    fault_name: str
    component_id: str
    sc_count: int = 3
    dwell_seconds_at_sc: float = 60.0
    warmup_seconds: float = 30.0


@dataclass
class OrchestratorEvent:
    state: OrchestratorState
    note: str
    at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
    )


@dataclass
class OrchestratorRecord:
    scenario_id: Optional[str] = None
    booking_id: Optional[str] = None
    sc: Optional[ServiceCentre] = None
    outbound_grant_id: Optional[str] = None
    return_grant_id: Optional[str] = None
    history: list[OrchestratorEvent] = field(default_factory=list)
    state: OrchestratorState = "IDLE"


class DemoOrchestrator:
    def __init__(
        self,
        api: VsbsApi,
        ctx: OrchestratorContext,
        *,
        on_state: Callable[[OrchestratorEvent], Awaitable[None]] | None = None,
    ) -> None:
        self._api = api
        self._ctx = ctx
        self._on_state = on_state
        self.record = OrchestratorRecord()

    async def _transition(self, state: OrchestratorState, note: str) -> None:
        if state not in VALID_STATES:
            raise ValueError(f"unknown state {state}")
        self.record.state = state
        evt = OrchestratorEvent(state=state, note=note)
        self.record.history.append(evt)
        if self.record.scenario_id:
            try:
                await self._api.scenario_transition(
                    self.record.scenario_id,
                    state,
                    note=note,
                    booking_id=self.record.booking_id,
                    sc_id=self.record.sc.sc_id if self.record.sc else None,
                    outbound_grant_id=self.record.outbound_grant_id,
                    return_grant_id=self.record.return_grant_id,
                )
            except Exception as err:
                LOG.warning("scenario transition push failed: %s", err)
        if self._on_state is not None:
            await self._on_state(evt)
        LOG.info("state=%s note=%s", state, note)

    async def begin(self) -> None:
        sc = await self._api.scenario_start(
            self._ctx.vehicle_id,
            self._ctx.fault_name,
            sc_count=self._ctx.sc_count,
        )
        self.record.scenario_id = sc["scenarioId"]
        await self._transition("DRIVING_HOME_AREA", "Ego is warming up around home.")

    async def fault_detected(self, reading: PhmReadingPayload) -> None:
        await self._transition("FAULT_INJECTING", f"PHM critical for {reading.component}.")
        await self._transition("BOOKING_PENDING", "Drafting booking from PHM trigger.")
        draft = await self._api.phm_trigger_booking(reading)
        required_parts = list(draft["draft"]["requiredParts"])
        shortlist = await self._api.dispatch_shortlist(
            self._ctx.vehicle_id,
            candidates_payload(),
            required_parts=required_parts,
        )
        if "error" in shortlist:
            await self._transition("FAILED", str(shortlist["error"]))
            return
        sc_id = shortlist["recommendation"]["scId"]
        sc = find_centre(sc_id)
        if sc is None:
            await self._transition("FAILED", f"unknown SC {sc_id}")
            return
        self.record.sc = sc
        booking = await self._api.booking_create(
            phone="+919999999999",
            vehicle={"vin": "5YJ3E1EA1JF000316"},
            issue=draft["draft"]["issue"],
            safety=draft["draft"]["safety"],
        )
        self.record.booking_id = booking["id"]
        await self._api.dispatch_start(self.record.booking_id, sc.sc_id)
        await self._transition(
            "AWAITING_GRANT",
            f"Booking {self.record.booking_id} opened at {sc.name}; minting outbound grant.",
        )
        self.record.outbound_grant_id = self._mint_grant_id()
        await self._transition(
            "DRIVING_TO_SC",
            f"Outbound grant {self.record.outbound_grant_id} verified; en route.",
        )

    async def arrive_at_sc(self) -> None:
        if self.record.booking_id is None:
            return
        await self._api.dispatch_arrive(self.record.booking_id)
        await self._api.dispatch_begin_service(self.record.booking_id)
        await self._transition("SERVICING", "Vehicle in bay; service window started.")

    async def service_complete(self) -> None:
        if self.record.booking_id is None:
            return
        await self._api.dispatch_complete(self.record.booking_id)
        await self._transition(
            "AWAITING_RETURN_GRANT",
            "Service complete; minting return grant.",
        )
        self.record.return_grant_id = self._mint_grant_id()
        await self._api.dispatch_return_leg(self.record.booking_id)
        await self._transition(
            "DRIVING_HOME",
            f"Return grant {self.record.return_grant_id} verified; en route home.",
        )

    async def halt_for_tow(self, reason: str) -> None:
        """Vehicle cannot safely continue. Stop, escalate to tow.

        Called by the live runner when, while routed to or from the SC,
        any of these are observed:
          - the underlying fault crosses its full-critical threshold
            (the prediction came true; auto-driving cannot finish the
            trip safely);
          - the ego stops responding to BasicAgent commands for several
            consecutive seconds (stuck, route blocked, controller bug);
          - any sensor sample reports quality=failed for a safety-tier
            channel (sensor fault while autonomous = halt by policy).

        Emits a clear notification, escalates the booking to
        tow-required via the API, transitions to HALTED_AWAITING_TOW,
        and breaks the demo loop.
        """
        # Don't loop. If we are already halted, no-op.
        if self.record.state == "HALTED_AWAITING_TOW":
            return
        # Best-effort escalation. Sim-mode API returns 200 with the
        # tow-mode booking record; live mode would hit a dispatcher.
        if self.record.booking_id is not None:
            try:
                await self._api.dispatch_halt_for_tow(self.record.booking_id, reason)
            except Exception as err:
                LOG.warning("halt-for-tow API call failed (%s); continuing", err)
        await self._transition(
            "HALTED_AWAITING_TOW",
            f"Vehicle halted; tow required. Reason: {reason}",
        )

    async def returned_home(self) -> None:
        if self.record.booking_id is None:
            return
        await self._api.dispatch_returned(self.record.booking_id)
        await self._transition("DONE", "Vehicle returned home; demo loop closed.")

    async def fail(self, reason: str) -> None:
        await self._transition("FAILED", reason)

    @staticmethod
    def _mint_grant_id() -> str:
        return str(uuid.uuid4())
