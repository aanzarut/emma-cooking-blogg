<#
  Puts a "Recipe Studio" icon on the desktop.

  Run it by double-clicking "Install desktop icon.bat" in this folder,
  or from PowerShell:  .\scripts\install-shortcut.ps1
#>

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'start-studio.bat'
$icon     = Join-Path $root 'assets\recipe-studio.ico'

if (-not (Test-Path $launcher)) {
  Write-Host ''
  Write-Host "  Could not find start-studio.bat next to this script." -ForegroundColor Red
  Write-Host "  Run this from inside the project folder." -ForegroundColor Red
  Write-Host ''
  exit 1
}

# GetFolderPath follows a OneDrive-redirected Desktop, which a hardcoded
# path would miss.
$desktop  = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop 'Recipe Studio.lnk'

$shell = New-Object -ComObject WScript.Shell
$link  = $shell.CreateShortcut($shortcut)
$link.TargetPath       = $launcher
$link.WorkingDirectory = $root
$link.Description      = 'Open Recipe Studio to add and edit recipes'
$link.WindowStyle      = 1          # normal: the window shows the phone address,
                                    # and closing it is how she stops the Studio
if (Test-Path $icon) { $link.IconLocation = $icon }
$link.Save()

Write-Host ''
Write-Host '  Done.' -ForegroundColor Green
Write-Host "  There is now a Recipe Studio icon on the desktop: $shortcut"
Write-Host '  Double-click it to start. Closing the black window stops it.'
Write-Host ''
