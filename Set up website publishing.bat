@echo off
REM Double-click this to let this computer put the website online.
title Website publishing setup
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

node scripts/setup-publish.js
echo.
pause
