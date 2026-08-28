# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# install-shortcut.ps1 - 在桌面创建 start-all.lnk + stop-all.lnk
# 跑一次即可, 后续双击桌面图标就能启停

$ErrorActionPreference = 'Stop'

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# start-all shortcut
$startLnk = "$desktop\evorule-start.lnk"
$startTarget = "$repoRoot\start-all.bat"
$shortcut = $shell.CreateShortcut($startLnk)
$shortcut.TargetPath = $startTarget
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7  # Minimized
$shortcut.Description = "Start evorule full stack (server + rule + dev + browser)"
$shortcut.IconLocation = "shell32.dll,13"  # Green start icon
$shortcut.Save()
Write-Host "[OK] Created: $startLnk" -ForegroundColor Green

# stop-all shortcut
$stopLnk = "$desktop\evorule-stop.lnk"
$stopTarget = "$repoRoot\stop-all.bat"
$shortcut = $shell.CreateShortcut($stopLnk)
$shortcut.TargetPath = $stopTarget
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Stop evorule full stack (server + rule + dev)"
$shortcut.IconLocation = "shell32.dll,27"  # Red stop icon
$shortcut.Save()
Write-Host "[OK] Created: $stopLnk" -ForegroundColor Green

Write-Host ""
Write-Host "Done - double click desktop icons to start/stop" -ForegroundColor Cyan
Read-Host "Press Enter to exit"
