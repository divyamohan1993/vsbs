# CARLA demo guide

The headline VSBS demo runs the entire autonomous-service loop end to end, with CARLA driving the ego vehicle and VSBS owning every booking, dispatch, parts, grant, and audit step.

Author: Divya Mohan (dmj.one).

## What you see, in one paragraph

A vehicle wakes up at home, pulls onto the road, and within two minutes its onboard PHM detects a critical fault. VSBS opens a booking on the spot, ranks the three local service centres by parts availability + wellbeing + ETA, and picks the right one. The owner's signed command-grant authorises the trip. The car drives itself there, gets serviced, and a fresh return-grant brings it home. Every transition is on the audit chain. No human touched the wheel.

## Architecture (ASCII)

```
+-----------------+   10 Hz POST    +---------------------+
| CARLA / Replay  |---------------> |  CarlaSensorBridge  |
|  ego vehicle    |                 |  batched flush      |
|  + sensors      |                 +----------+----------+
+--------+--------+                            |
         |                                     v
         |                          +---------------------+
         | BehaviorAgent target     |     VsbsApi (HTTP)  |
         | switched per state       | sensors / phm /     |
         |                          | dispatch / autonomy |
         v                          +----------+----------+
+----------------------+                       |
|  DemoOrchestrator    |  trigger booking      v
|  state machine       |---------------> +---------------+
|  (in tools/carla)    |                 |  PHM module   |
+----------+-----------+ <-- grants ---  |  parts triage |
           |                             |  command grant|
           |                             +---------------+
           v
   /v1/scenarios mirror  -->  web /demo/carla page
```

## State machine

```
IDLE
  └ DRIVING_HOME_AREA  (warm-up, ~30 s)
      └ FAULT_INJECTING  (virtual channel ramps to threshold)
          └ BOOKING_PENDING  (PHM triggers booking draft)
              └ AWAITING_GRANT  (parts-aware dispatch picks SC)
                  └ DRIVING_TO_SC  (signed outbound grant verified)
                      └ SERVICING  (dwell window, configurable)
                          └ AWAITING_RETURN_GRANT
                              └ DRIVING_HOME  (signed return grant verified)
                                  └ DONE
```

A FAILED state collects every dead-end (parts unavailable, grant refused, network failure mid-route).

## Faults

| `--fault`              | Component               | Envelope                                       |
|------------------------|-------------------------|------------------------------------------------|
| `brake-pad-wear`       | brakes-pads-front       | 70 % to 12 % over 90 s, critical at 18 %       |
| `coolant-overheat`     | cooling-system          | 88 to 118 deg C over 60 s, critical at 110     |
| `hv-battery-imbalance` | battery-hv              | 8 to 180 mV cell delta over 120 s              |
| `tpms-dropout`         | tire-fl                 | front-left dropout at t+15 s                   |
| `oil-low`              | engine-oil-system       | 9.5k to 13.5k km age over 90 s                 |
| `drive-belt-age`       | drive-belt              | 0.92 to 0.40 belt-health over 90 s             |

Each fault maps to a `ComponentId` the PHM module knows about and to a Bosch / ATE / Exide / SKF / MRF / Mercedes / K&N / Gates / Tata / Tesla part code in the inventory adapter.

## Recovery from failure modes

| Symptom                       | Bridge response                                                                   |
|-------------------------------|-----------------------------------------------------------------------------------|
| CARLA RPC unreachable         | Falls back to `TraceReplayer` over the bundled JSONL trace.                       |
| API `/readyz` fails           | Smoke script bails out after 30 retries with a clear stderr message.              |
| `/v1/sensors/ingest` 4xx      | Drops the buffered batch and continues; orchestrator state is unaffected.         |
| `/v1/sensors/ingest` 5xx      | Two retries with exponential back-off then drops the batch.                       |
| Grant expired mid-route       | Bridge halts the BehaviorAgent target switch; logs `grant-expired` event.         |
| `/v1/dispatch` 409 (no parts) | Orchestrator emits `FAILED` with the missing parts list and stops the loop.       |
| Replay file missing           | Generates an in-memory deterministic trace via `record_trace.py` and uses that.   |

## Consent bootstrap

The API enforces `requireConsent(purpose)` on `/v1/sensors/ingest`, `/v1/dispatch/*`, `/v1/intake/*`, `/v1/payments/*`, and `/v1/autonomy/grant`. The CARLA bridge calls `POST /v1/scenarios/bootstrap-consent` at startup to seed every purpose the gates need for the demo user, at the latest notice version:

| Purpose                  | Why the demo needs it                          |
|--------------------------|------------------------------------------------|
| `service-fulfilment`     | clears the dispatch + intake + payments gates  |
| `diagnostic-telemetry`   | clears the sensors-ingest gate                 |
| `autonomy-delegation`    | clears the autonomy/grant gate                 |
| `autopay-within-cap`     | future payments-within-cap path                |
| `voice-photo-processing` | unlocks voice + photo PHM enrichments          |

The route is at `apps/api/src/routes/scenarios.ts` and writes through the same `ConsentManager` instance the gates read from, so the seeded grants are visible to the gate middleware on the very next request.

> **Re-bootstrap after erasure.** Running `POST /v1/me/erasure` cascades through the demo user's consent rows. After erasure (or any API restart, which wipes the in-memory `ConsentManager`), call `POST /v1/scenarios/bootstrap-consent {"userId": "<vehicle-id>"}` again. The bridge does this automatically on every run.

## Run quickstart

```bash
# 1. start the API in sim mode
( cd apps/api && LLM_PROFILE=sim PORT=8787 bun src/server.ts ) &

# 2. run the demo bridge in replay mode
python -m vsbs_carla.scripts.run_demo \
  --replay tools/carla/replay/town10hd-brake-failure.jsonl \
  --headless

# 3. or run the smoke test that does both for you:
bash tools/carla/scripts/smoke.sh
```

## Web view

Visit `/demo/carla` in the web app while the bridge is running. The page polls `/v1/scenarios/<id>` and `/v1/sensors/<vehicleId>/latest` every 2 s and shows:

- Telemetry tiles (speed, heading, brake-pad %, coolant, HV battery SoC, cell delta).
- A booking timeline with the nine canonical stages.
- The two command-grant IDs (outbound and return).
- The full transition history for the active scenario.

All strings are i18n-ready (en + hi shipped today). Every status surface uses `role="status"` with `aria-live="polite"` so screen readers see updates without taking focus.

## Provenance and origin invariant

Every sample the bridge POSTs carries `origin: "sim"` and `simSource: "carla"` (or `"replay"`). The fusion layer's origin summary surfaces the count of each so a downstream consumer can verify that no sim sample escaped into a real customer decision log. This invariant is enforced in code, not policy.

## Author + license

Author: Divya Mohan (dmj.one). Licensed under Apache-2.0. See the `NOTICE` file in the repo root.
