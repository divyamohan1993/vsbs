#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# run_chaos_on_vm.sh — boots the VSBS API + web on a CPU-only spot VM
# (e.g. c2-standard-4) and runs the GPU-free chaos scenario driver. The
# dashboard at /autonomy/<vehicleId> renders the full L5 sensor suite
# from the chaos driver's wire-identical LiveTelemetryFrames + 21 events.
# No CARLA, no GPU, no MP4 stitch.

set -euo pipefail

ROOT="${ROOT:-/opt/vsbs}"
API_PORT="${API_PORT:-8787}"
WEB_PORT="${WEB_PORT:-3000}"
SPEED="${SPEED:-1.0}"
LOOP="${LOOP:-1}"

OUT_DIR="${OUT_DIR:-/tmp/vsbs-vm}"
mkdir -p "$OUT_DIR"

API_LOG="$OUT_DIR/api.log"
WEB_LOG="$OUT_DIR/web.log"
CHAOS_LOG="$OUT_DIR/chaos.log"

CHILDREN=()
cleanup() {
  echo "[run] cleanup"
  for pid in "${CHILDREN[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  done
  pkill -f "bun src/server.ts" 2>/dev/null || true
  pkill -f "next start" 2>/dev/null || true
  pkill -f "run_chaos_demo" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[run] === preflight ==="
date -Iseconds
test -d "$ROOT/apps/api" || { echo "[run][fatal] repo missing at $ROOT"; exit 1; }
which bun  >/dev/null || { echo "[run][fatal] bun missing"; exit 1; }
which pnpm >/dev/null || { echo "[run][fatal] pnpm missing"; exit 1; }
echo "[run] preflight OK"

echo "[run] === starting VSBS API (LLM_PROFILE=sim, port $API_PORT) ==="
( cd "$ROOT/apps/api" && \
  LLM_PROFILE=sim PORT="$API_PORT" bun src/server.ts >"$API_LOG" 2>&1 ) &
API_PID=$!; CHILDREN+=("$API_PID")

echo "[run] waiting up to 60s for /readyz"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$API_PORT/readyz" >/dev/null; then
    echo "[run] API ready after ${i}s"; break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[run][fatal] API died"; tail -80 "$API_LOG" >&2; exit 5
  fi
  sleep 1
done

if [ -d "$ROOT/apps/web/.next" ]; then
  echo "[run] === starting Next.js web (port $WEB_PORT) ==="
  ( cd "$ROOT/apps/web" && \
    PORT="$WEB_PORT" VSBS_API_BASE="http://localhost:$API_PORT" \
    pnpm exec next start -p "$WEB_PORT" >"$WEB_LOG" 2>&1 ) &
  WEB_PID=$!; CHILDREN+=("$WEB_PID")
  for i in $(seq 1 30); do
    curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1 && { echo "[run] web up after ${i}s"; break; }
    sleep 1
  done
fi

EXT_IP=$(curl -sf -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
  2>/dev/null || echo "")
[ -z "$EXT_IP" ] && EXT_IP="<vm-public-ip>"

VEHICLE_ID="chaos-vm-$(date +%s)"
DASHBOARD_URL="http://$EXT_IP:$WEB_PORT/autonomy/$VEHICLE_ID"

cat <<EOF

================================================================================
  LIVE DASHBOARD (open in a browser; chaos driver feeds it):
    Autonomy:  $DASHBOARD_URL
  Full L5 telemetry + 21-event scenario, scripted, no CARLA needed.
================================================================================

EOF

echo "[run] === starting chaos driver (booking=$VEHICLE_ID speed=$SPEED loop=$LOOP) ==="
cd "$ROOT/tools/carla"
LOOP_FLAG=""; [ "$LOOP" = "1" ] && LOOP_FLAG="--loop"
set +e
python3 -m vsbs_carla.scripts.run_chaos_demo \
  --base "http://localhost:$API_PORT" \
  --booking "$VEHICLE_ID" \
  --speed "$SPEED" \
  $LOOP_FLAG \
  2>&1 | tee "$CHAOS_LOG"
RC=${PIPESTATUS[0]}
set -e

echo "[run] chaos exit=$RC"
echo "[run] DONE"
exit "$RC"
