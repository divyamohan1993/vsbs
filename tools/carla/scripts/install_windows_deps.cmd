@echo off
:: SPDX-License-Identifier: Apache-2.0
:: One-time setup helper for Windows 11.
:: Installs the python deps the bridge needs. Does NOT install CARLA
:: (download separately) or bun/node (install once from bun.sh / nodejs.org).

setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install_windows_deps.ps1" %*
exit /b %ERRORLEVEL%
