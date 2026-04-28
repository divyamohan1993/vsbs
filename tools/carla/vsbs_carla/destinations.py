# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
"""Service-centre catalogue with CARLA Town10HD waypoints.

Each entry pairs a service-centre identifier (matching the parts inventory
on the API side) with a CARLA spawn index and a stocking profile. The
spawn indices are valid for `Town10HD_Opt` in CARLA 0.10.0; the spec is
informational on machines without CARLA.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping


@dataclass(frozen=True)
class ServiceCentre:
    sc_id: str
    name: str
    location_name: str
    carla_spawn_index: int
    parts_stock: Mapping[str, int]
    geo: tuple[float, float]
    wellbeing: float
    drive_eta_minutes: int


# Town10HD spawn indices known to be valid for the standard 0.10.0 release.
HOME_SPAWN_INDEX: int = 0


SERVICE_CENTRES: list[ServiceCentre] = [
    ServiceCentre(
        sc_id="SC-IN-DEL-01",
        name="GoMechanic Karol Bagh",
        location_name="Karol Bagh, Delhi",
        carla_spawn_index=42,
        parts_stock={
            "BOSCH-BP1234": 4,
            "ATE-13.0460-2782.2": 2,
            "BOSCH-0451103300": 6,
            "TESLA-COOL-KIT-M3-2024": 1,
            "EXIDE-MX-7": 2,
            "GATES-K060842": 3,
            "MRF-ZSLK-205-55-16": 4,
        },
        geo=(28.6519, 77.1909),
        wellbeing=0.84,
        drive_eta_minutes=12,
    ),
    ServiceCentre(
        sc_id="SC-IN-DEL-02",
        name="Mahindra First Choice Saket",
        location_name="Saket, Delhi",
        carla_spawn_index=88,
        parts_stock={
            "MGP-MFC-BR-001": 6,
            "ATE-13.0460-2782.2": 1,
            "KN-PS-1004": 4,
            "EXIDE-MX-7": 5,
            "SKF-VKBA-3525": 2,
        },
        geo=(28.5273, 77.2174),
        wellbeing=0.91,
        drive_eta_minutes=8,
    ),
    ServiceCentre(
        sc_id="SC-IN-DEL-03",
        name="Tata Motors Workshop Lajpat Nagar",
        location_name="Lajpat Nagar, Delhi",
        carla_spawn_index=171,
        parts_stock={
            "BOSCH-BP1234": 1,
            "MGP-MFC-BR-001": 3,
            "BOSCH-0451103300": 4,
            "KN-PS-1004": 2,
            "MERC-EQS-CELL-MOD-A1": 1,
            "GATES-K060842": 5,
        },
        geo=(28.5677, 77.2436),
        wellbeing=0.78,
        drive_eta_minutes=14,
    ),
]


@dataclass
class HomeSpawn:
    spawn_index: int = HOME_SPAWN_INDEX
    name: str = "Home"
    geo: tuple[float, float] = (28.6139, 77.2090)
    dwell_seconds: int = 30


def find_centre(sc_id: str) -> ServiceCentre | None:
    for sc in SERVICE_CENTRES:
        if sc.sc_id == sc_id:
            return sc
    return None


def candidates_payload() -> list[dict]:
    """Shape that `/v1/dispatch/shortlist` expects in `candidates`."""
    return [
        {
            "scId": sc.sc_id,
            "name": sc.name,
            "wellbeing": sc.wellbeing,
            "driveEtaMinutes": sc.drive_eta_minutes,
        }
        for sc in SERVICE_CENTRES
    ]
