#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# VSBS demo recorder. Boots a virtual frame-buffer, points a Chromium kiosk
# at the autonomy dashboard, drives the chaos / live CARLA bridge against
# the API, and captures the resulting screen as an mp4. Emits one
# JSON_PROGRESS line per phase / event so the API orchestrator can pipe
# realtime status into the SSE feed.
#
# Required env (injected by the orchestrator; can also be run standalone):
#   RECORDING_ID            uuid of the recording
#   RECORDING_DURATION_S    seconds to record (60..1800)
#   RECORDING_USE_CARLA     "true" | "false" — try real CARLA first
#   RECORDING_OUTPUT_PATH   absolute path to the final mp4
#   VSBS_API_BASE           http://host:port for /readyz + ingest
#
# Tolerant of missing tooling: if Xvfb / Chromium / NVENC / CARLA are
# absent we fall back at each step (synthetic colour source, libx264,
# chaos driver) so the orchestrator always produces a playable mp4.

set -euo pipefail

: "${RECORDING_ID:?RECORDING_ID is required}"
: "${RECORDING_DURATION_S:?RECORDING_DURATION_S is required}"
: "${RECORDING_USE_CARLA:?RECORDING_USE_CARLA is required}"
: "${RECORDING_OUTPUT_PATH:?RECORDING_OUTPUT_PATH is required}"
: "${VSBS_API_BASE:=http://localhost:8787}"

WALL_START_S="$(date +%s)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORK_DIR="$(mktemp -d -t vsbs-rec-XXXXXX)"
DASHBOARD_MP4="${RECORDING_OUTPUT_PATH}.dashboard.mp4"
BRIDGE_LOG="$WORK_DIR/bridge.log"
FFMPEG_LOG="$WORK_DIR/ffmpeg.log"
CHROMIUM_LOG="$WORK_DIR/chromium.log"
XVFB_LOG="$WORK_DIR/xvfb.log"
CARLA_PROBE_LOG="$WORK_DIR/carla-probe.log"

XVFB_PID=""
CHROMIUM_PID=""
FFMPEG_PID=""
BRIDGE_PID=""
CARLA_PID=""
WATCHDOG_PID=""
TAIL_PID=""

now_iso() {
  if date --version >/dev/null 2>&1; then
    date -u +"%Y-%m-%dT%H:%M:%S.%3NZ"
  else
    # macOS / BusyBox fallback — millisecond precision via python
    python3 - <<'PY'
from datetime import datetime, timezone
n = datetime.now(timezone.utc)
print(n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z")
PY
  fi
}

# Escape a string for JSON. Replaces \, ", control chars.
json_escape() {
  python3 - "$1" <<'PY'
import json, sys
print(json.dumps(sys.argv[1]), end="")
PY
}

progress() {
  # progress <category> <severity> <title> [detail]
  local cat="$1" sev="$2" title="$3" detail="${4-}"
  local title_j detail_j
  title_j="$(json_escape "$title")"
  if [ -n "$detail" ]; then
    detail_j="$(json_escape "$detail")"
    printf 'JSON_PROGRESS {"ts":"%s","category":"%s","severity":"%s","title":%s,"detail":%s}\n' \
      "$(now_iso)" "$cat" "$sev" "$title_j" "$detail_j"
  else
    printf 'JSON_PROGRESS {"ts":"%s","category":"%s","severity":"%s","title":%s}\n' \
      "$(now_iso)" "$cat" "$sev" "$title_j"
  fi
}

progress_data() {
  # progress_data <category> <severity> <title> <detail-or-empty> <data-json>
  local cat="$1" sev="$2" title="$3" detail="$4" data="$5"
  local title_j
  title_j="$(json_escape "$title")"
  if [ -n "$detail" ]; then
    local detail_j
    detail_j="$(json_escape "$detail")"
    printf 'JSON_PROGRESS {"ts":"%s","category":"%s","severity":"%s","title":%s,"detail":%s,"data":%s}\n' \
      "$(now_iso)" "$cat" "$sev" "$title_j" "$detail_j" "$data"
  else
    printf 'JSON_PROGRESS {"ts":"%s","category":"%s","severity":"%s","title":%s,"data":%s}\n' \
      "$(now_iso)" "$cat" "$sev" "$title_j" "$data"
  fi
}

cleanup() {
  local pids=("$WATCHDOG_PID" "$TAIL_PID" "$FFMPEG_PID" "$CHROMIUM_PID" "$BRIDGE_PID" "$CARLA_PID" "$XVFB_PID")
  for pid in "${pids[@]}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  sleep 0.3 || true
  for pid in "${pids[@]}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

progress recording info "Recording starting" "id=$RECORDING_ID duration=${RECORDING_DURATION_S}s carla=$RECORDING_USE_CARLA"

# ---------------------------------------------------------------------------
# 1. CARLA detection
# ---------------------------------------------------------------------------
USE_CARLA="false"
if [ "$RECORDING_USE_CARLA" = "true" ]; then
  if python3 -c "
import socket, sys
s = socket.socket(); s.settimeout(0.4)
try:
    s.connect(('127.0.0.1', 2000)); sys.exit(0)
except Exception:
    sys.exit(1)
" >"$CARLA_PROBE_LOG" 2>&1; then
    USE_CARLA="true"
    progress carla info "CARLA detected" "RPC port 2000 is open on 127.0.0.1"
  else
    progress carla info "CARLA absent" "RPC port 2000 closed; falling back to chaos driver"
  fi
else
  progress carla info "CARLA absent" "useCarlaIfAvailable=false; chaos-driver path"
fi

# ---------------------------------------------------------------------------
# 2. Xvfb + Chromium kiosk
# ---------------------------------------------------------------------------
HAS_XVFB="false"
HAS_CHROMIUM="false"
CHROMIUM_BIN=""
if command -v Xvfb >/dev/null 2>&1; then
  HAS_XVFB="true"
fi
for cand in chromium-browser google-chrome chromium google-chrome-stable; do
  if command -v "$cand" >/dev/null 2>&1; then
    CHROMIUM_BIN="$cand"
    HAS_CHROMIUM="true"
    break
  fi
done

if [ "$HAS_XVFB" = "true" ]; then
  Xvfb :99 -screen 0 3840x2160x24 -ac >"$XVFB_LOG" 2>&1 &
  XVFB_PID=$!
  sleep 0.6
  export DISPLAY=:99
fi

WEB_BASE="${VSBS_API_BASE/8787/3000}"
DASH_URL="${WEB_BASE}/autonomy/${RECORDING_ID}"
if [ "$HAS_XVFB" = "true" ] && [ "$HAS_CHROMIUM" = "true" ]; then
  "$CHROMIUM_BIN" \
    --no-sandbox --kiosk --disable-features=Translate \
    --window-size=3840,2160 --display=:99 \
    "$DASH_URL" >"$CHROMIUM_LOG" 2>&1 &
  CHROMIUM_PID=$!
  sleep 1.2
fi

# ---------------------------------------------------------------------------
# 3. Bridge — live CARLA or chaos driver
# ---------------------------------------------------------------------------
progress bridge info "Bridge starting" "$([ "$USE_CARLA" = "true" ] && echo "live CARLA" || echo "chaos driver")"
# Launch the bridge as a DIRECT child of this script so `wait "$BRIDGE_PID"`
# blocks until it actually exits. A previous (cd ...; python &) subshell
# pattern orphaned the python child to init and made `wait` return
# instantly, which collapsed the whole capture into a single ffmpeg frame.
pushd "$REPO_ROOT/tools/carla" >/dev/null
if [ "$USE_CARLA" = "true" ]; then
  python3 -m vsbs_carla.scripts.run_demo_live --booking "$RECORDING_ID" --base "$VSBS_API_BASE" \
    >"$BRIDGE_LOG" 2>&1 &
else
  # The chaos driver hardcodes a 330 s scenario. Compress wall-clock so the
  # full timeline fits inside RECORDING_DURATION_S; the watchdog below caps
  # any residual overrun.
  CHAOS_TOTAL_S=330
  CHAOS_SPEED=$(python3 -c "import sys; d=float(sys.argv[1]); t=float(sys.argv[2]); print(max(1.0, t/d))" "$RECORDING_DURATION_S" "$CHAOS_TOTAL_S")
  python3 -m vsbs_carla.scripts.run_chaos_demo --booking "$RECORDING_ID" \
    --base "$VSBS_API_BASE" --speed "$CHAOS_SPEED" \
    >"$BRIDGE_LOG" 2>&1 &
fi
BRIDGE_PID=$!
echo "$BRIDGE_PID" >"$WORK_DIR/bridge.pid"
popd >/dev/null

# Watchdog: after the requested duration, send SIGINT to the bridge so it
# unwinds and finalises whatever phase it was in. This is the orchestrator's
# duration cap; the chaos driver's --speed compresses the full timeline to
# fit, but we still hard-cap to never exceed the requested wall-clock.
(
  sleep "$RECORDING_DURATION_S"
  if kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill -INT "$BRIDGE_PID" 2>/dev/null || true
    sleep 3
    kill -KILL "$BRIDGE_PID" 2>/dev/null || true
  fi
) &
WATCHDOG_PID=$!

# Wait for /readyz
ready="false"
for _ in $(seq 1 60); do
  if curl -sf -m 1 "${VSBS_API_BASE}/readyz" >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 0.5
done
if [ "$ready" = "true" ]; then
  progress bridge info "Bridge ready" "/readyz returned 200; ingest channels armed"
else
  progress bridge alert "Bridge ready check timed out" "/readyz did not respond within 30s"
fi

if [ "$USE_CARLA" = "true" ]; then
  progress carla info "CARLA world loaded" "live bridge handshake reached"
fi

# Tail the bridge log into structured progress events. Phase markers must
# appear as `>> phase: <name>` and event markers as `>> event: <name>
# severity=<sev> detail="..."` — see run_chaos_demo.py.
(
  if [ -f "$BRIDGE_LOG" ]; then
    tail -n +1 -F "$BRIDGE_LOG" 2>/dev/null
  fi
) | while IFS= read -r line; do
  case "$line" in
    *">> phase:"*)
      ph="${line##*>> phase:}"
      ph="${ph#"${ph%%[![:space:]]*}"}"
      progress_data scenario info "Phase: $ph" "" "{\"name\":$(json_escape "$ph")}"
      ;;
    *">> event:"*)
      payload="${line##*>> event:}"
      payload="${payload#"${payload%%[![:space:]]*}"}"
      ev_name="${payload%% *}"
      ev_rest="${payload#"$ev_name"}"
      ev_sev="info"
      case "$ev_rest" in
        *severity=alert*) ev_sev="alert" ;;
        *severity=watch*) ev_sev="watch" ;;
        *severity=info*) ev_sev="info" ;;
      esac
      progress scenario "$ev_sev" "Event: $ev_name" "$ev_rest"
      ;;
    *">> ego:"*)
      ego_rest="${line##*>> ego:}"
      ego_rest="${ego_rest#"${ego_rest%%[![:space:]]*}"}"
      progress_data carla info "Ego spawned" "" "{\"actorId\":$(json_escape "$ego_rest"),\"blueprint\":\"vehicle.tesla.model3\"}"
      ;;
  esac
# Stdout MUST flow to the parent so the orchestrator parses every
# JSON_PROGRESS line. Only stderr is silenced.
done 2>/dev/null &
TAIL_PID=$!

# ---------------------------------------------------------------------------
# 4. ffmpeg capture
# ---------------------------------------------------------------------------
ENCODER="libx264"
USE_NVENC="false"
if ffmpeg -encoders 2>/dev/null | grep -q hevc_nvenc; then
  USE_NVENC="true"
  ENCODER="hevc_nvenc"
fi

CAPTURE_KIND="x11grab"
if [ "$HAS_XVFB" != "true" ] || [ "$HAS_CHROMIUM" != "true" ]; then
  CAPTURE_KIND="synthetic"
  ENCODER="libx264"
  USE_NVENC="false"
fi

if [ "$CAPTURE_KIND" = "x11grab" ]; then
  if [ "$USE_NVENC" = "true" ]; then
    ffmpeg -y -f x11grab -framerate 60 -video_size 3840x2160 -i :99 \
      -t "$RECORDING_DURATION_S" \
      -c:v hevc_nvenc -preset p5 -rc vbr -b:v 30M -maxrate 60M -bufsize 60M \
      -movflags +faststart "$DASHBOARD_MP4" >"$FFMPEG_LOG" 2>&1 &
  else
    ffmpeg -y -f x11grab -framerate 60 -video_size 3840x2160 -i :99 \
      -t "$RECORDING_DURATION_S" \
      -c:v libx264 -preset veryfast -crf 23 -movflags +faststart \
      "$DASHBOARD_MP4" >"$FFMPEG_LOG" 2>&1 &
  fi
else
  ENCODER="synthetic"
  ffmpeg -y \
    -f lavfi -i "color=c=black:s=3840x2160:r=60,drawtext=text='VSBS demo ${RECORDING_ID}':fontsize=72:fontcolor=white:x=80:y=160" \
    -t "$RECORDING_DURATION_S" \
    -c:v libx264 -preset veryfast -crf 28 -movflags +faststart \
    "$DASHBOARD_MP4" >"$FFMPEG_LOG" 2>&1 &
fi
FFMPEG_PID=$!

progress recording info "Capture started" "encoder=$ENCODER source=$CAPTURE_KIND"

# Wait for the bridge to exit. The watchdog above sends SIGINT after
# RECORDING_DURATION_S, so this `wait` always returns within the cap.
if [ -n "$BRIDGE_PID" ]; then
  wait "$BRIDGE_PID" 2>/dev/null || true
fi

# Cancel the watchdog if it's still pending. We've already left the
# bridge-wait loop, so the cap has either fired or is unnecessary.
if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
  kill "$WATCHDOG_PID" 2>/dev/null || true
fi

if [ -n "$TAIL_PID" ] && kill -0 "$TAIL_PID" 2>/dev/null; then
  kill "$TAIL_PID" 2>/dev/null || true
fi

progress scenario info "Scenario complete" "bridge process exited"

# ---------------------------------------------------------------------------
# 5. Encoding finalise
# ---------------------------------------------------------------------------
progress encoding info "Capture flushing" "sending SIGINT to ffmpeg"
if kill -0 "$FFMPEG_PID" 2>/dev/null; then
  kill -INT "$FFMPEG_PID" 2>/dev/null || true
  for _ in $(seq 1 10); do
    if ! kill -0 "$FFMPEG_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if kill -0 "$FFMPEG_PID" 2>/dev/null; then
    kill -9 "$FFMPEG_PID" 2>/dev/null || true
  fi
fi

progress encoding info "Encoding composite started" "renaming dashboard capture into final"
if [ -f "$DASHBOARD_MP4" ]; then
  mv -f "$DASHBOARD_MP4" "$RECORDING_OUTPUT_PATH"
fi

if [ ! -f "$RECORDING_OUTPUT_PATH" ]; then
  progress done alert "Recording failed" "no output mp4 was produced"
  exit 1
fi

SIZE_BYTES="$(stat -c%s "$RECORDING_OUTPUT_PATH" 2>/dev/null || stat -f%z "$RECORDING_OUTPUT_PATH" 2>/dev/null || echo 0)"
DUR_S="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nokey=1 "$RECORDING_OUTPUT_PATH" 2>/dev/null || echo "$RECORDING_DURATION_S")"
DUR_S_INT="$(printf '%.0f' "$DUR_S" 2>/dev/null || echo "$RECORDING_DURATION_S")"

progress_data encoding info "Encoding composite complete" "" "{\"sizeBytes\":${SIZE_BYTES},\"durationS\":${DUR_S_INT},\"encoder\":\"${ENCODER}\"}"

WALL_END_S="$(date +%s)"
WALL_S="$((WALL_END_S - WALL_START_S))"

PATH_J="$(json_escape "$RECORDING_OUTPUT_PATH")"
progress_data done info "Recording done" "" "{\"path\":${PATH_J},\"sizeBytes\":${SIZE_BYTES},\"durationS\":${DUR_S_INT},\"wallS\":${WALL_S},\"encoder\":\"${ENCODER}\"}"

exit 0
