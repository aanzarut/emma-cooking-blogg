@echo off
REM Double-click this to get the latest version.
REM Your recipes and photos are never touched.
title Update Recipe Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install it from https://nodejs.org ^(LTS version^).
  echo.
  pause
  exit /b 1
)

node scripts/update.js
echo.
pause
