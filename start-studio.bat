@echo off
REM Starts Recipe Studio. Close this window to stop it.
title Recipe Studio
setlocal
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

if not exist "node_modules" (
  echo.
  echo   Setting things up for the first time. This takes a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   Setup failed. Show this window to whoever set this up.
    pause
    exit /b 1
  )
)

node studio/server.js --open

echo.
echo   Recipe Studio has stopped.
pause
