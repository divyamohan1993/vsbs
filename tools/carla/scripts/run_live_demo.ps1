# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# Live VSBS x CARLA demo launcher for Windows 11.
#
# Boots CARLA 0.9.16 (CarlaUE4.exe) in a separate window so the
# audience can watch the Tesla drive, then starts the VSBS API in
# sim profile, then runs the python bridge that drives the
# autonomous brake-failure -> book -> drive -> service -> home loop.
#
# Designed for a stock Windows 11 with default execution policy.
# Invoke via the sibling run_live_demo.cmd which sets
# -ExecutionPolicy Bypass for this single PowerShell process. No
# admin, no global policy change, no Set-ExecutionPolicy required.
#
# Usage examples:
#   .\run_live_demo.cmd
#   .\run_live_demo.cmd -CarlaHome "D:\CARLA_0.9.16"
#   .\run_live_demo.cmd -Quality Epic -Town Town01 -Npcs 10
#
# Prereqs (one-time, see docs\demo\carla-live.md):
#   1. CARLA 0.9.16 unpacked (contains CarlaUE4.exe)
#   2. Python 3.10+ on PATH with: pip install carla==0.9.16 shapely
#      networkx httpx pydantic httpx-sse python-dotenv rich pyyaml
#   3. Bun (https://bun.sh) OR Node 22+ on PATH
#
# Cleanup: Ctrl+C in this window kills CARLA, the API, and the
# bridge. The script also catches the close-window event.

[CmdletBinding()]
param(
    [string] $CarlaHome     = $env:CARLA_HOME,
    [string] $RepoRoot      = "",
    [int]    $CarlaPort     = 2000,
    [int]    $ApiPort       = 8787,
    [string] $Town          = "Town01",
    [string] $Quality       = "Low",
    [int]    $Npcs          = 6,
    [int]    $WarmupSeconds = 10,
    [int]    $FaultDurationSeconds = 25,
    [string] $Fault         = "random",
    [int]    $MaxRuntimeSeconds = 600,
    [switch] $SkipCarla,
    [switch] $SkipApi
)

$ErrorActionPreference = "Stop"
$script:Children = @()

# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

function Write-Step([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host $msg -ForegroundColor Cyan
}

function Write-Ok([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "OK    " -ForegroundColor Green -NoNewline
    Write-Host $msg
}

function Write-Fail([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "FAIL  " -ForegroundColor Red -NoNewline
    Write-Host $msg
}

function Write-Note([string]$msg) {
    Write-Host "      $msg" -ForegroundColor DarkYellow
}

function Test-PortOpen([string]$h, [int]$p, [int]$timeoutMs = 500) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect($h, $p, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)
        if ($ok) { $c.EndConnect($iar) | Out-Null; $c.Close(); return $true }
        $c.Close(); return $false
    } catch { return $false }
}

function Wait-Until([scriptblock]$Pred, [int]$TimeoutSec, [string]$Label) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        try { if (& $Pred) { return $true } } catch { }
        Start-Sleep -Milliseconds 500
    }
    Write-Fail "$Label did not become ready within $TimeoutSec seconds"
    return $false
}

function Stop-AllChildren {
    foreach ($p in $script:Children) {
        if ($null -ne $p -and -not $p.HasExited) {
            Write-Step "shutting down $($p.ProcessName) (PID $($p.Id))"
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    Get-Process -Name "CarlaUE4-Win64-Shipping","CarlaUE4" -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}

# ----------------------------------------------------------------
# Resolve repo root + paths
# ----------------------------------------------------------------

if (-not $RepoRoot) {
    # The script lives at <repo>\tools\carla\scripts\run_live_demo.ps1
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\")).Path.TrimEnd("\")
}
if (-not (Test-Path (Join-Path $RepoRoot "apps\api\src\server.ts"))) {
    Write-Fail "Repo root looks wrong: $RepoRoot"
    Write-Note "Pass -RepoRoot 'C:\path\to\vehicle-service-booking-system'"
    exit 2
}
$ApiRoot   = Join-Path $RepoRoot "apps\api"
$BridgeDir = Join-Path $RepoRoot "tools\carla"

# Locate CARLA.
if (-not $CarlaHome) {
    $candidates = @(
        "C:\CARLA_0.9.16",
        "C:\CARLA\CARLA_0.9.16",
        "D:\CARLA_0.9.16",
        "$env:USERPROFILE\CARLA_0.9.16",
        "$env:USERPROFILE\Downloads\CARLA_0.9.16",
        "$env:USERPROFILE\Documents\CARLA_0.9.16"
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "CarlaUE4.exe")) { $CarlaHome = $c; break }
    }
}
if ((-not $SkipCarla) -and (-not $CarlaHome)) {
    Write-Fail "CARLA not found"
    Write-Note "Set CARLA_HOME or pass -CarlaHome 'C:\path\to\CARLA_0.9.16'"
    Write-Note "Download: https://github.com/carla-simulator/carla/releases/tag/0.9.16"
    exit 3
}
if ((-not $SkipCarla) -and (-not (Test-Path (Join-Path $CarlaHome "CarlaUE4.exe")))) {
    Write-Fail "CARLA_HOME does not contain CarlaUE4.exe: $CarlaHome"
    exit 3
}

# Logs.
$LogDir = Join-Path $env:TEMP "vsbs-live"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$CarlaLog  = Join-Path $LogDir "carla-server.log"
$ApiLog    = Join-Path $LogDir "vsbs-api.log"
$BridgeLog = Join-Path $LogDir "bridge.log"

Write-Step "VSBS x CARLA live demo"
Write-Note "repo:       $RepoRoot"
Write-Note "carla:      $CarlaHome"
Write-Note "town:       $Town    quality: $Quality    npcs: $Npcs"
Write-Note "warmup:     ${WarmupSeconds}s    fault: $Fault    fault-duration: ${FaultDurationSeconds}s"
Write-Note "ports:      api=$ApiPort   carla-rpc=$CarlaPort"
Write-Note "logs:       $LogDir"

# ----------------------------------------------------------------
# Toolchain check
# ----------------------------------------------------------------

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) {
    Write-Fail "python not on PATH"
    Write-Note "Install Python 3.10+: https://www.python.org/downloads/"
    exit 4
}
& $python.Source -c "import carla, shapely, networkx, httpx, pydantic" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "python deps missing"
    Write-Note "Run: python -m pip install carla==0.9.16 shapely networkx httpx pydantic httpx-sse python-dotenv rich pyyaml"
    exit 4
}

$serverCmd = $null
$bun = Get-Command bun -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
if ($bun) {
    $serverCmd = @{ Exe = $bun.Source; Args = @("src/server.ts") }
    Write-Note "node-runtime: bun ($($bun.Source))"
} elseif ($node) {
    $nodeMajor = (& $node.Source -p "process.versions.node.split('.')[0]")
    if ([int]$nodeMajor -lt 22) {
        Write-Fail "Node $nodeMajor on PATH; Node 22+ required (or install bun)"
        exit 4
    }
    $serverCmd = @{ Exe = $node.Source; Args = @("--experimental-strip-types", "src/server.ts") }
    Write-Note "node-runtime: node $nodeMajor ($($node.Source))"
} else {
    Write-Fail "neither bun nor node on PATH"
    Write-Note "Install bun: https://bun.sh   or   Node 22+: https://nodejs.org"
    exit 4
}

# ----------------------------------------------------------------
# CARLA
# ----------------------------------------------------------------

if (-not $SkipCarla) {
    if (Test-PortOpen "127.0.0.1" $CarlaPort 200) {
        Write-Note "CARLA port $CarlaPort already open; reusing existing server"
    } else {
        Write-Step "launching CARLA ($Quality quality, $Town pre-load)"
        $carlaArgs = @(
            "-windowed", "-ResX=1280", "-ResY=720",
            "-quality-level=$Quality",
            "-carla-rpc-port=$CarlaPort",
            "-benchmark", "-fps=30"
        )
        $p = Start-Process -FilePath (Join-Path $CarlaHome "CarlaUE4.exe") `
            -ArgumentList $carlaArgs `
            -WorkingDirectory $CarlaHome `
            -RedirectStandardOutput $CarlaLog `
            -RedirectStandardError "$CarlaLog.err" `
            -PassThru
        $script:Children += $p
        Write-Note "CarlaUE4.exe PID $($p.Id)"

        if (-not (Wait-Until { Test-PortOpen "127.0.0.1" $CarlaPort 500 } 90 "CARLA RPC port $CarlaPort")) {
            Write-Note "Last CARLA log lines:"
            if (Test-Path $CarlaLog) { Get-Content $CarlaLog -Tail 25 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
            Stop-AllChildren; exit 5
        }
        Write-Ok "CARLA RPC up"
        Start-Sleep -Seconds 3  # let UE finish first-tick
    }
} else {
    Write-Note "skipping CARLA launch (-SkipCarla)"
}

# ----------------------------------------------------------------
# VSBS API
# ----------------------------------------------------------------

if (-not $SkipApi) {
    if (Test-PortOpen "127.0.0.1" $ApiPort 200) {
        Write-Fail "Port $ApiPort already in use"
        Write-Note "Stop the other process or pass -ApiPort <other>"
        Stop-AllChildren; exit 6
    }

    Write-Step "starting VSBS API on port $ApiPort"
    $apiEnv = @{ "LLM_PROFILE" = "sim"; "PORT" = "$ApiPort"; "NODE_ENV" = "development" }
    foreach ($k in $apiEnv.Keys) { Set-Item -Path "env:$k" -Value $apiEnv[$k] }

    $p = Start-Process -FilePath $serverCmd.Exe `
        -ArgumentList $serverCmd.Args `
        -WorkingDirectory $ApiRoot `
        -RedirectStandardOutput $ApiLog `
        -RedirectStandardError "$ApiLog.err" `
        -PassThru -WindowStyle Hidden
    $script:Children += $p
    Write-Note "API PID $($p.Id)"

    if (-not (Wait-Until {
            try {
                $r = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/readyz" `
                    -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
                return ($r.StatusCode -eq 200)
            } catch { return $false }
        } 60 "VSBS API /readyz")) {
        Write-Note "Last API log lines:"
        if (Test-Path $ApiLog) { Get-Content $ApiLog -Tail 25 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
        Stop-AllChildren; exit 7
    }
    Write-Ok "VSBS API ready"
} else {
    Write-Note "skipping API launch (-SkipApi)"
}

# ----------------------------------------------------------------
# Bridge
# ----------------------------------------------------------------

Write-Step "running CARLA bridge (state machine streams below)"
Write-Note "press Ctrl+C any time to abort and clean up"
Write-Host ""

$env:CARLA_PYTHONAPI = (Join-Path $CarlaHome "PythonAPI\carla")
$env:VSBS_API_BASE   = "http://127.0.0.1:$ApiPort"

$bridgeArgs = @(
    "-m", "vsbs_carla.scripts.run_demo_live",
    "--carla-host", "127.0.0.1",
    "--carla-port", "$CarlaPort",
    "--town", $Town,
    "--warmup-seconds", "$WarmupSeconds",
    "--fault-duration-s", "$FaultDurationSeconds",
    "--fault", $Fault,
    "--npc-count", "$Npcs",
    "--vehicle-id", ("carla-veh-live-{0}" -f (Get-Date -UFormat "%s")),
    "--max-runtime-s", "$MaxRuntimeSeconds"
)

# Register Ctrl+C handler so we always clean up.
$null = [Console]::TreatControlCAsInput = $false
try {
    Push-Location $BridgeDir
    & $python.Source @bridgeArgs 2>&1 |
        Tee-Object -FilePath $BridgeLog |
        ForEach-Object {
            if     ($_ -match "state=DONE")                       { Write-Host $_ -ForegroundColor Green }
            elseif ($_ -match "state=HALTED_AWAITING_TOW")        { Write-Host $_ -ForegroundColor White -BackgroundColor Red }
            elseif ($_ -match "TOW REQUIRED|halt[_ ]for[_ ]tow")  { Write-Host $_ -ForegroundColor White -BackgroundColor Red }
            elseif ($_ -match "state=FAILED")                     { Write-Host $_ -ForegroundColor Red }
            elseif ($_ -match "state=([A-Z_]+)")                  { Write-Host $_ -ForegroundColor Cyan }
            elseif ($_ -match "PHM predictive alert")             { Write-Host $_ -ForegroundColor Yellow -BackgroundColor DarkRed }
            elseif ($_ -match "PHM critical")                     { Write-Host $_ -ForegroundColor Yellow }
            elseif ($_ -match "PHM forecast")                     { Write-Host $_ -ForegroundColor DarkYellow }
            elseif ($_ -match "random fault selected:")           { Write-Host $_ -ForegroundColor White -BackgroundColor DarkMagenta }
            elseif ($_ -match "grant ")                           { Write-Host $_ -ForegroundColor Magenta }
            elseif ($_ -match "controller:")                      { Write-Host $_ -ForegroundColor Blue }
            elseif ($_ -match "arrived")                          { Write-Host $_ -ForegroundColor Green }
            elseif ($_ -match "WARNING|ERROR|Traceback")          { Write-Host $_ -ForegroundColor Red }
            else                                                  { Write-Host $_ -ForegroundColor DarkGray }
        }
    $bridgeExit = $LASTEXITCODE
} finally {
    Pop-Location
    Write-Host ""
    Write-Step "shutting down children"
    Stop-AllChildren
    Write-Ok "done. logs at $LogDir"
}

if ($bridgeExit -eq 0) {
    Write-Host ""
    Write-Host " === DEMO COMPLETE === " -ForegroundColor Black -BackgroundColor Green
    exit 0
} elseif (Select-String -Path $BridgeLog -Pattern "state=HALTED_AWAITING_TOW" -Quiet) {
    Write-Host ""
    Write-Host " === DEMO HALTED FOR TOW (safety fallback fired as designed) === " `
        -ForegroundColor White -BackgroundColor DarkRed
    Write-Note "see $BridgeLog for the halt reason; user notification was emitted"
    exit 0
} else {
    Write-Host ""
    Write-Host " === DEMO FAILED (exit $bridgeExit) === " -ForegroundColor White -BackgroundColor Red
    exit $bridgeExit
}
