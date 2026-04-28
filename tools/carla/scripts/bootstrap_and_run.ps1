# SPDX-License-Identifier: Apache-2.0
# Copyright (c) Divya Mohan / dmj.one
#
# Fully-autonomous bootstrap + launcher for Windows 11.
#
# Detects what is missing on the box and installs it without
# requiring admin or any global policy change. Then hands off to
# the live demo. Designed for a stock Win11 workstation where the
# default execution policy is Restricted; the sibling
# bootstrap_and_run.cmd applies -ExecutionPolicy Bypass scoped
# to this single PowerShell process.
#
# Idempotent: safe to re-run. Each prereq is detected first and
# skipped if already present.
#
# What it installs (user scope, no admin):
#   - Python 3.12 (python.org installer, /passive InstallAllUsers=0)
#   - Bun (https://bun.sh/install.ps1, installs into %USERPROFILE%\.bun)
#   - python wheels: carla, shapely, networkx, httpx, pydantic, ...
#   - CARLA 0.9.16 Windows release (downloaded + extracted)

[CmdletBinding()]
param(
    [string] $InstallRoot   = "$env:USERPROFILE\vsbs-bootstrap",
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
    [string] $PythonVersion = "3.12.7",
    [string] $CarlaVersion  = "0.9.16",
    [switch] $SkipDemo,
    [switch] $ReinstallPython,
    [switch] $ReinstallBun,
    [switch] $ReinstallCarla
)

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"  # speeds up Invoke-WebRequest

$script:StartedAt = Get-Date
$script:LogDir    = Join-Path $env:TEMP "vsbs-live"
New-Item -ItemType Directory -Force -Path $script:LogDir, $InstallRoot | Out-Null
$script:BootstrapLog = Join-Path $script:LogDir "bootstrap.log"

function Write-Step([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "==> " -ForegroundColor Cyan -NoNewline
    Write-Host $msg
    Add-Content -Path $script:BootstrapLog -Value "[$ts] STEP $msg"
}
function Write-Ok([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "[ok] " -ForegroundColor Green -NoNewline
    Write-Host $msg
    Add-Content -Path $script:BootstrapLog -Value "[$ts] OK   $msg"
}
function Write-Skip([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "[skip] " -ForegroundColor Yellow -NoNewline
    Write-Host $msg
    Add-Content -Path $script:BootstrapLog -Value "[$ts] SKIP $msg"
}
function Write-Fail([string]$msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] " -ForegroundColor DarkGray -NoNewline
    Write-Host "[fail] " -ForegroundColor Red -NoNewline
    Write-Host $msg
    Add-Content -Path $script:BootstrapLog -Value "[$ts] FAIL $msg"
}
function Write-Note([string]$msg) {
    Write-Host "       $msg" -ForegroundColor DarkYellow
}

function Refresh-PathFromRegistry {
    $machinePath = [Environment]::GetEnvironmentVariable("Path","Machine")
    $userPath    = [Environment]::GetEnvironmentVariable("Path","User")
    $env:Path = ($machinePath, $userPath -join ";")
}

function Test-Internet {
    try {
        $r = Invoke-WebRequest -Uri "https://www.google.com/generate_204" `
            -Method Head -TimeoutSec 6 -UseBasicParsing -ErrorAction Stop
        return ($r.StatusCode -in 200,204)
    } catch { return $false }
}

function Get-FreeBytes([string]$path) {
    $drive = (Get-Item $path).PSDrive.Name
    return (Get-PSDrive -Name $drive).Free
}

function Format-Bytes([long]$b) {
    if ($b -ge 1GB) { return "{0:N2} GB" -f ($b / 1GB) }
    if ($b -ge 1MB) { return "{0:N1} MB" -f ($b / 1MB) }
    return "$b B"
}

# ----------------------------------------------------------------
# Resolve repo root
# ----------------------------------------------------------------

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\")).Path.TrimEnd("\")
}
if (-not (Test-Path (Join-Path $RepoRoot "apps\api\src\server.ts"))) {
    Write-Fail "Repo root looks wrong: $RepoRoot"
    Write-Note "Pass -RepoRoot 'C:\path\to\vehicle-service-booking-system'"
    exit 2
}

Write-Host ""
Write-Host "  VSBS x CARLA bootstrap + live demo " -ForegroundColor White -BackgroundColor DarkBlue
Write-Host "  https://github.com/...     Divya Mohan / dmj.one" -ForegroundColor DarkGray
Write-Host ""
Write-Note "repo:           $RepoRoot"
Write-Note "install-root:   $InstallRoot"
Write-Note "log:            $script:BootstrapLog"
Write-Note "policy-bypass:  scoped to this PowerShell process only"
Write-Host ""

# ----------------------------------------------------------------
# Sanity: connectivity + free disk
# ----------------------------------------------------------------

Write-Step "checking internet"
if (-not (Test-Internet)) {
    Write-Fail "no internet (could not reach google.com)"
    Write-Note "Connect to a network and re-run."
    exit 4
}
Write-Ok "internet up"

$freeBytes = Get-FreeBytes $InstallRoot
Write-Note "free disk on $((Get-Item $InstallRoot).PSDrive.Name): $((Format-Bytes $freeBytes))"
if ($freeBytes -lt 30GB) {
    Write-Fail "Need at least 30 GB free for CARLA + Python + Bun. Have $((Format-Bytes $freeBytes))."
    exit 4
}

# ----------------------------------------------------------------
# Python
# ----------------------------------------------------------------

function Find-Python {
    foreach ($name in @("python", "py")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            $ver = & $cmd.Source -c "import sys; print('%d.%d.%d' % sys.version_info[:3])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $ver -match "^(\d+)\.(\d+)\.\d+$") {
                $maj = [int]$matches[1]; $min = [int]$matches[2]
                if ($maj -eq 3 -and $min -ge 10 -and $min -le 12) {
                    return [pscustomobject]@{ Path = $cmd.Source; Version = $ver }
                }
            }
        } catch { }
    }
    return $null
}

Write-Step "python 3.10 - 3.12 with pip"
$python = if ($ReinstallPython) { $null } else { Find-Python }

if (-not $python) {
    Write-Note "not found; installing Python $PythonVersion (user scope, no admin)"
    $pyExe = Join-Path $InstallRoot "python-$PythonVersion-amd64.exe"
    $pyUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
    if (-not (Test-Path $pyExe)) {
        Write-Note "downloading $pyUrl"
        try {
            Invoke-WebRequest -Uri $pyUrl -OutFile $pyExe -UseBasicParsing -TimeoutSec 600
        } catch {
            Write-Fail "python download failed: $($_.Exception.Message)"
            exit 5
        }
    }
    Write-Note "running installer (passive, user-only, prepend PATH)"
    $proc = Start-Process -FilePath $pyExe `
        -ArgumentList @(
            "/passive",
            "InstallAllUsers=0",
            "PrependPath=1",
            "Include_test=0",
            "Include_doc=0",
            "Include_launcher=1"
        ) `
        -Wait -PassThru -WindowStyle Hidden
    if ($proc.ExitCode -ne 0) {
        Write-Fail "python installer exited $($proc.ExitCode)"
        exit 5
    }
    Refresh-PathFromRegistry
    $python = Find-Python
    if (-not $python) {
        Write-Fail "Python installer ran but python is still not on PATH. Open a new terminal and re-run."
        exit 5
    }
    Write-Ok "Python $($python.Version) installed"
} else {
    Write-Skip "Python $($python.Version) already present at $($python.Path)"
}

# ----------------------------------------------------------------
# Python wheels
# ----------------------------------------------------------------

Write-Step "python deps (carla + bridge libraries)"
$wheelsCheckScript = "import importlib.util, sys; mods=['carla','shapely','networkx','httpx','pydantic']; missing=[m for m in mods if importlib.util.find_spec(m) is None]; sys.exit(1 if missing else 0); "
& $python.Path -c $wheelsCheckScript 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Note "installing wheels via pip --user"
    $pkgs = @(
        "carla==$CarlaVersion",
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
    & $python.Path -m pip install --upgrade pip
    & $python.Path -m pip install --user @pkgs
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "pip install failed (exit $LASTEXITCODE)"
        exit 6
    }
    Write-Ok "wheels installed"
} else {
    Write-Skip "all wheels already present"
}

# ----------------------------------------------------------------
# Node runtime (bun preferred, node 22+ acceptable)
# ----------------------------------------------------------------

Write-Step "node runtime (bun preferred, node 22+ acceptable)"
$nodeRuntime = $null

$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bun -and -not $ReinstallBun) {
    $nodeRuntime = @{ Kind = "bun"; Path = $bun.Source; Args = @("src/server.ts") }
    Write-Skip "bun already on PATH ($($bun.Source))"
} else {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node -and -not $ReinstallBun) {
        $nodeMajor = [int](& $node.Source -p "process.versions.node.split('.')[0]")
        if ($nodeMajor -ge 22) {
            $nodeRuntime = @{ Kind = "node"; Path = $node.Source; Args = @("--experimental-strip-types", "src/server.ts") }
            Write-Skip "node $nodeMajor already on PATH"
        }
    }
}

if (-not $nodeRuntime) {
    Write-Note "installing bun (user scope via official installer)"
    try {
        # bun's official one-liner. Requires execution-policy Bypass which
        # is already in effect for this process via the .cmd wrapper.
        $bunInstallScript = (Invoke-WebRequest -Uri "https://bun.sh/install.ps1" `
                              -UseBasicParsing -TimeoutSec 60).Content
        Invoke-Expression $bunInstallScript
    } catch {
        Write-Fail "bun install failed: $($_.Exception.Message)"
        exit 7
    }
    Refresh-PathFromRegistry
    $bunPath = "$env:USERPROFILE\.bun\bin\bun.exe"
    if (-not (Test-Path $bunPath)) {
        Write-Fail "bun installer ran but bun.exe not found at $bunPath"
        exit 7
    }
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
    }
    $nodeRuntime = @{ Kind = "bun"; Path = $bunPath; Args = @("src/server.ts") }
    Write-Ok "bun installed at $bunPath"
}

# ----------------------------------------------------------------
# CARLA 0.9.16 server
# ----------------------------------------------------------------

function Find-CarlaHome {
    $candidates = @()
    if ($env:CARLA_HOME) { $candidates += $env:CARLA_HOME }
    $candidates += @(
        "C:\CARLA_$CarlaVersion",
        "C:\CARLA\CARLA_$CarlaVersion",
        "D:\CARLA_$CarlaVersion",
        "$env:USERPROFILE\CARLA_$CarlaVersion",
        "$env:USERPROFILE\Downloads\CARLA_$CarlaVersion",
        "$env:USERPROFILE\Documents\CARLA_$CarlaVersion",
        "$InstallRoot\CARLA_$CarlaVersion"
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "CarlaUE4.exe")) { return $c }
    }
    return $null
}

Write-Step "CARLA $CarlaVersion server"
if ($ReinstallCarla -and (Test-Path "$InstallRoot\CARLA_$CarlaVersion")) {
    Remove-Item -Recurse -Force "$InstallRoot\CARLA_$CarlaVersion"
}

if (-not $CarlaHome) { $CarlaHome = Find-CarlaHome }

if ($CarlaHome -and (Test-Path (Join-Path $CarlaHome "CarlaUE4.exe"))) {
    Write-Skip "CARLA already at $CarlaHome"
} else {
    Write-Note "downloading CARLA $CarlaVersion (~7 GB compressed; resumable via BITS)"
    $carlaZip   = Join-Path $InstallRoot "CARLA_$CarlaVersion.zip"
    $carlaUrl   = "https://carla-releases.b-cdn.net/Windows/CARLA_$CarlaVersion.zip"
    $extractTo  = Join-Path $InstallRoot "CARLA_$CarlaVersion"
    New-Item -ItemType Directory -Force -Path $extractTo | Out-Null

    if (-not (Test-Path $carlaZip)) {
        # Try BITS first (resumable, smart). Fall back to curl.exe (Win11 has it).
        $bitsOk = $false
        try {
            Import-Module BitsTransfer -ErrorAction Stop
            Write-Note "transfer via BITS"
            Start-BitsTransfer -Source $carlaUrl -Destination $carlaZip `
                -DisplayName "CARLA $CarlaVersion" -Description "VSBS demo" `
                -Priority Foreground
            $bitsOk = $true
        } catch {
            Write-Note "BITS unavailable ($($_.Exception.Message)); falling back to curl"
        }
        if (-not $bitsOk) {
            $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
            if (-not $curl) { Write-Fail "neither BITS nor curl.exe available"; exit 8 }
            & $curl.Source -L -C - -o $carlaZip --retry 8 --retry-delay 5 --retry-all-errors $carlaUrl
            if ($LASTEXITCODE -ne 0) { Write-Fail "curl exited $LASTEXITCODE"; exit 8 }
        }
    } else {
        Write-Note "zip already on disk: $carlaZip ($(Format-Bytes (Get-Item $carlaZip).Length))"
    }

    if ((Get-Item $carlaZip).Length -lt 1GB) {
        Write-Fail "CARLA zip looks truncated: $((Format-Bytes (Get-Item $carlaZip).Length))"
        Write-Note "Delete $carlaZip and re-run to retry."
        exit 8
    }

    Write-Note "extracting (this takes a few minutes)"
    # tar.exe is built into Win11 (since 1803) and is much faster than
    # Expand-Archive on multi-GB zips.
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($tar) {
        Push-Location $extractTo
        & $tar.Source -xf $carlaZip
        $tarExit = $LASTEXITCODE
        Pop-Location
        if ($tarExit -ne 0) { Write-Fail "tar -xf exited $tarExit"; exit 9 }
    } else {
        Expand-Archive -LiteralPath $carlaZip -DestinationPath $extractTo -Force
    }

    # The Windows zip extracts to the chosen directory directly (no inner
    # CARLA_<ver> folder). Resolve where CarlaUE4.exe ended up.
    $found = Get-ChildItem -Path $extractTo -Filter "CarlaUE4.exe" -Recurse -File `
             -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $found) {
        Write-Fail "extraction completed but CarlaUE4.exe not found under $extractTo"
        exit 9
    }
    $CarlaHome = (Split-Path $found.FullName -Parent)
    Write-Ok "CARLA extracted: $CarlaHome"

    Write-Note "removing zip to free space"
    Remove-Item $carlaZip -Force -ErrorAction SilentlyContinue
}

# Persist CARLA_HOME for the user so subsequent runs are instant.
if (-not $env:CARLA_HOME -or $env:CARLA_HOME -ne $CarlaHome) {
    [Environment]::SetEnvironmentVariable("CARLA_HOME", $CarlaHome, "User")
    $env:CARLA_HOME = $CarlaHome
    Write-Note "set CARLA_HOME (User scope) -> $CarlaHome"
}

# ----------------------------------------------------------------
# Hand off to the live demo runner
# ----------------------------------------------------------------

Write-Host ""
Write-Step "all prereqs ready in $((New-TimeSpan -Start $script:StartedAt).TotalSeconds.ToString('N0')) s"
Write-Note "python:    $($python.Path)  ($($python.Version))"
Write-Note "node:      $($nodeRuntime.Kind)  $($nodeRuntime.Path)"
Write-Note "carla:     $CarlaHome"
Write-Host ""

if ($SkipDemo) {
    Write-Skip "-SkipDemo set; bootstrap finished without running the demo"
    exit 0
}

# Call run_live_demo.ps1 in the same process so env, PATH, and
# console colours flow through.
$runLive = Join-Path $PSScriptRoot "run_live_demo.ps1"
& $runLive `
    -CarlaHome $CarlaHome `
    -RepoRoot $RepoRoot `
    -CarlaPort $CarlaPort `
    -ApiPort $ApiPort `
    -Town $Town `
    -Quality $Quality `
    -Npcs $Npcs `
    -WarmupSeconds $WarmupSeconds `
    -FaultDurationSeconds $FaultDurationSeconds `
    -Fault $Fault `
    -MaxRuntimeSeconds $MaxRuntimeSeconds

exit $LASTEXITCODE
