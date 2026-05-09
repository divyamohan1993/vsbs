#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# run_on_vm.sh — boots CARLA 0.9.16, the VSBS API, and the live bridge on
# a GPU-attached GCE VM. Saves chase + drone PNGs into a screenshots dir.
# Streams everything to /tmp/vsbs-vm/ logs. SIGINT/EXIT kills children.
#
# Usage:
#     bash /opt/vsbs/tools/carla/scripts/run_on_vm.sh
#
# Tunables via env:
#     TOWN, WARMUP, FAULT, FAULT_DURATION, NPC, MAX_RUNTIME, SCREENSHOT_DIR

set -euo pipefail

ROOT="${ROOT:-/opt/vsbs}"
CARLA_HOME="${CARLA_HOME:-/opt/carla/CARLA_0.9.16}"
CARLA_PORT="${CARLA_PORT:-2000}"
API_PORT="${API_PORT:-8787}"
TOWN="${TOWN:-Town10HD}"
WARMUP="${WARMUP:-10}"
FAULT="${FAULT:-brake-pad-wear}"
FAULT_DURATION="${FAULT_DURATION:-30}"
NPC="${NPC:-12}"
MAX_RUNTIME="${MAX_RUNTIME:-360}"
QUALITY="${CARLA_QUALITY:-Epic}"
TARGET_FPS="${TARGET_FPS:-60}"

OUT_DIR="${OUT_DIR:-/tmp/vsbs-vm}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-$OUT_DIR/screenshots}"
mkdir -p "$OUT_DIR" "$SCREENSHOT_DIR"

CARLA_LOG="$OUT_DIR/carla.log"
API_LOG="$OUT_DIR/api.log"
DEMO_LOG="$OUT_DIR/demo.log"

CHILDREN=()
cleanup() {
  echo "[run] cleanup"
  for pid in "${CHILDREN[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  done
  pkill -f CarlaUE4 2>/dev/null || true
  pkill -f "bun src/server.ts" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[run] === preflight ==="
date -Iseconds
nvidia-smi 2>&1 | head -12 || { echo "[run][fatal] nvidia-smi failed"; exit 1; }
vulkaninfo --summary 2>&1 | head -25 || echo "[run][warn] vulkaninfo unavailable"
test -x "$CARLA_HOME/CarlaUE4.sh" || { echo "[run][fatal] CARLA missing at $CARLA_HOME"; exit 1; }
which bun >/dev/null  || { echo "[run][fatal] bun missing"; exit 1; }
which pnpm >/dev/null || { echo "[run][fatal] pnpm missing"; exit 1; }
test -d "$ROOT/apps/api" || { echo "[run][fatal] repo missing at $ROOT"; exit 1; }
echo "[run] preflight OK"

echo "[run] === starting CARLA (RenderOffScreen, $QUALITY quality, $TARGET_FPS FPS) ==="
( cd "$CARLA_HOME" && exec ./CarlaUE4.sh \
    -RenderOffScreen \
    -nosound \
    -quality-level="$QUALITY" \
    -carla-rpc-port="$CARLA_PORT" \
    -benchmark -fps="$TARGET_FPS" \
    >"$CARLA_LOG" 2>&1
) &
CARLA_PID=$!
CHILDREN+=("$CARLA_PID")
echo "[run] CARLA PID=$CARLA_PID"

echo "[run] waiting up to 180s for CARLA RPC port :$CARLA_PORT"
for i in $(seq 1 180); do
  if python3 - "$CARLA_PORT" <<'PY' >/dev/null 2>&1
import socket, sys
s = socket.socket(); s.settimeout(0.5)
try: s.connect(("127.0.0.1", int(sys.argv[1]))); sys.exit(0)
except Exception: sys.exit(1)
PY
  then echo "[run] CARLA listening after ${i}s"; break; fi
  if ! kill -0 "$CARLA_PID" 2>/dev/null; then
    echo "[run][fatal] CARLA process died; tail of log:"
    tail -120 "$CARLA_LOG" >&2
    exit 4
  fi
  sleep 1
done
if ! kill -0 "$CARLA_PID" 2>/dev/null; then
  echo "[run][fatal] CARLA gone"; tail -120 "$CARLA_LOG" >&2; exit 4
fi

echo "[run] handshaking via python client"
python3 - "$CARLA_PORT" <<'PY'
import sys, carla
port = int(sys.argv[1])
c = carla.Client("127.0.0.1", port); c.set_timeout(20.0)
print("server-version:", c.get_server_version(), "client-version:", c.get_client_version())
maps = [m.split("/")[-1] for m in c.get_available_maps()]
print("maps:", ", ".join(maps[:12]), ("..." if len(maps) > 12 else ""))
PY

echo "[run] === starting VSBS API (LLM_PROFILE=sim, port $API_PORT) ==="
( cd "$ROOT/apps/api" && \
  LLM_PROFILE=sim PORT="$API_PORT" bun src/server.ts >"$API_LOG" 2>&1 ) &
API_PID=$!
CHILDREN+=("$API_PID")
echo "[run] API PID=$API_PID"

echo "[run] waiting up to 60s for /readyz"
for i in $(seq 1 60); do
  if curl -sf "http://localhost:$API_PORT/readyz" >/dev/null; then
    echo "[run] API ready after ${i}s"; break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[run][fatal] API process died; tail of log:"
    tail -120 "$API_LOG" >&2
    exit 5
  fi
  sleep 1
done
curl -sf "http://localhost:$API_PORT/readyz" >/dev/null || { \
  echo "[run][fatal] API never became ready"; tail -80 "$API_LOG" >&2; exit 5; }

# Web (port 3000). Skipped silently if .next/ wasn't built during bootstrap.
WEB_PORT=3000
WEB_LOG="$OUT_DIR/web.log"
if [ -d "$ROOT/apps/web/.next" ]; then
  echo "[run] === starting Next.js web (port $WEB_PORT) ==="
  ( cd "$ROOT/apps/web" && \
    PORT="$WEB_PORT" VSBS_API_BASE="http://localhost:$API_PORT" \
    pnpm exec next start -p "$WEB_PORT" >"$WEB_LOG" 2>&1 ) &
  WEB_PID=$!
  CHILDREN+=("$WEB_PID")
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:$WEB_PORT/" >/dev/null 2>&1; then
      echo "[run] web up after ${i}s"; break
    fi
    if ! kill -0 "$WEB_PID" 2>/dev/null; then
      echo "[run][warn] web died; tail:"; tail -40 "$WEB_LOG" >&2; break
    fi
    sleep 1
  done
else
  echo "[run][warn] no apps/web/.next — skipping dashboard server"
fi

# Resolve VM external IP via metadata so we can print a clickable URL.
EXT_IP=$(curl -sf -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip \
  2>/dev/null || echo "")
[ -z "$EXT_IP" ] && EXT_IP="<vm-public-ip>"

export CARLA_HOST=127.0.0.1
export CARLA_PORT="$CARLA_PORT"
export VSBS_API_BASE="http://localhost:$API_PORT"
export CARLA_PYTHONAPI="$CARLA_HOME/PythonAPI/carla"

VEHICLE_ID="carla-veh-vm-$(date +%s)"
DASHBOARD_URL="http://$EXT_IP:$WEB_PORT/autonomy/$VEHICLE_ID"
STATUS_URL="http://$EXT_IP:$WEB_PORT/status/$VEHICLE_ID"

cat <<EOF

================================================================================
  LIVE DASHBOARD (open in a browser while the bridge runs):
    Autonomy:  $DASHBOARD_URL
    Status:    $STATUS_URL
  The autonomy view subscribes to SSE from the API; KPI band, sensor
  strip, BEV occupancy, PHM, and command-grant card all update at 10 Hz
  with real CARLA telemetry.
================================================================================

EOF
echo "[run] === bridge: town=$TOWN warmup=${WARMUP}s fault=$FAULT (${FAULT_DURATION}s) NPCs=$NPC max=$MAX_RUNTIME ==="
echo "[run] vehicle-id=$VEHICLE_ID  screenshots=$SCREENSHOT_DIR"
cd "$ROOT/tools/carla"
set +e
python3 -m vsbs_carla.scripts.run_demo_live \
  --carla-host 127.0.0.1 \
  --carla-port "$CARLA_PORT" \
  --town "$TOWN" \
  --warmup-seconds "$WARMUP" \
  --fault "$FAULT" \
  --fault-duration-s "$FAULT_DURATION" \
  --npc-count "$NPC" \
  --max-runtime-s "$MAX_RUNTIME" \
  --vehicle-id "$VEHICLE_ID" \
  --screenshot-dir "$SCREENSHOT_DIR" \
  2>&1 | tee "$DEMO_LOG"
RC=${PIPESTATUS[0]}
set -e

CHASE_N=$(ls "$SCREENSHOT_DIR/chase" 2>/dev/null | wc -l)
DRONE_N=$(ls "$SCREENSHOT_DIR/drone" 2>/dev/null | wc -l)
CHASE_BYTES=$(du -sb "$SCREENSHOT_DIR/chase" 2>/dev/null | awk '{print $1}')
echo "[run] === bridge exit=$RC, chase=$CHASE_N frames ($((${CHASE_BYTES:-0} / 1024 / 1024)) MiB), drone=$DRONE_N frames ==="

# Stitch the chase frames into a 1080p @ 60 FPS HEVC Main10 MP4 (HDR-grade
# gradient retention). NVENC HEVC 10-bit is the primary path on L4. Falls
# back to x265 10-bit (CPU), then x264 8-bit if neither is available.
MP4_OUT="$OUT_DIR/cinematic-1080p-60fps-hdr.mp4"
if [ "$CHASE_N" -gt 30 ]; then
  echo "[run] === stitching $CHASE_N chase frames -> $MP4_OUT ==="
  ENC_OK=0
  # 1) NVENC HEVC Main10 (10-bit, hardware accelerated on Lovelace)
  if ffmpeg -hide_banner -y -framerate "$TARGET_FPS" -pattern_type glob \
       -i "$SCREENSHOT_DIR/chase/frame-*.png" \
       -c:v hevc_nvenc -profile:v main10 -preset p5 -tier high \
       -rc vbr -cq 19 -b:v 0 -maxrate 60M -bufsize 120M \
       -pix_fmt p010le \
       -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
       -movflags +faststart \
       "$MP4_OUT" 2>"$OUT_DIR/ffmpeg.log"; then
    echo "[run] NVENC HEVC 10-bit encode OK: $(du -h "$MP4_OUT" | awk '{print $1}')"
    ENC_OK=1
  else
    echo "[run][warn] NVENC HEVC failed; trying x265 10-bit"
    if ffmpeg -hide_banner -y -framerate "$TARGET_FPS" -pattern_type glob \
         -i "$SCREENSHOT_DIR/chase/frame-*.png" \
         -c:v libx265 -preset slow -crf 18 \
         -pix_fmt yuv420p10le \
         -x265-params "profile=main10:colormatrix=bt709:transfer=bt709:colorprim=bt709" \
         -tag:v hvc1 -movflags +faststart \
         "$MP4_OUT" 2>>"$OUT_DIR/ffmpeg.log"; then
      echo "[run] x265 10-bit encode OK: $(du -h "$MP4_OUT" | awk '{print $1}')"
      ENC_OK=1
    else
      echo "[run][warn] x265 also failed; falling back to x264 8-bit"
      ffmpeg -hide_banner -y -framerate "$TARGET_FPS" -pattern_type glob \
         -i "$SCREENSHOT_DIR/chase/frame-*.png" \
         -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
         -movflags +faststart \
         "$MP4_OUT" 2>>"$OUT_DIR/ffmpeg.log" && ENC_OK=1
      [ "$ENC_OK" = "1" ] && echo "[run] x264 8-bit encode OK: $(du -h "$MP4_OUT" | awk '{print $1}')"
    fi
  fi
  [ "$ENC_OK" != "1" ] && echo "[run][warn] all encoders failed; see $OUT_DIR/ffmpeg.log"
else
  echo "[run][warn] only $CHASE_N chase frames; skipping MP4 stitch"
fi

# Snapshot the live booking + autonomy state for the witness.
echo "[run] === post-run snapshots ==="
{
  echo "## /readyz"
  curl -s "http://localhost:$API_PORT/readyz" | head -c 4000 ; echo
  echo "## /v1/region/me"
  curl -s "http://localhost:$API_PORT/v1/region/me" | head -c 4000 ; echo
  echo "## /metrics (head)"
  curl -s "http://localhost:$API_PORT/metrics" | head -120
} > "$OUT_DIR/post-run.txt" 2>&1 || true

echo "[run] DONE"
exit "$RC"
