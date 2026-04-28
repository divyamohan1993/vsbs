@echo off
:: SPDX-License-Identifier: Apache-2.0
:: Copyright (c) Divya Mohan / dmj.one
::
:: Fully-autonomous bootstrap + launcher for Windows 11.
::   Detects, downloads, and installs anything missing
::   (Python, Bun, CARLA 0.9.16, python wheels), then runs
::   the live demo.
::
:: Stock Win11, default execution policy, NO admin required.
:: Run as a normal user. Everything installs in user scope.
::
:: Usage:
::   bootstrap_and_run.cmd
::   bootstrap_and_run.cmd -Quality Epic -Town Town01 -Npcs 12

setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%bootstrap_and_run.ps1" %*
exit /b %ERRORLEVEL%
