# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# stop-all.ps1 - 一键停止 evorule 全栈
#
# 关闭:
#   1. evorule-server  (找 18080 端口的进程)
#   2. evorule-rule-serve (找 18081 端口的进程)
#   3. console-cloud dev (找 5174 端口的进程)
#
# 调用方式:
#   - 双击 stop-all.bat(优先)
#   - 或 PowerShell 直接: powershell -ExecutionPolicy Bypass -File stop-all.ps1
#   - 自动化(不卡 Read-Host): powershell -File stop-all.ps1 -Quiet

param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$PORT_SERVER = 18080
$PORT_RULE   = 18081
$PORT_WEB    = 5174

function Show-Section([string]$msg) { Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Show-Ok([string]$msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Show-Warn([string]$msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Show-Err([string]$msg)   { Write-Host "  [ERR] $msg" -ForegroundColor Red }

function Stop-ByPort([int]$port, [string]$svcName) {
    $conns = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $conns) {
        Show-Warn "$svcName (port $port) not running"
        return
    }
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            try {
                Stop-Process -Id $proc.Id -Force -ErrorAction Stop
                Show-Ok "$svcName stopped (PID $($proc.Id))"
            } catch {
                Show-Err "$svcName stop failed (PID $($proc.Id)): $_"
            }
        }
    }
}

Show-Section "evorule Full Stack Shutdown"
Stop-ByPort $PORT_SERVER "evorule-server"
Stop-ByPort $PORT_RULE   "evorule-rule-serve"
Stop-ByPort $PORT_WEB    "console-cloud dev"

Write-Host ""
Write-Host "Done." -ForegroundColor Gray
if (-not $Quiet) { Read-Host "Press Enter to exit" }
