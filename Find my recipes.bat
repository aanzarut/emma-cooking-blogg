@echo off
REM Double-click this if recipes or photos seem to have gone missing.
REM It looks through Documents, Downloads and the Desktop for every other
REM copy of Recipe Studio and brings their recipes and photos into this one.
REM Nothing is fetched and nothing is deleted.
title Find my recipes
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install it from https://nodejs.org ^(LTS version^).
  echo.
  pause
  exit /b 1
)

node scripts\update.js --gather
echo.
pause
