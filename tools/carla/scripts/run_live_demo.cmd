@echo off
:: SPDX-License-Identifier: Apache-2.0
:: Copyright (c) Divya Mohan / dmj.one
::
:: One-click launcher for the VSBS x CARLA live demo on Windows 11.
:: Forwards every argument straight through to the PowerShell script.
:: Uses -ExecutionPolicy Bypass scoped to this single process so it
:: works on a stock Win11 (default policy = Restricted on workstation,
:: RemoteSigned on server). NO admin required. NO global policy change.
::
:: Usage:
::   run_live_demo.cmd
::   run_live_demo.cmd -CarlaHome "D:\CARLA_0.9.16" -Quality Epic
::   run_live_demo.cmd -Town Town01 -Npcs 8 -FaultDuration 20

setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run_live_demo.ps1" %*
exit /b %ERRORLEVEL%
