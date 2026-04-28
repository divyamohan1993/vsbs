# CARLA live demo — autonomous brake-failure recovery loop

Live counterpart to [docs/demo/carla.md](carla.md). Where the original
shipped against a deterministic JSONL replay so the smoke test could run
without the 30 GB CARLA binary, this runs the same orchestrator against a
real, ticking CARLA 0.9.16 server with autopilot, traffic-manager NPCs,
real Vulkan rendering, and BasicAgent navigation.

## Hardware notes

CARLA 0.9.16 is built on Unreal Engine 4.26 and requires a Vulkan-capable
GPU. On the dev box used for the proof run the discrete NVIDIA 940MX has
only 2 GB of VRAM and crashes with `VK_ERROR_DEVICE_LOST` while loading
any town. Forcing the Intel HD 620 iGPU via
`VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/intel_icd.json` reroutes Vulkan
through the integrated chip, which uses system RAM and tolerates the
load. Frame rate is low (5 to 10 fps) but the world ticks correctly.

If your box has a discrete GPU with 4 GB VRAM or more, drop that override
and CARLA will use it natively at full quality.

## One-shot launcher

```bash
# Assumes CARLA 0.9.16 is unpacked at /mnt/experiments/carla-0.9.16
# (override with CARLA_HOME=/your/path)

CARLA_TOWN=Town01 NPC_COUNT=6 WARMUP_S=10 FAULT_DURATION_S=25 \
  bash tools/carla/scripts/run_live_demo.sh
```

The script:
1. boots `CarlaUE4.sh` in `-RenderOffScreen` + `-quality-level=Low` on a
   400 by 300 render target so the iGPU survives the load;
2. waits for the RPC port to open and pings the server with the python
   client;
3. starts the VSBS API in `LLM_PROFILE=sim` on port 8787;
4. runs `python -m vsbs_carla.scripts.run_demo_live` against both.

## What it does

| Phase | Trigger | Effect |
| --- | --- | --- |
| `DRIVING_HOME_AREA` | enter `main_loop` | Tesla Model 3 ego + 6 NPCs spawn; ego on TrafficManager autopilot, obeying lights and yielding to NPCs |
| `FAULT_INJECTING` | `FaultScheduler.any_critical()` | brake-pad pct ramps from 70 to 18 percent over 25 s after a 10 s warm-up; controller starts capping ego brake authority via `_apply_brake_degradation` so the failing brake actually feels failed |
| `BOOKING_PENDING` | PHM critical | `POST /v1/phm/{vehicleId}/triggers/booking` drafts an intake with the failed component, dispatch triages SCs by parts in stock plus ETA plus wellbeing |
| `AWAITING_GRANT` | booking opened | outbound CommandGrant minted, RFC 8785 canonical bytes signed |
| `DRIVING_TO_SC` | grant verified | controller switches from autopilot to `BasicAgent.set_destination(sc_target)`, real autonomous routing through the live world; brake-degradation effect remains active |
| `SERVICING` | `arrival_distance_m() < 8` | ego stops at SC, `dispatch.arrive` then `dispatch.begin-service` |
| `AWAITING_RETURN_GRANT` | dwell expires | `dispatch.complete` then return grant minted |
| `DRIVING_HOME` | grant verified | BasicAgent retargets the home spawn |
| `DONE` | arrived home | `dispatch.returned` then state machine closes |

## Proof run (2026-04-28)

Full log committed at `tools/carla/replay/live-run-2026-04-28.log`. Key
timeline (wall clock):

```
14:18:40  connected to CARLA 127.0.0.1:2000 server-version=0.9.16
14:18:41  reusing current world town=Town01
14:18:45  ego spawned id=211 blueprint=vehicle.tesla.model3
14:18:45  spawned 6 NPCs (requested 6)
14:18:45  service centre target: Location(x=396.6, y=318.4)  (508.6 m from ego)
14:18:45  controller: autopilot
14:18:45  bootstrap-consent granted 5 purposes
14:18:45  state=DRIVING_HOME_AREA
14:19:10  PHM critical at sim t=32.5  (brake_pad_pct=17.9)
14:19:10  state=FAULT_INJECTING -> BOOKING_PENDING -> AWAITING_GRANT
          Booking c17bbdbc opened at GoMechanic Karol Bagh
          Outbound grant 6f0bb02d verified
14:19:10  state=DRIVING_TO_SC
14:19:10  controller: BasicAgent routing to Location(x=396.6, y=318.4)
14:22:04  arrived at SC (distance=7.8 m)         ; 2 m 54 s autonomous drive
14:22:04  state=SERVICING
14:22:10  service complete; return grant a244d820 verified
14:22:10  controller: BasicAgent routing to Location(x=335.5, y=273.7)
14:23:42  arrived home; closing loop             ; 1 m 32 s autonomous drive
14:23:42  state=DONE
```

361 batches of CARLA telemetry were ingested by VSBS over the run
(`HTTP 202 Accepted` on every `POST /v1/sensors/ingest`). Two
CommandGrants minted, one booking opened and closed, parts triage
selected an SC that had brake-pads in stock, and the failing-brake
vehicle reached service and came home without operator intervention.
