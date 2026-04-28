# VSBS CARLA bridge

End-to-end demo: CARLA-driven autonomous failure to booking to drive to service to return.

Author: **Divya Mohan / dmj.one** (Apache-2.0).

The bridge runs the VSBS headline scenario:

1. The ego vehicle starts at "Home" and drives autonomously in `Town10HD`.
2. After a warm-up window, a real fault is injected (brake-pad wear by default).
3. The bridge streams `SensorSample` batches (`origin: "sim"`, `simSource: "carla"`) to VSBS at 10 Hz.
4. PHM detects critical RUL and the bridge calls `POST /v1/phm/{vehicleId}/triggers/booking`.
5. Parts-aware dispatch picks the best service centre. A booking is opened.
6. A command-grant is minted and the bridge switches the BehaviorAgent target to the SC waypoint.
7. On arrival the bridge calls `/v1/dispatch/{bookingId}/arrive`. After service, `/complete`.
8. A return command-grant is minted; the vehicle drives home and the booking closes.

The same script runs in two modes:

- **Live CARLA** — connects to a CARLA 0.10.0 server and drives a real ego vehicle.
- **Replay** — plays a pre-recorded trace through the same plumbing without CARLA. Useful in CI and on machines that cannot host the 30 GB CARLA binary.

## Prerequisites

- Python 3.10+.
- VSBS API running locally: `LLM_PROFILE=sim PORT=8787 bun apps/api/src/server.ts`.
- (Live mode only) CARLA 0.10.0 binary on the same machine. Download:
  - https://github.com/carla-simulator/carla/releases/tag/0.10.0
  - Untar and start with `./CarlaUE4.sh -prefernvidia -carla-rpc-port=2000` (Linux) or `./CarlaUE4.bat` (Windows).
- (Live mode only) `pip install carla==0.10.0` from the wheel that ships in the CARLA release tarball.

## Install

```bash
cd tools/carla
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
# Live CARLA mode also needs:
# pip install ".[carla]"
```

## Configuration

Copy `.env.example` to `.env` and override what you need. Defaults work out of the box for replay mode.

```bash
VSBS_API_BASE=http://localhost:8787
CARLA_HOST=127.0.0.1
CARLA_PORT=2000
CARLA_TOWN=Town10HD
VSBS_USER_ID=demo-user-1
VSBS_VEHICLE_VIN=5YJ3E1EA1JF000316
VSBS_HOME_SPAWN_INDEX=0
VSBS_TICK_HZ=10
VSBS_FAULT=brake-pad-wear
VSBS_HEADLESS=true
VSBS_REPLAY_TRACE=
```

## Run the demo

### Replay mode (no CARLA install required)

```bash
python -m vsbs_carla.scripts.run_demo \
  --replay tools/carla/replay/town10hd-brake-failure.jsonl \
  --headless
```

### Live CARLA mode

```bash
python -m vsbs_carla.scripts.run_demo \
  --fault brake-pad-wear \
  --town Town10HD \
  --headless
```

### Available faults

- `brake-pad-wear` (default) — front pads ramp 70% to 12% over 90 s.
- `coolant-overheat` — coolant temp ramps 88 °C to 118 °C over 60 s.
- `hv-battery-imbalance` — cell ΔV ramps 8 mV to 180 mV over 120 s.
- `tpms-dropout` — front-left TPMS goes dropout at t+15 s.
- `oil-low` — engine oil age past 12,000 km service window.
- `drive-belt-age` — belt cracking detected over 90 s.

## Record a trace

```bash
python -m vsbs_carla.scripts.record_trace \
  --fault brake-pad-wear \
  --out tools/carla/replay/my-trace.jsonl
```

The recorder runs the deterministic CARLA-free physics model and writes one JSON line per tick. Replay this file later via `--replay`.

## Consent bootstrap (DPDP gates)

The API gates `/v1/sensors/ingest`, `/v1/dispatch/*`, `/v1/intake/*`, `/v1/payments/*`, and `/v1/autonomy/grant` behind `requireConsent(purpose)`. The bridge calls `POST /v1/scenarios/bootstrap-consent` **before** the first ingest, which seeds these purposes for the demo user at the latest notice version:

- `service-fulfilment`
- `diagnostic-telemetry`
- `autonomy-delegation`
- `autopay-within-cap`
- `voice-photo-processing`

You do not need to do anything for this in normal demo runs — `vsbs_carla.scripts.run_demo` handles it on startup.

> **Re-bootstrap after erasure.** The `/v1/me/erasure` flow purges the demo user's consent rows along with everything else. If you run an erasure between demo runs (or restart the API, which wipes the in-memory `ConsentManager`), call `POST /v1/scenarios/bootstrap-consent {"userId": "<your-vehicle-id>"}` again, or just re-run the bridge — it bootstraps every time.

## Smoke test

```bash
bash tools/carla/scripts/smoke.sh
```

Brings up the API in sim mode, runs the bridge against the bundled trace, and asserts that the orchestrator reaches `DONE` and the booking closes.

## Architecture

```
+------------------+      10 Hz  +-------------------+
|  CARLA / Replay  |  ---------> |   SensorBridge    |
|  ego + sensors   |             |  batched flush    |
+--------+---------+             +---------+---------+
         |                                 |
         v                                 v
+------------------+              +-------------------+
|  BehaviorAgent   |              |     VsbsApi       |
|  navigates       |              | /v1/sensors/...   |
+------------------+              +-------------------+
         ^                                 |
         | grant verified                  v
+------------------+              +-------------------+
| DemoOrchestrator | <----------- | LangGraph + PHM   |
| state machine    |   booking +  | parts triage      |
+------------------+   grant      +-------------------+
```

`DemoOrchestrator` owns the state machine: `IDLE → DRIVING_HOME_AREA → FAULT_INJECTING → BOOKING_PENDING → AWAITING_GRANT → DRIVING_TO_SC → SERVICING → AWAITING_RETURN_GRANT → DRIVING_HOME → DONE`.

## Tests

```bash
cd tools/carla
pytest -q
```

The test suite verifies:

- `SensorSamplePayload` shape conformance against the VSBS Zod schema.
- `FaultScheduler` ramp math (deterministic envelope).
- `DemoOrchestrator` state transitions with a mocked `VsbsApi`.
- `TraceReplayer` determinism (same trace, same outputs).
