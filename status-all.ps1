# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# status-all.ps1 - evorule 全栈健康检查(可选自动重启)
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File status-all.ps1              # 只检查
#   powershell -ExecutionPolicy Bypass -File status-all.ps1 -AutoRestart # 检查 + 自动拉起死掉的服务
#
# -AutoRestart 语义:只拉起"未监听"的服务,正在运行的绝不触碰;
#   拉起复用 start-all.ps1 的幂等语义(-Quiet -NoBrowser,已运行则跳过)。
#
# 配合 watchdog(可选,常驻保活):
#   schtasks 注册 5 分钟轮询,见 register-watchdog.ps1:
#     powershell -ExecutionPolicy Bypass -File register-watchdog.ps1
#   注册后,服务异常退出最迟 5 分钟内被自动拉起,无需手动 start-all.bat。

param(
    [switch]$AutoRestart,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$PORT_SERVER = 18080
$PORT_RULE   = 18081
$PORT_WEB    = 5174

function Show-Ok([string]$msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Show-Warn([string]$msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Show-Err([string]$msg)   { Write-Host "  [ERR] $msg" -ForegroundColor Red }

# 直接查本机监听表(TcpClient 默认 IPv4,探测只绑 ::1 的 vite 必失败;
# Test-NetConnection 对 refused 场景每次耗时数秒)
function Test-Port([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Get-ProcByPort([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue) }
    return $null
}

$services = @(
    @{ Name = "evorule-server @ 18080"; Port = $PORT_SERVER },
    @{ Name = "evorule-rule-serve @ 18081"; Port = $PORT_RULE },
    @{ Name = "console-cloud dev @ 5174"; Port = $PORT_WEB }
)

if (-not $Quiet) { Write-Host "=== evorule Full Stack Health ===" }

$allHealthy = $true
foreach ($s in $services) {
    if (Test-Port $s.Port) {
        $p = Get-ProcByPort $s.Port
        $info = if ($p) { "PID $($p.Id)" } else { "unknown PID" }
        if (-not $Quiet) { Show-Ok "$($s.Name) ($info)" }
    } else {
        $allHealthy = $false
        Show-Err "$($s.Name) DOWN"
    }
}

if ($allHealthy) {
    if (-not $Quiet) { Write-Host "All services healthy." -ForegroundColor Gray }
    exit 0
}

if (-not $AutoRestart) {
    if (-not $Quiet) {
        Write-Host ""
        Write-Host "Some services are down. Fix:" -ForegroundColor Gray
        Write-Host "  start-all.bat                            # restart all" -ForegroundColor Gray
        Write-Host "  status-all.ps1 -AutoRestart              # restart only the dead ones" -ForegroundColor Gray
    }
    exit 1
}

# -AutoRestart:start-all.ps1 幂等(已运行跳过),直接整体拉一遍即可
if (-not $Quiet) { Write-Host ""; Write-Host "Auto-restarting down services via start-all.ps1 -Quiet -NoBrowser..." -ForegroundColor Cyan }
& powershell -ExecutionPolicy Bypass -File (Join-Path $ROOT 'start-all.ps1') -Quiet -NoBrowser

# 复检
$stillDown = @()
foreach ($s in $services) {
    if (-not (Test-Port $s.Port)) { $stillDown += $s.Name }
}

if ($stillDown.Count -eq 0) {
    Write-Host "[watchdog] all services recovered." -ForegroundColor Green
    exit 0
} else {
    foreach ($n in $stillDown) { Write-Host "[watchdog] still down: $n (see logs\)" -ForegroundColor Red }
    exit 1
}
