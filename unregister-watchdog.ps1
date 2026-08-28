# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# unregister-watchdog.ps1 - 注销 evorule 看门狗计划任务

$ErrorActionPreference = 'Stop'

$TASK_NAME = 'evorule-watchdog'

schtasks /delete /tn $TASK_NAME /f
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] task '$TASK_NAME' not found or delete failed (exit $LASTEXITCODE)" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] watchdog '$TASK_NAME' removed." -ForegroundColor Green
