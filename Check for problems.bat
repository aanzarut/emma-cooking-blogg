@echo off
REM Double-click this if something looks wrong. It checks the installation
REM and prints what it finds.
title Recipe Studio check
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install it from https://nodejs.org ^(LTS version^).
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Setting things up first. This takes a minute...
  echo.
  call npm install
)

node scripts/doctor.js
echo.
pause
