# SPDX-License-Identifier: Apache-2.0
"""Verify outbound payloads match the VSBS Zod schema shape."""

from __future__ import annotations

from vsbs_carla.schemas import PhmReadingPayload, SensorSamplePayload, now_iso


def test_sensor_sample_to_wire_uses_camelcase():
    sample = SensorSamplePayload(
        channel="tpms",
        timestamp=now_iso(),
        origin="sim",
        vehicleId="veh-1",
        value={"corner": "fl", "status": "ok", "pressure_kpa": 230.0},
        simSource="carla",
    )
    wire = sample.to_wire()
    assert wire["origin"] == "sim"
    assert wire["vehicleId"] == "veh-1"
    assert wire["simSource"] == "carla"
    assert wire["health"]["selfTestOk"] is True
    assert wire["channel"] == "tpms"


def test_sensor_sample_omits_optional_fields():
    sample = SensorSamplePayload(
        channel="bms",
        timestamp=now_iso(),
        origin="sim",
        vehicleId="veh-1",
        value={"soc_pct": 72.0, "cell_delta_mv": 8.0},
    )
    wire = sample.to_wire()
    assert "simSource" not in wire


def test_phm_reading_to_wire_camelcase():
    reading = PhmReadingPayload(
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
    wire = reading.to_wire()
    assert wire["vehicleId"] == "veh-1"
    assert wire["pFailLower"] == 0.7
    assert wire["pFailUpper"] == 0.9
    assert wire["modelSource"] == "physics-of-failure"
    assert wire["suspectedSensorFailure"] is False
