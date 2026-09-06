@echo off
REM Double-click this once, straight after unzipping the download.
REM It puts Recipe Studio where Windows can cope with it, finds any
REM recipes and photos from an earlier copy and brings them across, and
REM makes the desktop icon. Nothing is ever deleted.
title Set up Recipe Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed yet.
  echo   Install it from https://nodejs.org ^(choose the LTS version^), then run this again.
  echo.
  pause
  exit /b 1
)

node scripts\update.js --setup
echo.
pause
