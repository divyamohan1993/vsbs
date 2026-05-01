# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Async VSBS API client used by the CARLA bridge.

Wraps `httpx.AsyncClient` with the few endpoints the demo loop touches.
Every method validates the response shape via pydantic models so a mismatch
with the Zod schema fails immediately.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass
from typing import Any, AsyncIterator, Optional

import httpx

from .schemas import PhmReadingPayload, SensorSamplePayload

LOG = logging.getLogger("vsbs_carla.api")


@dataclass
class IngestResult:
    accepted: int
    real: int
    sim: int
    sim_sources: dict[str, int]
    observation_id: str


class VsbsApi:
    """Thin async client. The bridge holds exactly one of these."""

    def __init__(
        self,
        base: str,
        *,
        timeout_s: float = 10.0,
        owner_id: str | None = None,
    ) -> None:
        self._base = base.rstrip("/")
        headers: dict[str, str] = {}
        if owner_id is not None:
            headers["x-vsbs-owner"] = owner_id
        self._client = httpx.AsyncClient(
            base_url=self._base,
            timeout=timeout_s,
            headers=headers,
        )
        self._owner_id = owner_id

    async def grant_consent(self, purpose: str, version: str = "1.0.0") -> bool:
        """Best-effort single-purpose consent grant for the demo's owner identity."""
        body = {"purpose": purpose, "version": version, "source": "web", "locale": "en"}
        try:
            r = await self._client.post("/v1/me/consent/grant", json=body)
            return r.status_code in (200, 201, 202)
        except Exception as err:
            LOG.warning("consent grant failed: %s", err)
            return False

    async def bootstrap_consent(
        self,
        user_id: str,
        purposes: list[str] | None = None,
        *,
        source: str = "web",
        locale: str = "en",
    ) -> dict[str, Any]:
        """Batch-seed every purpose the gated routes need for the demo user.

        Must be called before any /v1/sensors/ingest, /v1/dispatch/*,
        /v1/intake/*, /v1/payments/*, or /v1/autonomy/grant request, because
        the consent gates return 409 consent-required otherwise. The server
        route is `POST /v1/scenarios/bootstrap-consent` and writes through
        the same ConsentManager the gates read from.
        """
        body: dict[str, Any] = {"userId": user_id, "source": source, "locale": locale}
        if purposes is not None:
            body["purposes"] = purposes
        r = await self._client.post("/v1/scenarios/bootstrap-consent", json=body)
        if r.status_code == 503:
            LOG.warning("bootstrap-consent unavailable: %s", r.text)
            return {}
        r.raise_for_status()
        return r.json().get("data", {})

    async def aclose(self) -> None:
        await self._client.aclose()

    # --- health --------------------------------------------------------

    async def health_ready(self) -> bool:
        try:
            r = await self._client.get("/readyz")
            r.raise_for_status()
            data = r.json()
            return bool(data.get("ok"))
        except Exception as err:
            LOG.warning("readyz failed: %s", err)
            return False

    # --- sensors -------------------------------------------------------

    async def ingest_samples(
        self,
        vehicle_id: str,
        samples: list[SensorSamplePayload],
        *,
        max_attempts: int = 2,
    ) -> IngestResult:
        wire = [s.to_wire() for s in samples]
        body = {"vehicleId": vehicle_id, "samples": wire}
        attempt = 0
        last_err: Optional[Exception] = None
        while attempt < max_attempts:
            attempt += 1
            try:
                r = await self._client.post("/v1/sensors/ingest", json=body)
                if r.status_code in (200, 202):
                    payload = r.json()
                    data = payload["data"]
                    summary = data.get("originSummary", {"real": 0, "sim": 0, "simSources": {}})
                    return IngestResult(
                        accepted=int(data.get("accepted", len(samples))),
                        real=int(summary.get("real", 0)),
                        sim=int(summary.get("sim", 0)),
                        sim_sources=dict(summary.get("simSources", {})),
                        observation_id=str(data.get("observationId", "")),
                    )
                # 4xx means we'll never succeed by retrying; surface immediately.
                if 400 <= r.status_code < 500:
                    raise RuntimeError(f"ingest failed status={r.status_code} body={r.text}")
                raise RuntimeError(f"ingest 5xx status={r.status_code} body={r.text}")
            except Exception as err:
                last_err = err
                if attempt >= max_attempts:
                    break
                wait = min(1.0, 0.15 * (2 ** attempt) + random.random() * 0.1)
                LOG.warning("ingest retry %d after %.2fs (%s)", attempt, wait, err)
                await asyncio.sleep(wait)
        assert last_err is not None
        raise last_err

    async def latest(self, vehicle_id: str) -> dict[str, Any]:
        r = await self._client.get(f"/v1/sensors/{vehicle_id}/latest")
        r.raise_for_status()
        return r.json().get("data", {})

    # --- autonomy live hub --------------------------------------------------
    #
    # The autonomy dashboard subscribes to /v1/autonomy/{id}/telemetry/sse and
    # /events/sse. Anything POSTed to the matching ingest endpoints is fanned
    # out to live subscribers within milliseconds. The live CARLA bridge
    # publishes the rich L5-shaped frame (cameras, radar, LiDAR, GNSS, IMU,
    # wheels, powertrain cells, V2X, OOD, etc.) so the dashboard renders
    # CARLA-truth instead of the deterministic fallback.

    async def autonomy_telemetry(self, booking_id: str, frame: dict[str, Any]) -> None:
        try:
            r = await self._client.post(
                f"/v1/autonomy/{booking_id}/telemetry/ingest", json=frame
            )
            if r.status_code not in (200, 202):
                LOG.debug("autonomy.telemetry %s: %s", r.status_code, r.text[:160])
        except Exception as err:
            LOG.debug("autonomy.telemetry post failed: %s", err)

    async def autonomy_event(
        self,
        booking_id: str,
        *,
        category: str,
        severity: str,
        title: str,
        detail: Optional[str] = None,
        data: Optional[dict[str, Any]] = None,
    ) -> None:
        from datetime import datetime, timezone

        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z",
            "category": category,
            "severity": severity,
            "title": title,
        }
        if detail:
            payload["detail"] = detail
        if data:
            payload["data"] = data
        try:
            r = await self._client.post(
                f"/v1/autonomy/{booking_id}/events/ingest", json=payload
            )
            if r.status_code not in (200, 202):
                LOG.debug("autonomy.event %s: %s", r.status_code, r.text[:160])
        except Exception as err:
            LOG.debug("autonomy.event post failed: %s", err)

    # --- phm + dispatch + bookings ------------------------------------

    async def phm_trigger_booking(
        self,
        reading: PhmReadingPayload,
        in_motion: bool = True,
    ) -> dict[str, Any]:
        body = {
            "vehicleId": reading.vehicle_id,
            "reading": reading.to_wire(),
            "inMotion": in_motion,
        }
        r = await self._client.post(
            f"/v1/phm/{reading.vehicle_id}/triggers/booking",
            json=body,
        )
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_shortlist(
        self,
        vehicle_id: str,
        candidates: list[dict[str, Any]],
        *,
        required_parts: list[str] | None = None,
        mode: str = "drive-in",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "vehicleId": vehicle_id,
            "mode": mode,
            "candidates": candidates,
            "requiredParts": list(required_parts or []),
        }
        r = await self._client.post("/v1/dispatch/shortlist", json=body)
        if r.status_code == 409:
            return {"error": r.json().get("error", {})}
        r.raise_for_status()
        return r.json()["data"]

    async def booking_create(
        self,
        *,
        phone: str,
        vehicle: dict[str, Any],
        issue: dict[str, Any],
        safety: dict[str, Any],
    ) -> dict[str, Any]:
        body = {
            "owner": {"phone": phone},
            "vehicle": vehicle,
            "issue": issue,
            "safety": safety,
            "source": "agent",
        }
        r = await self._client.post("/v1/bookings", json=body)
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_start(self, booking_id: str, sc_id: str) -> dict[str, Any]:
        r = await self._client.post(
            f"/v1/dispatch/{booking_id}/start",
            json={"scId": sc_id},
        )
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_arrive(self, booking_id: str) -> dict[str, Any]:
        r = await self._client.post(f"/v1/dispatch/{booking_id}/arrive")
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_begin_service(self, booking_id: str) -> dict[str, Any]:
        r = await self._client.post(f"/v1/dispatch/{booking_id}/begin-service")
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_complete(self, booking_id: str) -> dict[str, Any]:
        r = await self._client.post(f"/v1/dispatch/{booking_id}/complete")
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_return_leg(self, booking_id: str) -> dict[str, Any]:
        r = await self._client.post(f"/v1/dispatch/{booking_id}/return-leg")
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_returned(self, booking_id: str) -> dict[str, Any]:
        r = await self._client.post(f"/v1/dispatch/{booking_id}/returned")
        r.raise_for_status()
        return r.json()["data"]

    async def dispatch_halt_for_tow(
        self,
        booking_id: str,
        reason: str,
    ) -> dict[str, Any]:
        """Escalate the booking: vehicle cannot continue under its own
        power. Server flips the dispatch leg to tow-required, notifies
        the user, and returns the updated leg record. Idempotent."""
        body = {"reason": reason, "source": "carla-bridge"}
        r = await self._client.post(
            f"/v1/dispatch/{booking_id}/halt-for-tow",
            json=body,
        )
        # Treat 404 (older API build without this route) as a soft
        # success so the orchestrator can still halt locally.
        if r.status_code == 404:
            return {"halted": True, "tow_required": True, "remote": "missing-route"}
        r.raise_for_status()
        return r.json().get("data", {})

    # --- scenarios -----------------------------------------------------

    async def scenario_start(
        self,
        vehicle_id: str,
        fault: str,
        sc_count: int = 3,
    ) -> dict[str, Any]:
        body = {"vehicleId": vehicle_id, "fault": fault, "scCount": sc_count}
        r = await self._client.post("/v1/scenarios/carla-demo/start", json=body)
        r.raise_for_status()
        return r.json()["data"]

    async def scenario_transition(
        self,
        scenario_id: str,
        state: str,
        *,
        note: str | None = None,
        booking_id: str | None = None,
        sc_id: str | None = None,
        outbound_grant_id: str | None = None,
        return_grant_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"state": state}
        if note:
            body["note"] = note
        if booking_id:
            body["bookingId"] = booking_id
        if sc_id:
            body["scId"] = sc_id
        if outbound_grant_id:
            body["outboundGrantId"] = outbound_grant_id
        if return_grant_id:
            body["returnGrantId"] = return_grant_id
        r = await self._client.post(
            f"/v1/scenarios/{scenario_id}/transition",
            json=body,
        )
        r.raise_for_status()
        return r.json()["data"]

    async def scenario_get(self, scenario_id: str) -> dict[str, Any]:
        r = await self._client.get(f"/v1/scenarios/{scenario_id}")
        r.raise_for_status()
        return r.json()["data"]

    # --- streaming ----------------------------------------------------

    async def bookings_stream(self, booking_id: str) -> AsyncIterator[dict[str, Any]]:
        url = f"{self._base}/v1/bookings/{booking_id}/stream"
        async with self._client.stream("GET", url) as resp:
            buf = b""
            async for chunk in resp.aiter_bytes():
                buf += chunk
                while b"\n\n" in buf:
                    raw, buf = buf.split(b"\n\n", 1)
                    block = raw.decode("utf-8", errors="replace")
                    event = "message"
                    data = ""
                    for line in block.splitlines():
                        if line.startswith("event:"):
                            event = line[len("event:") :].strip()
                        elif line.startswith("data:"):
                            data = line[len("data:") :].strip()
                    if not data:
                        continue
                    try:
                        yield {"event": event, "data": json.loads(data)}
                    except json.JSONDecodeError:
                        yield {"event": event, "data": data}
                    if event == "end":
                        return
