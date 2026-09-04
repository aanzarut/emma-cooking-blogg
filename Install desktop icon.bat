@echo off
REM Double-click this once to put a Recipe Studio icon on the desktop.
title Install Recipe Studio icon
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-shortcut.ps1"
pause
