# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# Installs python deps the bridge needs on Windows 11. Idempotent.
# Run once on the demo machine before run_live_demo.cmd.

$ErrorActionPreference = "Stop"

function Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "[ok] $m" -ForegroundColor Green }
function Fail([string]$m) { Write-Host "[fail] $m" -ForegroundColor Red }

# Find python.
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
    Fail "Python not on PATH"
    Write-Host "Install Python 3.10 - 3.12 from https://www.python.org/downloads/"
    Write-Host "Pick `"Add python.exe to PATH`" during setup."
    exit 1
}
Step "python: $($python.Source)"

# Upgrade pip.
& $python.Source -m pip install --upgrade pip

# Core deps. carla 0.9.16 wheels exist for cp310/311/312 on win-amd64.
$pkgs = @(
    "carla==0.9.16",
    "shapely>=2.0",
    "networkx>=3.0",
    "httpx>=0.27",
    "httpx-sse>=0.4",
    "pydantic>=2.5",
    "python-dotenv>=1.0",
    "rich>=13.7",
    "pyyaml>=6.0",
    "numpy>=1.26"
)
Step "installing: $($pkgs -join ', ')"
& $python.Source -m pip install --user @pkgs
if ($LASTEXITCODE -ne 0) { Fail "pip install failed (exit $LASTEXITCODE)"; exit $LASTEXITCODE }

# Smoke test.
& $python.Source -c "import carla, shapely, networkx, httpx, pydantic; print('all imports ok, carla', carla.__version__ if hasattr(carla, '__version__') else 'unknown')"
if ($LASTEXITCODE -ne 0) { Fail "smoke import failed"; exit $LASTEXITCODE }

Ok "python deps installed"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Download CARLA 0.9.16 Windows zip:"
Write-Host "     https://github.com/carla-simulator/carla/releases/tag/0.9.16"
Write-Host "  2. Extract to one of: C:\CARLA_0.9.16, D:\CARLA_0.9.16, %USERPROFILE%\CARLA_0.9.16"
Write-Host "     (or set CARLA_HOME env var to wherever you put it)"
Write-Host "  3. Install Bun (https://bun.sh) OR Node 22+ (https://nodejs.org)"
Write-Host "  4. Run: tools\carla\scripts\run_live_demo.cmd"
