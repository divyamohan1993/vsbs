# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Pydantic-backed Settings reader.

Reads from environment variables (and a `.env` file if present). All values
have sensible defaults so the demo can run in replay mode without any
configuration.
"""

from __future__ import annotations

import os
from enum import Enum
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field


class FaultKind(str, Enum):
    BRAKE_PAD_WEAR = "brake-pad-wear"
    COOLANT_OVERHEAT = "coolant-overheat"
    HV_BATTERY_IMBALANCE = "hv-battery-imbalance"
    TPMS_DROPOUT = "tpms-dropout"
    OIL_LOW = "oil-low"
    DRIVE_BELT_AGE = "drive-belt-age"


class Settings(BaseModel):
    """Runtime configuration. Frozen after construction."""

    vsbs_api_base: str = Field(default="http://localhost:8787")
    carla_host: str = Field(default="127.0.0.1")
    carla_port: int = Field(default=2000, ge=1, le=65535)
    carla_town: str = Field(default="Town10HD")
    vsbs_user_id: str = Field(default="demo-user-1")
    vsbs_vehicle_vin: str = Field(default="5YJ3E1EA1JF000316")
    vsbs_home_spawn_index: int = Field(default=0, ge=0)
    vsbs_tick_hz: int = Field(default=10, ge=1, le=60)
    vsbs_fault: FaultKind = Field(default=FaultKind.BRAKE_PAD_WEAR)
    vsbs_headless: bool = Field(default=True)
    vsbs_replay_trace: Optional[str] = Field(default=None)

    model_config = {
        "frozen": True,
        "use_enum_values": True,
    }

    @property
    def replay_path(self) -> Optional[Path]:
        if not self.vsbs_replay_trace:
            return None
        return Path(self.vsbs_replay_trace)

    @property
    def tick_seconds(self) -> float:
        return 1.0 / float(self.vsbs_tick_hz)


def _bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def load_settings(env_file: Optional[Path] = None) -> Settings:
    """Load settings from process env (and optional `.env` file)."""

    if env_file is not None and env_file.exists():
        load_dotenv(env_file, override=False)
    else:
        load_dotenv(override=False)

    fault = os.getenv("VSBS_FAULT", FaultKind.BRAKE_PAD_WEAR.value)
    try:
        fault_enum = FaultKind(fault)
    except ValueError:
        fault_enum = FaultKind.BRAKE_PAD_WEAR

    return Settings(
        vsbs_api_base=os.getenv("VSBS_API_BASE", "http://localhost:8787"),
        carla_host=os.getenv("CARLA_HOST", "127.0.0.1"),
        carla_port=int(os.getenv("CARLA_PORT", "2000")),
        carla_town=os.getenv("CARLA_TOWN", "Town10HD"),
        vsbs_user_id=os.getenv("VSBS_USER_ID", "demo-user-1"),
        vsbs_vehicle_vin=os.getenv("VSBS_VEHICLE_VIN", "5YJ3E1EA1JF000316"),
        vsbs_home_spawn_index=int(os.getenv("VSBS_HOME_SPAWN_INDEX", "0")),
        vsbs_tick_hz=int(os.getenv("VSBS_TICK_HZ", "10")),
        vsbs_fault=fault_enum,
        vsbs_headless=_bool(os.getenv("VSBS_HEADLESS"), default=True),
        vsbs_replay_trace=os.getenv("VSBS_REPLAY_TRACE") or None,
    )
