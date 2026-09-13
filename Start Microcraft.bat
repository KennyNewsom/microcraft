@echo off
setlocal
title Microcraft Server
cd /d "%~dp0"
if errorlevel 1 exit /b 1
start "" explorer.exe "%~dp0."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start_microcraft.ps1"
echo.
echo Microcraft launcher finished. See any messages above.
pause
