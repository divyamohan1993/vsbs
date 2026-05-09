#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# bootstrap_vm.sh — fresh-Ubuntu-22.04 GCE VM with a T4/L4 GPU.
# Installs NVIDIA driver, Vulkan runtime, CARLA 0.9.16, Bun, Node 22, pnpm,
# Python deps, and the VSBS repo. Idempotent.
#
# Designed to be invoked by GCE metadata startup-script so it runs in
# parallel with the user's first SSH session. End-of-run marker:
#     BOOTSTRAP-COMPLETE <iso8601>
# is appended to /var/log/vsbs-bootstrap.log so a watcher can poll.

set -euo pipefail

LOG=/var/log/vsbs-bootstrap.log
exec > >(tee -a "$LOG") 2>&1
echo "[$(date -Iseconds)] bootstrap start (uid=$(id -u))"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

REPO_URL="${REPO_URL:-https://github.com/divyamohan1993/vsbs.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
REPO_DIR="${REPO_DIR:-/opt/vsbs}"
CARLA_DIR=/opt/carla/CARLA_0.9.16
CARLA_TARBALL_URLS=(
  "https://github.com/carla-simulator/carla/releases/download/0.9.16/CARLA_0.9.16.tar.gz"
  "https://carla-releases.s3.us-east-005.backblazeb2.com/Linux/CARLA_0.9.16.tar.gz"
  "https://carla-releases.s3.eu-west-3.amazonaws.com/Linux/CARLA_0.9.16.tar.gz"
)

mkdir -p /opt /opt/carla

# --- 1. base packages --------------------------------------------------------
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl wget gnupg lsb-release \
  xz-utils tar zstd unzip \
  build-essential pkg-config cmake \
  python3 python3-pip python3-venv python3-dev \
  libvulkan1 vulkan-tools mesa-vulkan-drivers libegl1 libgl1 libglu1-mesa \
  libxkbcommon0 libxkbcommon-x11-0 libpci3 libomp5 libsdl2-2.0-0 \
  libtinfo6 libncurses6 libfreetype6 libfontconfig1 libx11-6 libxext6 \
  libsm6 libxrender1 libxcursor1 libxcomposite1 libxdamage1 libxi6 \
  libxrandr2 libxtst6 libxss1 libnss3 libasound2 \
  xdg-user-dirs git ffmpeg jq htop

# --- 2. NVIDIA driver -------------------------------------------------------
# When the VM is built from an Ubuntu Accelerator image (e.g.
# ubuntu-accelerator-2204-amd64-with-nvidia-580), the driver is already
# installed and loaded; nvidia-smi just works. Skip the install in that
# case. Only fall back to apt install if nvidia-smi is genuinely missing.
if nvidia-smi >/dev/null 2>&1; then
  echo "[bootstrap] NVIDIA driver already present (accelerator image)"
  # Avoid SIGPIPE from `head` closing the pipe early under set -o pipefail.
  nvidia-smi | sed -n '1,10p' || true
else
  echo "[bootstrap] no nvidia-smi; installing via ubuntu-drivers"
  apt-get install -y --no-install-recommends ubuntu-drivers-common
  ubuntu-drivers autoinstall 2>&1 | sed -n '$-19,$p' || \
    apt-get install -y --no-install-recommends nvidia-driver-550-server nvidia-utils-550-server
  modprobe nvidia 2>&1 || echo "[bootstrap][warn] modprobe failed; reboot may be needed"
  nvidia-smi || echo "[bootstrap][warn] nvidia-smi still failing"
fi

# --- 3. CARLA 0.9.16 ---------------------------------------------------------
if [ ! -x "$CARLA_DIR/CarlaUE4.sh" ]; then
  echo "[bootstrap] downloading CARLA 0.9.16 (~7GB)"
  cd /opt/carla
  rm -f CARLA_0.9.16.tar.gz
  ok=0
  for url in "${CARLA_TARBALL_URLS[@]}"; do
    echo "[bootstrap]  trying $url"
    if curl -fL --retry 3 --retry-delay 2 -C - -o CARLA_0.9.16.tar.gz "$url"; then
      ok=1
      break
    fi
    echo "[bootstrap][warn] download failed from $url"
  done
  if [ "$ok" != "1" ]; then
    echo "[bootstrap][fatal] all CARLA tarball mirrors failed"
    exit 2
  fi
  mkdir -p "$CARLA_DIR"
  echo "[bootstrap] extracting CARLA"
  tar -xzf CARLA_0.9.16.tar.gz -C "$CARLA_DIR"
  rm -f CARLA_0.9.16.tar.gz
  chmod +x "$CARLA_DIR/CarlaUE4.sh" 2>/dev/null || true
  echo "[bootstrap] CARLA extracted to $CARLA_DIR"
fi

# --- 4. Node 22 + pnpm -------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | sed 's/v//;s/\..*//')" != "22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y --no-install-recommends nodejs
fi
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9.12.0 --activate >/dev/null 2>&1 || npm i -g pnpm@9

# --- 5. Bun ------------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
fi
bun --version || true

# --- 6. Python deps for the bridge ------------------------------------------
pip3 install --upgrade pip wheel setuptools
# Install the CARLA wheel that ships *inside* the tarball — guaranteed
# version match against the server. Falls back to PyPI if absent.
WHEEL_DIR="$CARLA_DIR/PythonAPI/carla/dist"
if [ -d "$WHEEL_DIR" ]; then
  WHEEL=$(ls "$WHEEL_DIR"/carla-0.9.16-cp310-*.whl 2>/dev/null | head -1)
  if [ -n "$WHEEL" ]; then
    echo "[bootstrap] installing bundled CARLA wheel: $WHEEL"
    pip3 install "$WHEEL"
  else
    echo "[bootstrap][warn] no cp310 wheel in tarball; falling back to pypi"
    pip3 install carla==0.9.16
  fi
else
  pip3 install carla==0.9.16
fi
pip3 install httpx pydantic pyyaml networkx numpy

# --- 7. Repo -----------------------------------------------------------------
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone --depth=1 --branch="$REPO_BRANCH" "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
git fetch --depth=1 origin "$REPO_BRANCH"
git reset --hard "origin/$REPO_BRANCH"

# --- 8. Install + build libs + web ------------------------------------------
pnpm install --ignore-scripts --frozen-lockfile=false
# Build *every* workspace package under packages/ — the root's build:libs
# script only covers 5 of 8 packages, but the web imports from @vsbs/telemetry,
# @vsbs/security, and @vsbs/agents which need their dist/ directories.
pnpm -r --filter "./packages/**" build 2>&1 | tail -25
# Build the Next.js web in production mode so it can be served on port 3000
# without dev-mode JIT delays. Failure here is non-fatal: the run can still
# proceed without the dashboard (CARLA + API + bridge will still work).
( cd "$REPO_DIR/apps/web" && pnpm exec next build 2>&1 | tail -40 ) || \
  echo "[bootstrap][warn] web build failed; dashboard will be unavailable"

# Permissions: any future ssh'd user can read+execute the repo and CARLA.
chmod -R a+rX "$REPO_DIR" /opt/carla 2>/dev/null || true
# /tmp/vsbs-vm is world-writable for the bridge's frame dump.
mkdir -p /tmp/vsbs-vm && chmod 1777 /tmp/vsbs-vm

echo "BOOTSTRAP-COMPLETE $(date -Iseconds)"
