---
name: vsbs-verification
description: Use this skill any time the user asks to test, verify, run, smoke-test, end-to-end check, or "is everything working" the VSBS system. Unit tests alone are not enough. This skill pins the full verification cadence: per-package unit tests, specialised suites, live API smoke against real schemas, headless live CARLA on whatever GPU is available, Playwright e2e, concierge SSE, and a written witness report. Triggers: "test", "tests", "run tests", "verify", "verification", "smoke", "smoke test", "end-to-end", "e2e", "is it working", "did it pass", "CARLA", "live demo", "full stack", "everything green".
---

# VSBS verification — full ladder, every time

VSBS is a safety-claimed system. "Tests pass" alone is not evidence the
product works; the unit tests are necessary but not sufficient. Every
verification request runs the full ladder below and produces a written
witness under `docs/verification/`. Anything less and the user has to ask
twice. Don't make the user ask twice.

## Setup

```bash
VERIFY_DIR=/tmp/vsbs-verify-$(date +%s)
mkdir -p "$VERIFY_DIR"
echo "VERIFY_DIR=$VERIFY_DIR" > /tmp/vsbs-verify-current
{ uname -a; node --version; bun --version; pnpm --version; python3 --version;
  nvidia-smi --query-gpu=name,memory.total --format=csv 2>/dev/null; } > "$VERIFY_DIR/env.log"
```

## Layer 1 — typecheck across all 15 workspaces

```bash
pnpm -r typecheck   # short-circuits on first failure; expect clean across 15
```

## Layer 2 — per-package unit tests

`pnpm -r test` short-circuits on the first failing workspace and hides the
rest. Always run per-package so you see the full picture:

```bash
for pkg in shared sensors llm agents security compliance telemetry kb; do
  echo "=== @vsbs/$pkg ==="
  pnpm --filter @vsbs/$pkg test 2>&1 | grep -E "Tests +[0-9]|Test Files|FAIL" | tail -3
done
for app in api web mobile admin; do
  echo "=== @vsbs/$app ==="
  pnpm --filter @vsbs/$app test 2>&1 | grep -E "Tests +[0-9]|Test Files|Tests:|Test Suites:|FAIL" | tail -3
done
```

Expected baseline as of the verification on file: **1 003 unit tests passing
across 12 workspaces**, zero failures, zero skips.

## Layer 3 — specialised suites

These are not run by the default `test` script:

```bash
pnpm test:agent-eval   # 102 cases — BFCL function-calling 54 + tau2 12 + red-team 36
pnpm test:property     # 37 fast-check properties
pnpm test:chaos        # 27 chaos scenarios
```

## Layer 4 — live HTTP smoke against the running API

`pnpm -r test` does not exercise live HTTP. Boot the API in sim mode with
`AUTONOMY_ENABLED=true` so the new heartbeat / offline-envelope /
dual-control routes are reachable. Many routes are consent-gated; grant the
required purposes first. Real schemas have evolved; do not paste smoke
payloads from old docs without re-checking the route handler.

```bash
( cd apps/api && LLM_PROFILE=sim PORT=8787 AUTONOMY_ENABLED=true bun src/server.ts \
    > "$VERIFY_DIR/api.log" 2>&1 ) &
until curl -sf http://localhost:8787/readyz >/dev/null; do sleep 1; done

OWNER=demo-owner
for purpose in service-fulfilment diagnostic-telemetry autonomy-delegation; do
  curl -s -X POST -H 'content-type: application/json' -H "x-vsbs-owner: $OWNER" \
    -d "{\"purpose\":\"$purpose\",\"version\":\"1.0.0\",\"source\":\"web\",\"locale\":\"en\",\"shownText\":\"smoke consent grant\"}" \
    http://localhost:8787/v1/me/consent/grant
done
```

Probe at minimum: health/ready/metrics, llm config, real NHTSA VIN decode
(use `1HGCM82633A004352`), safety green + red, wellbeing (10-axis),
OTP demo round-trip, capability v2 (Mercedes IPP shape), takeover (rungs are
`informational | warning | urgent | emergency-mrm`), heartbeat /
offline-envelope / dual-control on a non-existent grant id (expect 404 / 400),
sensor ingest with a real sample (expect 202 with origin summary),
phm/actions, dispatch shortlist, kb hybrid search, payment order + intent,
404 envelope, security headers. **32 probes is the floor.**

The full reference smoke script is at
[`docs/verification/smoke-expanded.log`](../../docs/verification/smoke-expanded.log)
— treat it as the spec.

## Layer 5 — concierge SSE turn (the headline LLM-safety demo)

```bash
curl -sN -X POST http://localhost:8787/v1/concierge/turn \
  -H 'content-type: application/json' \
  -d '{"conversationId":"verify","userMessage":"My 2024 Honda Civic is grinding when I brake"}' \
  --max-time 25 | tee "$VERIFY_DIR/concierge-sse.log"
```

Expected: full `tool-call → verifier → tool-result → delta → final → end`
chain. The `delta` will contain a drive-suggestion ("the vehicle is safe to
drive..."). The `final` MUST contain the canonical no-safety-cert advisory
("I cannot certify safety; please consult a qualified mechanic."). If the
final still contains the LLM's drive-suggestion, the C3 output filter has
regressed. Do not pass without it.

## Layer 6 — live CARLA, headless, even on a 2 GB GPU

CARLA 0.9.16 is pre-installed at `/mnt/experiments/carla-0.9.16`. The
default 60 s client timeout is not enough on a low-VRAM box; pre-load the
smallest map with a long timeout, then let the bridge reuse the loaded world.

```bash
# 1. Boot CARLA truly headless
/mnt/experiments/carla-0.9.16/CarlaUE4.sh \
  -RenderOffScreen -opengl -nosound \
  -quality-level=Low -ResX=240 -ResY=180 \
  -carla-rpc-port=2000 -benchmark -fps=10 \
  > "$VERIFY_DIR/carla-server.log" 2>&1 &
# Wait for RPC port.
for i in $(seq 1 60); do
  python3 -c "import socket; s=socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1',2000))" 2>/dev/null && break
  sleep 1
done

# 2. Pre-load the smallest available map under no-render mode.
( cd tools/carla && source .venv/bin/activate && python3 - <<'PY'
import carla
c = carla.Client("127.0.0.1", 2000); c.set_timeout(600.0)
w = c.load_world("Town03_Opt")
s = w.get_settings(); s.no_rendering_mode = True; w.apply_settings(s)
PY
)

# 3. Run the bridge against the warm world.
( cd tools/carla && source .venv/bin/activate && \
  CARLA_HOST=127.0.0.1 CARLA_PORT=2000 VSBS_API_BASE=http://localhost:8787 \
  python3 -m vsbs_carla.scripts.run_demo_live \
    --carla-host 127.0.0.1 --carla-port 2000 \
    --town Town03_Opt --warmup-seconds 5 --fault-duration-s 10 --npc-count 4 \
    --no-render --vehicle-id "verify-$(date +%s)" \
    2>&1 | tee "$VERIFY_DIR/carla-live.log" )
```

Two acceptable terminal states:
- `state=DONE` (happy-path loop: booking opened → grants minted → service →
  return → home), or
- `state=HALTED_AWAITING_TOW` (graceful degradation: PHM predicted a fault,
  booking opened, drive started, fault accelerated en route, autonomy halted
  and a tow was escalated via `/v1/dispatch/<id>/halt-for-tow`).

If a third state appears without an obvious physics reason, investigate.

GPU usage MUST stay near 5 MiB throughout the run. If VRAM climbs, the
`-RenderOffScreen` + `no_rendering_mode` path has regressed — `-nullrhi`
will segfault on 0.9.16, do not use it.

Replay branch (does not need a CARLA binary):

```bash
( cd tools/carla && source .venv/bin/activate && \
  VSBS_API_BASE=http://localhost:8787 \
  python3 -m vsbs_carla.scripts.run_demo \
    --replay replay/town10hd-brake-failure.jsonl \
    --headless --vehicle-id "verify-replay" \
    2>&1 | tee "$VERIFY_DIR/carla-replay.log" )
```

Expected: 22 HTTP calls all 2xx, full state-machine traversal to `DONE`,
2 grants minted (outbound + return).

## Layer 7 — Playwright Chromium e2e + a tour script

```bash
( cd apps/web && NEXT_PUBLIC_API_BASE=http://localhost:8787 pnpm dev \
    > "$VERIFY_DIR/web-dev.log" 2>&1 ) &
until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done

pnpm exec playwright install chromium 2>/dev/null
( cd e2e && pnpm exec playwright test --project=chromium --reporter=line \
    2>&1 | tee "$VERIFY_DIR/playwright-chromium.log" )
```

Expected: 17/20 passing as of the witness on file. The 2 known failures are
pre-existing test bugs:
1. `safety-redflag.spec.ts:13` reads `body.severity` instead of `body.data.severity`.
2. `booking-edge.spec.ts:27` browser back/forward state is flaky.

These are NOT regressions from the safety / sensors / autonomy / agents /
platform workstreams. If new failures appear, treat them as real.

A Playwright tour that captures the autonomy dashboard with live tiles is at
[`docs/verification/screenshots/`](../../docs/verification/screenshots/).

## Layer 8 — write the witness

Every verification run produces `docs/verification/REPORT.md` (overwrite) and
copies the layer logs into `docs/verification/`. The README index at
`docs/verification/README.md` lists every artefact.

## Layer 9 — clean up

```bash
pkill -f CarlaUE4 2>/dev/null
pkill -f "bun src/server.ts" 2>/dev/null
pkill -f "next dev" 2>/dev/null
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # back to ~5 MiB
```

## Why the ladder

Each layer catches a class of failure the layer below cannot:

| Layer | Catches |
|---|---|
| typecheck | type / contract drift |
| unit tests | logic regression in pure functions |
| specialised suites | agent eval drift, properties violated, chaos resilience |
| live HTTP smoke | route wiring, schema drift, consent gates, status envelope |
| concierge SSE | LLM safety fence working under real adversarial input |
| CARLA live | PHM + autonomy + dispatch composing under real physics; SOTIF tow-escalation |
| CARLA replay | the same plumbing on a host without a GPU |
| Playwright | UI rendering, CSP, accessibility, manual booking flow |
| witness report | non-repudiable evidence for the next reviewer |

Skipping a layer means the user has to discover the gap themselves. Don't.

## Bound checks

- Linux is the primary verification host. macOS works for unit tests but
  CARLA 0.9.16 wheels target manylinux only.
- Node 22+, Bun 1.2+, pnpm 9+, Python 3.10+ (3.12 wheel exists).
- For the 2 GB GPU path, the warmup step is mandatory. The bridge's default
  60 s client timeout is too short.
- Sim mode (LLM_PROFILE=sim) is the verification profile; demo / prod need
  real API keys and are not a verification target.

## When NOT to run the full ladder

- The user asked a focused question about one file. Run the one relevant
  test, not the whole suite.
- A teammate already produced a report in this session. Cite it; don't
  re-run unless something has changed.
- The user explicitly says "skip CARLA" or "no live API". Honour the scope.

Default behaviour, otherwise: full ladder, written witness, then report.
