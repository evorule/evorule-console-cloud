# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# start-all.ps1 - 一键启动 evorule 全栈
#
# 启 3 个进程(隐藏窗口):
#   1. evorule-server  @ 18090  (<evorule-server 仓根>\target\<profile>\evorule-server.exe)
#   2. evorule-rule-serve @ 18081  (<evorule-rule 仓根>\target\<profile>\evorule-rule-serve.exe)
#   3. console-cloud dev @ 5174  (node scripts/dev.mjs)
#
# 等 3 个端口就绪后,自动开浏览器到 /workbench
#
# 路径自动检测:默认假设 evorule-server / evorule-rule 是本仓的兄弟目录。
# 如不在默认位置,可通过环境变量覆盖:
#   $env:EVORULE_SERVER_BIN = 'C:\path\to\evorule-server.exe'
#   $env:EVORULE_RULE_BIN   = 'C:\path\to\evorule-rule-serve.exe'
#
# 调用方式:
#   - 双击 start-all.bat(优先)
#   - 或 PowerShell 直接: powershell -ExecutionPolicy Bypass -File start-all.ps1
#   - 或 install-shortcut.ps1 创建桌面快捷后双击桌面图标

$ErrorActionPreference = 'Stop'

# === 路径常量(支持环境变量覆盖) ===
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$PARENT = Split-Path -Parent $ROOT
$DEFAULT_SERVER_BIN = Join-Path $PARENT 'evorule-server\target\debug\evorule-server.exe'
$DEFAULT_RULE_BIN   = Join-Path $PARENT 'evorule-rule\target\debug\evorule-rule-serve.exe'
$SERVER_EXE = if ($env:EVORULE_SERVER_BIN) { $env:EVORULE_SERVER_BIN } else { $DEFAULT_SERVER_BIN }
$RULE_EXE   = if ($env:EVORULE_RULE_BIN)   { $env:EVORULE_RULE_BIN }   else { $DEFAULT_RULE_BIN }
$DEV_DIR    = $ROOT
$PORT_SERVER = 18090
$PORT_RULE   = 18081
$PORT_WEB    = 5174
$WEB_URL     = "http://127.0.0.1:${PORT_WEB}/workbench"

# === 输出函数(避免 Unicode 装饰字符,PS5.1 解析器会误判) ===
function Show-Section([string]$msg) {
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Show-Ok([string]$msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Show-Warn([string]$msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Show-Err([string]$msg)   { Write-Host "  [ERR] $msg" -ForegroundColor Red }

# === 端口检测(双栈, 兼容 IPv4 '127.0.0.1' 和 IPv6 '::1') ===
function Test-Port([int]$port) {
    # Test-NetConnection 默认测 IPv4, 用 -InformationLevel Quiet 只返 bool
    # 但某些 Vite 默认 listen ::1, IPv4 测不到 — 加 IPv6 兜底
    try {
        $v4 = Test-NetConnection -ComputerName '127.0.0.1' -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($v4) { return $true }
    } catch {}
    try {
        $v6 = Test-NetConnection -ComputerName '::1' -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($v6) { return $true }
    } catch {}
    return $false
}

function Wait-Port([int]$port, [int]$timeoutSec, [string]$svcName) {
    Write-Host "  Waiting for $svcName (port $port)..." -NoNewline
    $elapsed = 0
    while ($elapsed -lt $timeoutSec) {
        if (Test-Port $port) {
            Write-Host " OK (${elapsed}s)" -ForegroundColor Green
            return $true
        }
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 1
        $elapsed++
    }
    Write-Host " TIMEOUT (${timeoutSec}s)" -ForegroundColor Red
    return $false
}

# === 进程检测 ===
function Get-ProcByPort([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        return (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue)
    }
    return $null
}

# === 启动单个后端 ===
function Start-Backend([string]$exePath, [int]$port, [string]$svcName, [string[]]$extraArgs) {
    if (-not (Test-Path $exePath)) {
        Show-Err "$svcName binary not found: $exePath"
        Show-Warn "Set env var EVORULE_SERVER_BIN / EVORULE_RULE_BIN, or place the binary under <evorule-server 仓根>\target\debug\"
        return $false
    }
    $existing = Get-ProcByPort $port
    if ($existing) {
        Show-Ok "$svcName already running (PID $($existing.Id), port $port)"
        return $true
    }
    Write-Host "  Starting $svcName... " -NoNewline
    if ($extraArgs -and $extraArgs.Count -gt 0) {
        $proc = Start-Process -FilePath $exePath -ArgumentList $extraArgs -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
    } else {
        $proc = Start-Process -FilePath $exePath -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
    }
    if ($null -eq $proc) {
        Write-Host "FAILED" -ForegroundColor Red
        return $false
    }
    Write-Host "PID $($proc.Id)" -ForegroundColor Green
    return $true
}

# === 启动 dev server ===
function Start-Dev([string]$dir, [int]$port) {
    $existing = Get-ProcByPort $port
    if ($existing) {
        Show-Ok "dev server already running (PID $($existing.Id), port $port)"
        return $true
    }
    if (-not (Test-Path "$dir\package.json")) {
        Show-Err "dev dir not found: $dir"
        return $false
    }
    Write-Host "  Starting dev server... " -NoNewline
    $proc = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', 'cd', '/d', $dir, '&&', 'node', 'scripts\dev.mjs' `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput "$dir\.dev-stdout.log" `
        -RedirectStandardError "$dir\.dev-stderr.log" -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        Write-Host "FAILED" -ForegroundColor Red
        return $false
    }
    Write-Host "PID $($proc.Id) (log: .dev-stdout.log)" -ForegroundColor Green
    return $true
}

# === 主流程 ===
Show-Section "evorule Full Stack Startup"

Show-Section "[1/3] evorule-server @ 18090"
$ok1 = Start-Backend $SERVER_EXE $PORT_SERVER "evorule-server" @()
if ($ok1) { Wait-Port $PORT_SERVER 30 "evorule-server" | Out-Null }

Show-Section "[2/3] evorule-rule-serve @ 18081"
$ok2 = Start-Backend $RULE_EXE $PORT_RULE "evorule-rule-serve" @()
if ($ok2) { Wait-Port $PORT_RULE 30 "evorule-rule-serve" | Out-Null }

Show-Section "[3/3] console-cloud dev @ 5174"
$ok3 = Start-Dev $DEV_DIR $PORT_WEB
if ($ok3) { Wait-Port $PORT_WEB 60 "console-cloud dev" | Out-Null }

Show-Section "Startup Summary"
$results = @{
    "evorule-server @ 18090" = (Test-Port $PORT_SERVER)
    "evorule-rule @ 18081"   = (Test-Port $PORT_RULE)
    "console-cloud @ 5174"   = (Test-Port $PORT_WEB)
}
foreach ($k in $results.Keys) {
    if ($results[$k]) { Show-Ok "$k ready" }
    else              { Show-Err "$k NOT ready" }
}

if ($results["console-cloud @ 5174"]) {
    Write-Host ""
    Write-Host "  Opening browser: $WEB_URL" -ForegroundColor Cyan
    Start-Process $WEB_URL
} else {
    Show-Warn "dev server not ready, skip browser open"
    Write-Host "  Manual access: $WEB_URL" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Tip: use stop-all.bat to shut down all services" -ForegroundColor Gray
Read-Host "Press Enter to exit"
