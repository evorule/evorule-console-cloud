# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# start-all.ps1 - 一键启动 evorule 全栈
#
# 启 3 个进程(隐藏窗口):
#   1. evorule-server  @ 18080  (<evorule-server 仓根>\target\<profile>\evorule-server.exe)
#   2. evorule-rule-serve @ 18081  (<evorule-rule 仓根>\target\<profile>\evorule-rule-serve.exe)
#   3. console-cloud dev @ 5174  (node scripts/dev.mjs --yes)
#
# 等 3 个端口就绪后,自动开浏览器到 /(HomeRouter 状态机首页,带新手引导)
#
# 参数:
#   -Quiet      无人值守模式:精简输出、不 Read-Host(供 status-all.ps1 -AutoRestart /
#               schtasks 等自动化调用)
#   -NoBrowser  就绪后不自动打开浏览器
#
# 失败处理(部分保活续启):任一服务启动失败/端口超时,已就绪的服务保持运行,
# 只停止"本次拉起但未就绪"的进程树(taskkill /T 连子进程;不碰 already running);
# 修复问题后重跑 start-all.bat 即可续启(幂等跳过已运行的)。
#
# 日志:全部落 logs\ 目录(不污染仓根),启动时轮转(当前 -> *.prev,只留两轮):
#   logs\evorule-server.out.log / .err.log
#   logs\evorule-rule.out.log   / .err.log
#   logs\dev-stdout.log         / dev-stderr.log
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

param(
    [switch]$Quiet,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# === 路径常量(支持环境变量覆盖) ===
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$PARENT = Split-Path -Parent $ROOT
$DEFAULT_SERVER_BIN = Join-Path $PARENT 'evorule-server\target\debug\evorule-server.exe'
$DEFAULT_RULE_BIN   = Join-Path $PARENT 'evorule-rule\target\debug\evorule-rule-serve.exe'
$SERVER_EXE = if ($env:EVORULE_SERVER_BIN) { $env:EVORULE_SERVER_BIN } else { $DEFAULT_SERVER_BIN }
$RULE_EXE   = if ($env:EVORULE_RULE_BIN)   { $env:EVORULE_RULE_BIN }   else { $DEFAULT_RULE_BIN }
$DEV_DIR    = $ROOT
$LOGS_DIR   = Join-Path $ROOT 'logs'
$PORT_SERVER = 18080
$PORT_RULE   = 18081
$PORT_WEB    = 5174
# localhost(而非 127.0.0.1):vite 默认只绑 ::1,127.0.0.1 可能打不开
$WEB_URL     = "http://localhost:${PORT_WEB}/"

# 后端启动参数:
#   evorule-server 裸起(无参数)不会监听 18080,必须带资源路径。
#   默认按兄弟目录推导;结构不同时用 EVORULE_SERVER_ARGS / EVORULE_RULE_ARGS
#   整体覆盖(空格分隔的完整参数串)。
if ($env:EVORULE_SERVER_ARGS) {
    $SERVER_ARGS = $env:EVORULE_SERVER_ARGS
} else {
    $SRV_DIR = Join-Path $PARENT 'evorule-server'
    # 18080 与前端 DEFAULT_LOCAL_BASE_URL(src/lib/backend/types.ts)保持一致
    $SERVER_ARGS = "--addr 127.0.0.1:$PORT_SERVER " +
        "--rules-dir `"$(Join-Path $SRV_DIR 'rules')`" " +
        "--core-eval `"$(Join-Path $SRV_DIR 'resources\server_eval.json')`" " +
        "--service-registry `"$(Join-Path $SRV_DIR 'service_registry.json')`" " +
        "--allowed-origins http://localhost:$PORT_WEB,http://127.0.0.1:$PORT_WEB,http://localhost:4173,http://127.0.0.1:4173 " +
        "--log-level info"
}
if ($env:EVORULE_RULE_ARGS) {
    $RULE_ARGS = $env:EVORULE_RULE_ARGS
} else {
    # 注意:默认不带 --admin-user/--admin-password(公开仓不硬编码凭据)。
    # 首次需要引导管理员时,用 EVORULE_RULE_ARGS 自行追加,见 README-STARTUP.md。
    $RULE_DB = Join-Path $PARENT 'evorule-rule\data\rule.db'
    $RULE_ARGS = "--host 127.0.0.1 --port $PORT_RULE --db `"$RULE_DB`""
}

# 日志目录(集中存放,保持仓根卫生)
if (-not (Test-Path $LOGS_DIR)) { New-Item -ItemType Directory -Path $LOGS_DIR | Out-Null }

# === 输出函数(避免 Unicode 装饰字符,PS5.1 解析器会误判) ===
function Show-Section([string]$msg) {
    if ($Quiet) { return }
    Write-Host ""
    Write-Host "=== $msg ===" -ForegroundColor Cyan
}

function Show-Ok([string]$msg)    { if (-not $Quiet) { Write-Host "  [OK] $msg" -ForegroundColor Green } }
function Show-Warn([string]$msg)  { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Show-Err([string]$msg)   { Write-Host "  [ERR] $msg" -ForegroundColor Red }

# === 端口检测 ===
# 直接查本机监听表,而非 TCP 探测:
#   - Test-NetConnection 对 refused 场景每次耗时数秒,拖垮 Wait-Port 轮询节奏
#   - TcpClient 默认 IPv4 地址族,探测只绑 ::1 的 vite(Node17+ localhost 解析)必失败
# Get-NetTCPConnection 毫秒级且双栈皆准。
function Test-Port([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Wait-Port([int]$port, [int]$timeoutSec, [string]$svcName) {
    if (-not $Quiet) { Write-Host "  Waiting for $svcName (port $port)..." -NoNewline }
    $elapsed = 0
    while ($elapsed -lt $timeoutSec) {
        if (Test-Port $port) {
            if (-not $Quiet) { Write-Host " OK (${elapsed}s)" -ForegroundColor Green }
            return $true
        }
        if (-not $Quiet) { Write-Host "." -NoNewline }
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

# 停止进程树(含子进程;dev.mjs -> vite 是父子树)
function Stop-ProcTree([int]$procId, [string]$svcName) {
    try {
        # taskkill /T 连子进程一起杀(Stop-Process 只杀本体,会留下孤儿 vite)
        taskkill /PID $procId /T /F /O 2>$null | Out-Null
        Show-Warn "rolled back $svcName (PID $procId + child tree)"
    } catch {
        Show-Warn "rollback $svcName (PID $procId): $_"
    }
}

# === 日志轮转策略 ===
# 每次真正拉起服务前轮转:当前日志 -> *.prev(旧 .prev 直接删除)。
# 任意时刻只保留"本轮 + 上一轮"两份,容量有界,无需后台清理任务。
function Reset-Log([string]$logPath) {
    if (-not (Test-Path $logPath)) { return }
    if (Test-Path "$logPath.prev") { Remove-Item "$logPath.prev" -Force }
    Move-Item $logPath "$logPath.prev" -Force
}

# 本次拉起的进程(回滚只动这些,不碰 already running)
$script:StartedProcs = @()   # 元素: @{ Name; Id; Port }

# 部分保活续启:失败时已就绪的服务保留运行,只清理"本次拉起但未就绪"的进程。
# 未就绪的停掉(进程可能半死状态,留着只会误导);就绪的留给下次 start-all 幂等跳过。
function Start-Rollback {
    if ($script:StartedProcs.Count -eq 0) {
        Show-Warn "rollback: nothing started by this run"
        return
    }
    Show-Section "Rollback (keep healthy ones, stop only not-ready ones)"
    for ($i = $script:StartedProcs.Count - 1; $i -ge 0; $i--) {
        $p = $script:StartedProcs[$i]
        if (Test-Port $p.Port) {
            Show-Ok "$($p.Name) is healthy, keep it running (PID $($p.Id))"
        } else {
            Stop-ProcTree $p.Id $p.Name
        }
    }
    $script:StartedProcs = @()
}

# === 启动单个后端 ===
function Start-Backend([string]$exePath, [int]$port, [string]$svcName, [string]$argsStr) {
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
    if (-not $Quiet) { Write-Host "  Starting $svcName... " -NoNewline }
    $outLog = Join-Path $LOGS_DIR "$($svcName -replace '[\\/:*?"<>| ]', '_').out.log"
    $errLog = Join-Path $LOGS_DIR "$($svcName -replace '[\\/:*?"<>| ]', '_').err.log"
    Reset-Log $outLog
    Reset-Log $errLog
    $proc = Start-Process -FilePath $exePath -ArgumentList $argsStr `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
        -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        Write-Host "FAILED" -ForegroundColor Red
        Show-Err "$svcName start failed, see log: $errLog"
        return $false
    }
    if (-not $Quiet) { Write-Host "PID $($proc.Id) (log: logs\$([System.IO.Path]::GetFileName($outLog)))" -ForegroundColor Green }
    $script:StartedProcs += @{ Name = $svcName; Id = $proc.Id; Port = $port }
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
    if (-not $Quiet) { Write-Host "  Starting dev server... " -NoNewline }
    # 直接起 node(不经 cmd.exe 包裹,回滚杀树更可靠);--yes 无人值守跳过端口占用确认
    $devOut = Join-Path $LOGS_DIR 'dev-stdout.log'
    $devErr = Join-Path $LOGS_DIR 'dev-stderr.log'
    Reset-Log $devOut
    Reset-Log $devErr
    $proc = Start-Process -FilePath 'node' `
        -ArgumentList 'scripts\dev.mjs', '--yes' `
        -WorkingDirectory $dir `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $devOut `
        -RedirectStandardError  $devErr `
        -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        Write-Host "FAILED" -ForegroundColor Red
        Show-Err "dev server start failed, see log: logs\dev-stderr.log"
        return $false
    }
    if (-not $Quiet) { Write-Host "PID $($proc.Id) (log: logs\dev-stdout.log)" -ForegroundColor Green }
    $script:StartedProcs += @{ Name = "console-cloud dev"; Id = $proc.Id; Port = $port }
    return $true
}

# === 主流程 ===
Show-Section "evorule Full Stack Startup"

Show-Section "[1/3] evorule-server @ 18080"
$ok1 = Start-Backend $SERVER_EXE $PORT_SERVER "evorule-server" $SERVER_ARGS
if ($ok1) { $ok1 = Wait-Port $PORT_SERVER 30 "evorule-server" }

Show-Section "[2/3] evorule-rule-serve @ 18081"
$ok2 = Start-Backend $RULE_EXE $PORT_RULE "evorule-rule-serve" $RULE_ARGS
if ($ok2) { $ok2 = Wait-Port $PORT_RULE 30 "evorule-rule-serve" }

Show-Section "[3/3] console-cloud dev @ 5174"
$ok3 = Start-Dev $DEV_DIR $PORT_WEB
if ($ok3) { $ok3 = Wait-Port $PORT_WEB 60 "console-cloud dev" }

Show-Section "Startup Summary"
$results = @{
    "evorule-server @ 18080" = (Test-Port $PORT_SERVER)
    "evorule-rule @ 18081"   = (Test-Port $PORT_RULE)
    "console-cloud @ 5174"   = (Test-Port $PORT_WEB)
}
foreach ($k in $results.Keys) {
    if ($results[$k]) { Show-Ok "$k ready" }
    else              { Show-Err "$k NOT ready" }
}

# === 失败处理:部分保活续启 ===
if (-not ($results["evorule-server @ 18080"] -and $results["evorule-rule @ 18081"] -and $results["console-cloud @ 5174"])) {
    Start-Rollback
    Show-Err "startup incomplete — healthy services kept running, not-ready ones stopped"
    Write-Host "  Logs: $LOGS_DIR" -ForegroundColor Gray
    Write-Host "  Fix the issue (check logs / binary paths), then re-run start-all.bat" -ForegroundColor Gray
    Write-Host "  (already-running services will be skipped, only missing ones start)" -ForegroundColor Gray
    if (-not $Quiet) { Read-Host "Press Enter to exit" }
    exit 1
}

if (-not $NoBrowser -and $results["console-cloud @ 5174"]) {
    Write-Host ""
    Write-Host "  Opening browser: $WEB_URL" -ForegroundColor Cyan
    Start-Process $WEB_URL
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host "Tip: 'status-all.ps1' checks health; 'stop-all.bat' shuts down all services" -ForegroundColor Gray
    Write-Host "Tip: logs are under logs\ — keep the repo root clean" -ForegroundColor Gray
    Read-Host "Press Enter to exit"
}
