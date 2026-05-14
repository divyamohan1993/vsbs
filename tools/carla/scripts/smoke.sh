#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# Smoke test: spin the API in sim mode, run the demo via replay, assert that
# the orchestrator reaches DONE and the booking closes with at least 2 grants.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT="${PORT:-8787}"
TRACE="${TRACE:-$ROOT/tools/carla/replay/town10hd-brake-failure.jsonl}"

echo "[smoke] starting API on port $PORT"
( cd "$ROOT/apps/api" && \
  LLM_PROFILE=sim PORT=$PORT bun src/server.ts >/tmp/vsbs-api-smoke.log 2>&1 ) &
API_PID=$!

cleanup() {
  if kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Wait for /readyz.
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/readyz" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://localhost:$PORT/readyz" >/dev/null; then
  echo "[smoke] FAIL: API never became ready" >&2
  exit 1
fi

echo "[smoke] API ready; running CARLA bridge in replay mode"
cd "$ROOT/tools/carla"
VSBS_API_BASE="http://localhost:$PORT" \
  python3 -m vsbs_carla.scripts.run_demo \
  --replay "$TRACE" \
  --headless \
  --vehicle-id "demo-veh-smoke"

echo "[smoke] PASS"
