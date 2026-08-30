# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# evorule-console-cloud 一键启动分发包打包脚本
#
# 组装内容(全部为复制,不删源;符合文件安全规约):
#   evorule-server.exe      <- evorule-server release 构建
#   web/                    <- 本仓 adapter-static 产物(build/)
#   rules/                  <- 本仓 assets/evorule-rules/(LLM 审计桥剧本)
#   resources/core_eval.json <- evorule-server 仓 TCB 宪法(server 默认路径 ./resources/)
#   start-evorule.bat       <- packaging/ 启动脚本
#   README-STARTUP.txt      <- packaging/ 使用说明
#
# 用法(先完成两处构建):
#   cargo build --release -p evorule-server   (在 D:\evorule-server)
#   npm run build                             (在本仓)
#   powershell -ExecutionPolicy Bypass -File scripts\pack-dist.ps1 [-ServerExe <路径>]

param(
    [string]$ServerExe = "D:\evorule-server\target\release\evorule-server.exe",
    [string]$CoreEval = "D:\evorule-server\resources\core_eval.json"
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stageName = "evorule-console-cloud-v$version-win64"
$stage = "$root\dist\$stageName"

# ---- 前置校验(fail-fast,缺件不打包) ----
foreach ($f in @($ServerExe, $CoreEval, "$root\build\index.html", "$root\assets\evorule-rules\llm-audit-bridge.json",
                 "$root\packaging\start-evorule.bat", "$root\packaging\README-STARTUP.txt")) {
    if (-not (Test-Path $f)) { throw "缺少前置文件: $f (是否已完成 release 构建 / npm run build?)" }
}

# ---- 组装(纯复制;stage 目录属 dist 产物,重建允许) ----
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path "$stage\web", "$stage\rules", "$stage\resources" -Force | Out-Null

Copy-Item $ServerExe "$stage\evorule-server.exe"
Copy-Item "$root\build\*" "$stage\web" -Recurse -Force
Copy-Item "$root\assets\evorule-rules\*" "$stage\rules" -Force
Copy-Item $CoreEval "$stage\resources\core_eval.json"
Copy-Item "$root\packaging\start-evorule.bat" "$stage\start-evorule.bat"
Copy-Item "$root\packaging\README-STARTUP.txt" "$stage\README-STARTUP.txt"

# ---- 复制后逐项核验(文件安全规约:先验证后交付) ----
$expect = @{
    "$stage\evorule-server.exe"          = (Get-Item $ServerExe).Length
    "$stage\resources\core_eval.json"    = (Get-Item $CoreEval).Length
    "$stage\rules\llm-audit-bridge.json" = (Get-Item "$root\assets\evorule-rules\llm-audit-bridge.json").Length
    "$stage\web\index.html"              = (Get-Item "$root\build\index.html").Length
    "$stage\start-evorule.bat"           = (Get-Item "$root\packaging\start-evorule.bat").Length
    "$stage\README-STARTUP.txt"          = (Get-Item "$root\packaging\README-STARTUP.txt").Length
}
foreach ($k in $expect.Keys) {
    if (-not (Test-Path $k)) { throw "复制核验失败(目标缺失): $k" }
    if ((Get-Item $k).Length -ne $expect[$k]) { throw "复制核验失败(大小不一致): $k" }
}
Write-Host "[OK] 6 项关键文件复制核验通过"

# ---- 打 zip ----
$zip = "$root\dist\$stageName.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
$zipSize = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "[OK] 分发包就绪: $zip ($zipSize MB)"
Write-Host "     解压后双击 start-evorule.bat 即可一键启动"
