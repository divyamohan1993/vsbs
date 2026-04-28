#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# Live CARLA + VSBS demo. Boots the CARLA 0.9.16 server in offscreen-render
# mode at low quality (so it fits inside the 2 GB VRAM budget on the dev
# box), boots the VSBS API in sim profile, then drives the live runner.
#
# Layout:
#   /mnt/experiments/carla-0.9.16/CARLA_0.9.16/CarlaUE4.sh   <- server entry
#   apps/api                                                  <- VSBS API
#   tools/carla/vsbs_carla/scripts/run_demo_live.py           <- bridge
#
# All three children get killed on EXIT.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CARLA_HOME="${CARLA_HOME:-/mnt/experiments/carla-0.9.16}"
CARLA_PORT="${CARLA_PORT:-2000}"
API_PORT="${API_PORT:-8787}"
TOWN="${CARLA_TOWN:-Town01}"
QUALITY="${CARLA_QUALITY:-Low}"
WARMUP="${WARMUP_S:-10}"
FAULT_DURATION="${FAULT_DURATION_S:-30}"
NPC="${NPC_COUNT:-10}"

mkdir -p /tmp/vsbs-live
CARLA_LOG=/tmp/vsbs-live/carla-server.log
API_LOG=/tmp/vsbs-live/vsbs-api.log
DEMO_LOG=/tmp/vsbs-live/demo.log

if [ ! -x "$CARLA_HOME/CarlaUE4.sh" ]; then
  echo "[live] CARLA not found at $CARLA_HOME — extract the tarball first" >&2
  exit 3
fi

CHILDREN=()
cleanup() {
  for pid in "${CHILDREN[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  pkill -f CarlaUE4 2>/dev/null || true
  pkill -f "bun src/server.ts" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[live] starting CARLA server (offscreen, $QUALITY quality, port $CARLA_PORT)"
(
  cd "$CARLA_HOME" && ./CarlaUE4.sh \
    -RenderOffScreen \
    -nosound \
    -quality-level="$QUALITY" \
    -carla-rpc-port="$CARLA_PORT" \
    -benchmark -fps=20 \
    >"$CARLA_LOG" 2>&1
) &
CARLA_PID=$!
CHILDREN+=("$CARLA_PID")

echo "[live] CARLA PID=$CARLA_PID; waiting for RPC port to open"
for i in $(seq 1 90); do
  if python3 -c "
import socket, sys
s = socket.socket(); s.settimeout(0.6)
try:
    s.connect(('127.0.0.1', $CARLA_PORT)); print('open'); sys.exit(0)
except Exception:
    sys.exit(1)
" >/dev/null 2>&1; then
    echo "[live] CARLA ready after ${i}s"
    break
  fi
  if ! kill -0 "$CARLA_PID" 2>/dev/null; then
    echo "[live] CARLA died; tail of log:"
    tail -40 "$CARLA_LOG" >&2
    exit 4
  fi
  sleep 1
done

if ! kill -0 "$CARLA_PID" 2>/dev/null; then
  echo "[live] CARLA process gone"
  tail -60 "$CARLA_LOG" >&2
  exit 4
fi

# Ping CARLA via Python client to confirm it actually responds.
echo "[live] handshaking via python client"
python3 - "$CARLA_PORT" <<'PY'
import sys, carla
port = int(sys.argv[1])
c = carla.Client("127.0.0.1", port)
c.set_timeout(8.0)
print("server-version:", c.get_server_version(), "client-version:", c.get_client_version())
PY

echo "[live] starting VSBS API (port $API_PORT)"
(
  cd "$ROOT/apps/api" && \
  LLM_PROFILE=sim PORT=$API_PORT bun src/server.ts >"$API_LOG" 2>&1
) &
API_PID=$!
CHILDREN+=("$API_PID")

echo "[live] waiting for /readyz"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$API_PORT/readyz" >/dev/null; then
    echo "[live] API ready after ${i}s"
    break
  fi
  sleep 1
done
curl -sf "http://localhost:$API_PORT/readyz" >/dev/null || {
  echo "[live] API never became ready" >&2
  tail -40 "$API_LOG" >&2
  exit 5
}

export CARLA_HOST=127.0.0.1
export CARLA_PORT=$CARLA_PORT
export VSBS_API_BASE="http://localhost:$API_PORT"
export CARLA_PYTHONAPI="$CARLA_HOME/PythonAPI/carla"

echo "[live] running bridge: warm-up=${WARMUP}s, fault-duration=${FAULT_DURATION}s, town=$TOWN, NPCs=$NPC"
cd "$ROOT/tools/carla"
python3 -m vsbs_carla.scripts.run_demo_live \
  --carla-host 127.0.0.1 \
  --carla-port "$CARLA_PORT" \
  --town "$TOWN" \
  --warmup-seconds "$WARMUP" \
  --fault-duration-s "$FAULT_DURATION" \
  --npc-count "$NPC" \
  --vehicle-id "carla-veh-live-$(date +%s)" \
  2>&1 | tee "$DEMO_LOG"

echo "[live] DONE"
