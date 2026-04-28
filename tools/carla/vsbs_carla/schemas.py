# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Pydantic mirrors of the VSBS Zod schemas.

These types intentionally match `packages/shared/src/sensors.ts` and the
relevant pieces of `packages/shared/src/{phm,autonomy}.ts` byte-for-byte.
The pydantic side enforces shape on outbound POST bodies; the server side
enforces it on inbound. Both must agree.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

SensorOrigin = Literal["real", "sim"]
SimSource = Literal["deterministic", "carla", "replay"]
SensorChannel = Literal[
    "obd-pid",
    "obd-dtc",
    "obd-freeze-frame",
    "smartcar",
    "tpms",
    "bms",
    "imu",
    "gps",
    "camera-front",
    "camera-rear",
    "camera-surround",
    "camera-cabin",
    "lidar",
    "radar-front",
    "radar-corner",
    "ultrasonic",
    "microphone",
    "hvac",
    "wheel-speed",
    "brake-pressure",
    "steering-torque",
]


class SensorHealth(BaseModel):
    self_test_ok: bool = Field(default=True, alias="selfTestOk")
    trust: float = Field(default=1.0, ge=0.0, le=1.0)
    residual: Optional[float] = None

    model_config = ConfigDict(populate_by_name=True)


class SensorSamplePayload(BaseModel):
    """One sensor sample. The wire shape matches the Zod schema exactly."""

    channel: SensorChannel
    timestamp: str
    origin: SensorOrigin
    vehicle_id: str = Field(alias="vehicleId")
    value: Any
    health: SensorHealth = Field(default_factory=SensorHealth)
    sim_source: Optional[SimSource] = Field(default=None, alias="simSource")

    model_config = ConfigDict(populate_by_name=True)

    def to_wire(self) -> dict[str, Any]:
        out = self.model_dump(by_alias=True, exclude_none=True)
        # health may have been emitted in alias form already; ensure consistency
        out.setdefault("health", {"selfTestOk": True, "trust": 1.0})
        if "health" in out and "self_test_ok" in out["health"]:
            inner = out["health"]
            inner["selfTestOk"] = inner.pop("self_test_ok")
        return out


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


# --- PHM ---------------------------------------------------------------------

PhmState = Literal["healthy", "watch", "act-soon", "critical", "unsafe"]
ComponentId = Literal[
    "brakes-hydraulic",
    "brakes-pads-front",
    "brakes-pads-rear",
    "abs-module",
    "steering-eps",
    "tire-fl",
    "tire-fr",
    "tire-rl",
    "tire-rr",
    "airbag-srs",
    "adas-camera-front",
    "adas-radar-front",
    "adas-radar-corner-fl",
    "adas-radar-corner-fr",
    "adas-radar-corner-rl",
    "adas-radar-corner-rr",
    "lidar-roof",
    "ultrasonic-array",
    "imu",
    "battery-12v",
    "battery-hv",
    "bms",
    "alternator",
    "engine-oil-system",
    "cooling-system",
    "fuel-system",
    "transmission",
    "suspension-dampers",
    "drive-belt",
    "wheel-bearings",
    "exhaust-o2",
    "dpf",
]


class PhmReadingPayload(BaseModel):
    vehicle_id: str = Field(alias="vehicleId")
    component: ComponentId
    tier: Literal[1, 2, 3]
    state: PhmState
    p_fail_1000km: float = Field(alias="pFail1000km", ge=0.0, le=1.0)
    p_fail_lower: float = Field(alias="pFailLower", ge=0.0, le=1.0)
    p_fail_upper: float = Field(alias="pFailUpper", ge=0.0, le=1.0)
    rul_km_mean: Optional[float] = Field(default=None, alias="rulKmMean", ge=0.0)
    rul_km_lower: Optional[float] = Field(default=None, alias="rulKmLower", ge=0.0)
    model_source: Literal[
        "physics-of-failure",
        "empirical-rule",
        "ensemble-transformer",
        "ensemble-lstm",
        "inspection",
    ] = Field(alias="modelSource")
    features_version: str = Field(alias="featuresVersion")
    updated_at: str = Field(alias="updatedAt")
    suspected_sensor_failure: bool = Field(default=False, alias="suspectedSensorFailure")

    model_config = ConfigDict(populate_by_name=True)

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True)


# --- Booking + grant ---------------------------------------------------------


class BookingDraft(BaseModel):
    vehicle_id: str = Field(alias="vehicleId")
    issue: dict[str, Any]
    safety: dict[str, Any]
    required_parts: list[str] = Field(alias="requiredParts")
    service_skill: str = Field(alias="serviceSkill")

    model_config = ConfigDict(populate_by_name=True)
