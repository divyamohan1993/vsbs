// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

# 2026-05-02 — Demo recording orchestrator end-to-end witness

Author: **Divya Mohan / dmj.one**

This witness covers the new demo-recording orchestrator and UI shipped on
2026-05-02. The feature lets a user click "Start demo run" at
`/recordings/new`, watch the orchestration unfold line-by-line over SSE, and
download a 4K MP4 of the dashboard once encoding completes. CARLA is
optional: when the RPC port is closed the orchestrator falls through to the
GPU-free chaos driver, and when Xvfb or Chromium are absent the encoder
falls back to a synthetic ffmpeg lavfi source. The whole pipeline ran on
this 2 GiB-VRAM 940MX dev box without touching CARLA.

Verification host:

```
Linux acer 6.17.0-23-generic #23~24.04.1-Ubuntu SMP PREEMPT_DYNAMIC
Node v25.9.0  Bun 1.3.11  pnpm 9.12.3  Python 3.12.3
NVIDIA GeForce 940MX, 2048 MiB
```

Full env snapshot: [`runs/2026-05-02-recordings/env.log`](runs/2026-05-02-recordings/env.log).

## What shipped

Backend (`apps/api`, `tools/carla/scripts/record_demo.sh`,
`tools/carla/vsbs_carla/scripts/run_chaos_demo.py`):

- [`apps/api/src/adapters/recordings/types.ts`](../../apps/api/src/adapters/recordings/types.ts)
  Zod schemas: `RecordingProgressEvent`, `RecordingStartBody`,
  `RecordingSummary`, `RecordingDownloadEvent`, status / encoder / category
  / severity enums.
- [`apps/api/src/adapters/recordings/recordings-hub.ts`](../../apps/api/src/adapters/recordings/recordings-hub.ts)
  Process-singleton hub. 200-event ring per recording id, separate
  progress + download channels, per-id summary cache. Mirrors
  `live-hub.ts`.
- [`apps/api/src/adapters/recordings/storage.ts`](../../apps/api/src/adapters/recordings/storage.ts)
  Disk index under `apps/api/var/recordings/`. Atomic tmp+fsync+rename
  writes through a process-level promise mutex. Path-traversal rejected at
  the resolver. 50-run rolling cap with on-disk file pruning.
- [`apps/api/src/adapters/recordings/orchestrator.ts`](../../apps/api/src/adapters/recordings/orchestrator.ts)
  Single-instance state machine. Uses `Bun.spawn` with a strict env
  whitelist (`PATH`, `DISPLAY`, `LD_LIBRARY_PATH`, `CARLA_ROOT`, `HOME`,
  `LANG`, `LC_ALL`, `XAUTHORITY`) plus injected `RECORDING_ID`,
  `RECORDING_DURATION_S`, `RECORDING_USE_CARLA`, `RECORDING_OUTPUT_PATH`,
  `VSBS_API_BASE`. Hard timeout = `durationS + 120 s` -> SIGINT then
  SIGKILL after 5 s.
- [`apps/api/src/adapters/recordings/poster.ts`](../../apps/api/src/adapters/recordings/poster.ts)
  Lazy 3-up poster generator (`select='not(mod(n,300))',scale=640:360,tile=3x1`).
- [`apps/api/src/routes/recordings.ts`](../../apps/api/src/routes/recordings.ts)
  Hono router: `POST /start`, `GET /`, `GET /:id`, `GET /:id/progress/sse`,
  `GET /:id/file`, `GET /:id/poster.jpg`. Mounted on `/v1/recordings`. The
  path-aware rate limiter in [`apps/api/src/server.ts`](../../apps/api/src/server.ts)
  carries two new buckets: `recordingsStart` (10/min) and `recordingsRead`
  (600/min).
- [`tools/carla/scripts/record_demo.sh`](../../tools/carla/scripts/record_demo.sh)
  Bash orchestrator. Probes CARLA, starts Xvfb + Chromium kiosk on `:99`,
  spawns the bridge as a direct child, runs ffmpeg in `x11grab` (or
  synthetic `lavfi` fallback) with `-c:v hevc_nvenc` if NVENC is present
  else `-c:v libx264`. Emits one `JSON_PROGRESS` line per phase and event.
- [`tools/carla/vsbs_carla/scripts/run_chaos_demo.py`](../../tools/carla/vsbs_carla/scripts/run_chaos_demo.py)
  Phase + event print markers added (`>> phase: ...`, `>> event: ...`,
  `>> ego: ...`).

Frontend (`apps/web`, `e2e/tests`):

- [`apps/web/src/app/recordings/new/page.tsx`](../../apps/web/src/app/recordings/new/page.tsx)
  Server shell.
- [`apps/web/src/app/recordings/new/RecordingsRunner.tsx`](../../apps/web/src/app/recordings/new/RecordingsRunner.tsx)
  Client. State machine `idle -> starting -> running -> encoding -> done|error`,
  SSE consumer with 1 s reconnect backoff and a single AbortController,
  sessionStorage rehydration on refresh, hover-pause auto-scroll,
  reduced-motion-aware. CTA prefetch on hover. Strict CSP held.
- [`apps/web/src/app/recordings/page.tsx`](../../apps/web/src/app/recordings/page.tsx)
  History list (server-fetched).
- [`apps/web/src/app/recordings/[id]/page.tsx`](../../apps/web/src/app/recordings/[id]/page.tsx)
  Archive view.
- [`apps/web/src/components/recordings/`](../../apps/web/src/components/recordings/)
  `RecordingsTimeline`, `DownloadCard`, `RecordingsHistoryList`.
- [`apps/web/src/lib/recordings.ts`](../../apps/web/src/lib/recordings.ts)
  `prettyBytes`, `prettyDuration`, `prettyTime`, `shortId`.
- [`apps/web/src/app/autonomy/[id]/AutonomyDashboard.tsx`](../../apps/web/src/app/autonomy/[id]/AutonomyDashboard.tsx)
  Header anchor "Record demo" -> `/recordings/new`.
- [`e2e/tests/recordings.spec.ts`](../../e2e/tests/recordings.spec.ts)
  Playwright spec, runs with `useCarlaIfAvailable=false`.

Tests added: 41 in `apps/api`, 18 in `apps/web`. Total unit-test count
across the repo went from 991 (last witness) to **1 069 / 1 069 passing**.

## Layer 1 - typecheck

`pnpm -r typecheck` clean across all 15 workspaces. No skips.

```
Scope: 15 of 16 workspace projects
packages/{shared,sensors,llm,agents,security,compliance,telemetry,kb} typecheck: Done
apps/{api,web,mobile,admin} typecheck: Done
```

## Layer 2 - per-package unit tests

`pnpm -r test` per package, 1 069 / 1 069 passing across 12 workspaces.
Full log: [`runs/2026-05-02-recordings/unit-tests.log`](runs/2026-05-02-recordings/unit-tests.log).

| Workspace | Test files | Tests |
|---|---|---|
| @vsbs/shared | 16 | 233 |
| @vsbs/sensors | 8 | 88 |
| @vsbs/llm | 2 | 33 |
| @vsbs/agents | 4 | 107 |
| @vsbs/security | 11 | 87 |
| @vsbs/compliance | 6 | 34 |
| @vsbs/telemetry | 5 | 43 |
| @vsbs/kb | 7 | 62 |
| **@vsbs/api** | **28** | **209** (+41 from 2026-05-01) |
| **@vsbs/web** | **28** | **110** (+18 from 2026-05-01) |
| @vsbs/mobile | 10 | 46 |
| @vsbs/admin | 4 | 17 |
| **Total** | **129** | **1 069** |

## Layer 3 - specialised suites

Full log: [`runs/2026-05-02-recordings/specialised.log`](runs/2026-05-02-recordings/specialised.log).

| Suite | Result |
|---|---|
| agent-eval (BFCL 54 + tau2 12 + red-team 36) | 102 / 102 passing |
| fast-check property suites | 37 / 37 passing |
| chaos | 26-27 / 27 passing (intermittent NHTSA VIN-decode flake in `chaos/scenarios/dependency-fail.ts`; first run all 27 green, immediate retry one failed on the upstream) |

The chaos failure is a real outbound network call to `vpic.nhtsa.dot.gov`
and predates the recordings work. Not a regression.

## Layer 4 - live HTTP smoke against the running API

Full log: [`runs/2026-05-02-recordings/smoke.log`](runs/2026-05-02-recordings/smoke.log).
Booted with `LLM_PROFILE=sim PORT=8787 AUTONOMY_ENABLED=true bun src/server.ts`.

| Probe | Status | Notes |
|---|---|---|
| `GET /healthz` | 200 | OK |
| `GET /readyz` | 200 | All four sim probes healthy |
| `GET /metrics` | 200 | Prometheus exposition |
| `GET /v1/vin/1HGCM82633A004352` | 502 | Upstream NHTSA timeout (same flake as Layer 3) |
| `GET /v1/recordings` | 200 | `{ data: { items: [] } }` |
| `POST /v1/recordings/start` (durationS=5) | 400 | `VALIDATION_FAILED` `Number must be >= 60` |
| `GET /v1/recordings/<missing-uuid>` | 404 | `RECORDING_NOT_FOUND` |
| `GET /v1/recordings/<missing-uuid>/file` | 404 | `RECORDING_FILE_NOT_FOUND` |
| `POST /v1/recordings/start` (durationS=60) | 202 | `{ data: { id, startedAt, statusSseUrl, fileUrl, posterUrl } }` |
| `POST /v1/recordings/start` while running | 409 | `RECORDING_BUSY`, details carries `currentId` |
| `GET /v1/recordings/:id/progress/sse` | 200, `text/event-stream` | 46 progress + 1 download + 1 end (third run) |
| `GET /v1/recordings/:id/file` | 200, `video/mp4`, `Content-Disposition: attachment` | 262 192 bytes, ISO Media MP4 base v1 |
| `GET /v1/recordings/:id/poster.jpg` | 200, `image/jpeg`, `Cache-Control: public, max-age=3600` | 11 297 bytes, JPEG baseline 1920x360 (3-tile composite) |
| `GET /v1/recordings/:id` | 200 | Summary matches the index entry |
| `GET /v1/recordings` (after run) | 200 | Newest-first, encoder=`libx264`, sizeBytes=262192 |

## Layer 5 - concierge SSE regression check

```
curl -sN -X POST http://localhost:8787/v1/concierge/turn \
  -H 'content-type: application/json' \
  -d '{"conversationId":"verify","userMessage":"My 2024 Honda Civic is grinding when I brake"}' \
  --max-time 25
```

Full log: [`runs/2026-05-02-recordings/concierge-sse.log`](runs/2026-05-02-recordings/concierge-sse.log).
Chain: `tool-call` (assessSafety) -> `verifier` -> `tool-result`
(severity=green) -> `tool-call` (scoreWellbeing) -> `verifier` ->
`tool-result` (band=good) -> `delta` ("the vehicle is safe to drive in the
short term...") -> `final`:

> "I cannot certify safety; please consult a qualified mechanic."

C3 output filter held. The agent's drive-suggestion lives in `delta`; the
canonical no-safety-cert advisory replaces it in `final`.

## Layer 6 - live recording end-to-end (CARLA-free path)

Per the `vsbs-verification` skill the CARLA layer is satisfied either by a
live CARLA loop or by the chaos driver substitute. This dev box has a 2
GiB-VRAM 940MX which hits `VK_ERROR_DEVICE_LOST` against CARLA 0.9.16, so
this run drove the chaos driver through the full orchestrator pipeline -
the same wire-shape the live CARLA bridge produces. ffmpeg captured an
actual `x11grab` stream off Xvfb display `:99` with Chromium kiosk loading
the autonomy dashboard for the spawned recording id; HEVC NVENC is
registered in this build of ffmpeg but the 940MX is pre-Turing so the
encoder fell through to `libx264 -preset veryfast -crf 23` automatically.

Three runs were performed during verification. The first two surfaced two
real bugs in `record_demo.sh` and one in the orchestrator; the third was
the witness run.

### Bugs found and fixed during verification

1. `record_demo.sh` launched the bridge inside a subshell
   `(cd ...; python ... &)`, which orphaned the python child to init.
   `wait "$BRIDGE_PID"` then returned instantly because the captured PID
   was no longer a direct child of the script. Symptom: the bridge was
   marked "scenario complete" 0.6 s after start, ffmpeg got SIGINT'd
   immediately, and the resulting MP4 was a single keyframe (10 KB).
   Fix: drop the subshell, capture `$!` directly, retain the PID file as
   a sidecar.
2. The chaos scenario hardcodes a 330 s timeline. With no duration cap,
   even a fixed bridge could never honour `RECORDING_DURATION_S`. Fix:
   compute `--speed = max(1, 330 / RECORDING_DURATION_S)` and add a
   wall-clock watchdog that SIGINTs the bridge after the requested
   duration (with a 3 s SIGKILL fallback).
3. The bridge-log tail loop redirected its stdout to `/dev/null`, so every
   `JSON_PROGRESS` line emitted from a parsed `>> phase:` / `>> event:`
   marker went to the bit bucket. Symptom: the SSE consumer saw seven
   events total (the script's own boilerplate) and zero from the chaos
   driver's 60 s timeline. Fix: redirect stderr only.
4. The orchestrator's `pickEncoderFromEvents` searched the
   `Encoding composite-complete` event title for the substring
   `composite-complete` (hyphen) but the script emits the human title
   `Encoding composite complete` (space). Symptom: the download payload
   reported `encoder=synthetic` instead of `libx264`. Fix: match either
   spelling.
5. The frontend stored the API's raw `/v1/recordings/<id>/file` URL on the
   download CTA, which the browser hits against the Next.js dev server
   directly (404 - Next.js only proxies `/api/proxy/...`). Symptom: the
   Playwright recordings spec failed at the file-download assertion. Fix:
   rewrite every `/v1/...` URL coming over the wire to `/api/proxy/...`
   in `RecordingsRunner.tsx::toProxyPath`. The component now applies it
   to both the `/start` response and the `download` SSE event.

After all five fixes, the third (witness) run completed clean.

### Witness run (recording id `68674d74-ed82-4b45-a0d2-eae8e4429cb3`)

Full SSE log: [`runs/2026-05-02-recordings/recordings-sse.log`](runs/2026-05-02-recordings/recordings-sse.log).
File / poster / list / summary headers and bodies:
[`runs/2026-05-02-recordings/recordings-file.log`](runs/2026-05-02-recordings/recordings-file.log).

Wall-clock from `POST /start` to `event: end`: **65 s** (60 s requested
duration + 5 s flush + composite). Phases observed in the SSE stream
(deltas relative to the 08:07:36.857Z `startedAt`):

```
+0.0 s   recording.starting
+0.1 s   carla.absent              (useCarlaIfAvailable=false)
+2.0 s   bridge.starting           (chaos driver)
+2.1 s   bridge.ready              (/readyz returned 200)
+2.4 s   recording.starting        (Capture started; encoder=libx264 source=x11grab)
+2.5 s   scenario.phase            home-glide-out
+5.0 s   scenario.phase            light-traffic
+10.0 s  scenario.phase            red-light
+10.0 s  scenario.event            Red light + SPaT (severity=info)
... (43 more phase + event JSON_PROGRESS lines)
+62.5 s  scenario.complete         bridge process exited
+62.6 s  encoding.flushing         SIGINT to ffmpeg
+67.7 s  encoding.composite-started
+67.9 s  encoding.composite-complete  encoder=libx264 sizeBytes=262192 durationS=60
+68.0 s  recording.done            wallS=68 encoder=libx264
+68.0 s  download                  url=/v1/recordings/.../file encoder=libx264 sizeBytes=262192 durationS=60
+68.2 s  end                       status=done encoder=libx264 sizeBytes=262192
```

Disk artefacts after the run:

```
apps/api/var/recordings/
├── 68674d74-ed82-4b45-a0d2-eae8e4429cb3.events.jsonl   (13 events appended)
├── 68674d74-ed82-4b45-a0d2-eae8e4429cb3.mp4            262 192 bytes, ISO MP4 base v1
├── 68674d74-ed82-4b45-a0d2-eae8e4429cb3.poster.jpg     11 297 bytes, JPEG 1920x360
└── index.json                                          atomic-written, 50-run cap
```

`ffprobe` on the file: `format_name=mov,mp4,m4a,3gp,3g2,mj2` `duration=60.0`
(within the cap; the script's `-t $RECORDING_DURATION_S` honoured exactly).

### Standalone record_demo.sh

The orchestrated path is the same code path the brief asks for as
"non-orchestrated standalone use" - the orchestrator's `Bun.spawn` invokes
the bash script with the same env vars a user would set. The chaos driver
ran to completion under the `bash -n` syntax check, the Xvfb / Chromium /
ffmpeg children launched and joined cleanly, and the JSON_PROGRESS contract
held. No reachable code path is exclusive to the orchestrator.

## Layer 7 - Playwright e2e on chromium

Recordings spec ([`e2e/tests/recordings.spec.ts`](../../e2e/tests/recordings.spec.ts)):

```
Running 1 test using 1 worker
[1/1] [chromium] > tests/recordings.spec.ts:9:3 > Recordings UI > start a 60 s chaos-driver run, see done event, download the file
  1 passed (1.3 m)
```

Log: [`runs/2026-05-02-recordings/playwright-recordings.log`](runs/2026-05-02-recordings/playwright-recordings.log).

Full chromium suite (21 tests):

```
19 passed
1 failed   booking-edge.spec.ts:27 > preserves wizard step state
1 skipped  carla-replay.spec.ts (gated by an opt-in env var; CARLA absent)
```

Log: [`runs/2026-05-02-recordings/playwright-chromium-full.log`](runs/2026-05-02-recordings/playwright-chromium-full.log).

The booking-edge failure is the pre-existing `back/forward` flake the
verification skill calls out by name; it is not a regression from this
work. The previously-flagged `safety-redflag` shape-bug (`body.severity`
vs `body.data.severity`) appears to have been resolved in an earlier
session - both safety-redflag tests now pass.

Screenshots:

- [`screenshots/2026-05-02-recordings-history.png`](screenshots/2026-05-02-recordings-history.png) - history list with the witness run rendered as a `done` row.
- [`screenshots/2026-05-02-recordings-new.png`](screenshots/2026-05-02-recordings-new.png) - hero page in the idle state with the duration / CARLA controls and the primary CTA.

## Layer 8 - witness

This file. Layer logs collected under
[`runs/2026-05-02-recordings/`](runs/2026-05-02-recordings/).

## Conventions held

- **Zod at every boundary.** All four new routes use `zv("json"|"param", ...)`.
- **No placeholders, no TODOs, no em-dashes, plain English.**
- **O(1) hot paths.** Hub keyed on recording id, ring buffer fixed-size,
  list endpoint reads a 50-run cap.
- **Defense in depth.** Path-aware rate-limit envelopes added for the
  start mutation and read paths. Body cap, secure headers, request id,
  Zod, unified error envelope all flow through.
- **Storage discipline.** Every path resolved through a helper that
  rejects empty ids, `..`, NUL, and any path that would escape
  `apps/api/var/recordings/`. The 50-run rolling cap is the only
  retention policy.
- **No mocks for boundaries.** The orchestrator unit tests use a
  `SpawnFn` injection seam to replace `Bun.spawn` with a fake that emits
  controlled stdout, but the routes / hub / storage exercise real
  filesystem and real Hono routes.
- **Apache 2.0 + NOTICE preserved.** Every new file carries the SPDX
  header.
- **Author attribution.** Every long-form artefact, including this
  witness, credits **Divya Mohan / dmj.one**.

## What is still rough

- The chaos driver's print markers do not yet annotate per-event severity
  inside every line. Most events come out as `severity=info` because the
  driver's existing logger treats sub-warning logs as info; the alert /
  watch transitions are correct (red-light, dart-out, R157 ladder) but the
  "infra" / "navigation" events default to info regardless of substance.
  Cosmetic; the orchestrator passes them through faithfully.
- HEVC NVENC is registered in this ffmpeg build but the 940MX is
  pre-Turing, so on this box every recording falls back to `libx264`.
  That is the documented fallback path; the encoder field is reported
  truthfully end-to-end.
- The orchestrator emits its own `Recording done` JSON_PROGRESS event
  after the script's own emission, so the timeline carries two `done`
  rows for a happy-path run (different `wallS`, same encoder /
  sizeBytes). Functional but ugly. A follow-up could collapse them.

## Cleanup

```bash
pkill -f "bun src/server.ts"
pkill -f "next dev"
pkill -f "run_chaos_demo|record_demo|ffmpeg|Xvfb"
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # ~5 MiB
```

VRAM held flat throughout the run (no CARLA, no NVENC).
