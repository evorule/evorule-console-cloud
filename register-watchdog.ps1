# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# register-watchdog.ps1 - 注册 evorule 看门狗(Windows 计划任务)
#
# 作用:每 5 分钟跑一次 status-all.ps1 -AutoRestart -Quiet,
#   服务异常退出最迟 5 分钟内自动拉起,无需手动 start-all.bat。
#   计划任务启动的进程完全脱离终端生命周期,不受自动化环境
#   "30 分钟最大运行时长"限制(README-STARTUP.md 已知限制 1 的根治方案,
#   无需安装 nssm)。
#
# 用法:
#   注册:   powershell -ExecutionPolicy Bypass -File register-watchdog.ps1
#   注销:   powershell -ExecutionPolicy Bypass -File unregister-watchdog.ps1
#   查看:   schtasks /query /tn "evorule-watchdog" /v /fo LIST
#   手动触发: schtasks /run /tn "evorule-watchdog"

$ErrorActionPreference = 'Stop'

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$TASK_NAME = 'evorule-watchdog'
$STATUS_SCRIPT = Join-Path $ROOT 'status-all.ps1'

$action = "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$STATUS_SCRIPT`" -AutoRestart -Quiet"

schtasks /create /tn $TASK_NAME /sc minute /mo 5 /tr $action /f
if ($LASTEXITCODE -ne 0) { throw "schtasks create failed (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "[OK] watchdog registered: '$TASK_NAME' (every 5 min)" -ForegroundColor Green
Write-Host "  action: $action"
Write-Host ""
Write-Host "  check:    schtasks /query /tn $TASK_NAME /v /fo LIST"
Write-Host "  run now:  schtasks /run /tn $TASK_NAME"
Write-Host "  remove:   powershell -ExecutionPolicy Bypass -File unregister-watchdog.ps1"
