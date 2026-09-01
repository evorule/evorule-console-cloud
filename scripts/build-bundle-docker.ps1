# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
<#
.SYNOPSIS
    evorule 单机一体 Docker 镜像构建(UV-032 W1)

.DESCRIPTION
    语义与体验包(pack-dist.ps1)同源:server + rule-serve 双服务 + web + 规则 +
    宪法 + 服务声明 + 插件清单,单镜像一键部署。
    Rust 二进制在 Linux 容器内编译(bind-mount 兄弟仓,目标/注册表走命名卷缓存,
    不污染 Windows host 的 target/);前端静态文件用 host 已有 build/ 产物
    (平台无关,与 pack-dist 前置相同)。
    组合构建原因:开发期各仓 [patch.crates-io] 指向兄弟仓本地路径,须保持
    /src/<repo> 相对布局才能在容器内解析。

    前置(与 pack-dist 相同):
      npm run build                                   (本仓,产出 build/)
    用法:
      powershell -ExecutionPolicy Bypass -File scripts\build-bundle-docker.ps1
      powershell ... -Tag evorule-bundle:v0.1.0

.EXAMPLE
    .\build-bundle-docker.ps1
#>
[CmdletBinding()]
param(
    [string]$Tag = ""
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $Tag) { $Tag = "evorule-bundle:v$version" }

$ServerRepo = "D:\evorule-server"
$RuleRepo = "D:\evorule-rule"
$CoreRepo = "D:\evorule"
$BundleRepo = "D:\evorule-bundle"
$HashRepo = "D:\evorule-hash"

# ---- 前置校验(fail-fast,缺件不构建) ----
Write-Host "=== [1/6] 前置校验 ===" -ForegroundColor Cyan
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "docker 不可用,请先启动 Docker Desktop" }
docker version --format '{{.Server.Os}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker daemon 未就绪,请先启动 Docker Desktop" }
foreach ($d in @($ServerRepo, $RuleRepo, $CoreRepo, $BundleRepo, $HashRepo)) {
    if (-not (Test-Path $d)) { throw "兄弟仓不存在: $d" }
}
foreach ($f in @("$root\build\index.html",
                 "$root\assets\evorule-rules\llm-audit-bridge.json",
                 "$root\assets\evorule-rules\demo-svc.json",
                 "$root\assets\service_registry.json",
                 "$root\assets\plugin_manifest.json",
                 "$ServerRepo\resources\core_eval.json",
                 "$ServerRepo\Cargo.lock",
                 "$RuleRepo\Cargo.lock")) {
    if (-not (Test-Path $f)) { throw "缺少前置文件: $f" }
}
Write-Host "[OK] 前置齐备(版本 $version,镜像 $Tag)"

# ---- 构建基础镜像(工具链,小上下文) ----
Write-Host "=== [2/6] 构建工具链基础镜像 evorule-builder:local ===" -ForegroundColor Cyan
docker build -f "$root\packaging\docker\builder.Dockerfile" -t evorule-builder:local "$root\packaging\docker"
if ($LASTEXITCODE -ne 0) { throw "工具链镜像构建失败" }

# ---- 容器内编译(命名卷缓存,不污染 host) ----
Write-Host "=== [3/6] 容器内编译 evorule-rule-serve ===" -ForegroundColor Cyan
docker run --rm --name evorule-build-rule `
  -v "${RuleRepo}:/src/evorule-rule" `
  -v "${BundleRepo}:/src/evorule-bundle" `
  -v "${HashRepo}:/src/evorule-hash" `
  -v evorule-docker-cargo:/usr/local/cargo `
  -v evorule-docker-target:/target `
  -e CARGO_TARGET_DIR=/target `
  evorule-builder:local `
  bash -c "cd /src/evorule-rule && cargo build --release --bin evorule-rule-serve"
if ($LASTEXITCODE -ne 0) { throw "evorule-rule-serve 容器内编译失败" }

Write-Host "=== [4/6] 容器内编译 evorule-server ===" -ForegroundColor Cyan
docker run --rm --name evorule-build-server `
  -v "${ServerRepo}:/src/evorule-server" `
  -v "${RuleRepo}:/src/evorule-rule" `
  -v "${CoreRepo}:/src/evorule" `
  -v "${BundleRepo}:/src/evorule-bundle" `
  -v "${HashRepo}:/src/evorule-hash" `
  -v evorule-docker-cargo:/usr/local/cargo `
  -v evorule-docker-target:/target `
  -e CARGO_TARGET_DIR=/target `
  evorule-builder:local `
  bash -c "cd /src/evorule-server && cargo build --release --bin evorule-server"
if ($LASTEXITCODE -ne 0) { throw "evorule-server 容器内编译失败" }

# ---- staging 组装(纯复制;staging 属 dist 产物,重建允许) ----
Write-Host "=== [5/6] staging 组装 ===" -ForegroundColor Cyan
$stage = "$root\dist\docker-staging"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path "$stage\web", "$stage\rules", "$stage\resources" -Force | Out-Null

Copy-Item "$root\packaging\docker\start-bundle.sh" "$stage\start-bundle.sh"
Copy-Item "$root\build\*" "$stage\web" -Recurse -Force
Copy-Item "$root\assets\evorule-rules\*" "$stage\rules" -Force
Copy-Item "$ServerRepo\resources\core_eval.json" "$stage\resources\core_eval.json"
Copy-Item "$root\assets\service_registry.json" "$stage\service_registry.json"
Copy-Item "$root\assets\plugin_manifest.json" "$stage\plugin_manifest.json"

# 从命名卷提取 Linux 二进制
New-Item -ItemType Directory -Path "$stage\_bin" -Force | Out-Null
docker run --rm -v evorule-docker-target:/target -v "${stage}\_bin:/out" evorule-builder:local `
  bash -c "cp /target/release/evorule-server /target/release/evorule-rule-serve /out/"
if ($LASTEXITCODE -ne 0) { throw "二进制提取失败" }
Move-Item "$stage\_bin\evorule-server" "$stage\evorule-server"
Move-Item "$stage\_bin\evorule-rule-serve" "$stage\evorule-rule-serve"
Remove-Item "$stage\_bin" -Recurse -Force

# start-bundle.sh 强制 LF(shell 脚本 CRLF 会导致容器内执行失败)
$shPath = "$stage\start-bundle.sh"
$shText = [IO.File]::ReadAllText($shPath)
if ($shText -match "`r") {
    [IO.File]::WriteAllText($shPath, ($shText -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    Write-Host "[OK] start-bundle.sh 已转换为 LF"
}

# 复制后逐项核验(文件安全规约:先验证后交付)
$expect = @{
    "$stage\evorule-server"        = 1
    "$stage\evorule-rule-serve"    = 1
    "$stage\resources\core_eval.json" = (Get-Item "$ServerRepo\resources\core_eval.json").Length
    "$stage\rules\llm-audit-bridge.json" = (Get-Item "$root\assets\evorule-rules\llm-audit-bridge.json").Length
    "$stage\rules\demo-svc.json"   = (Get-Item "$root\assets\evorule-rules\demo-svc.json").Length
    "$stage\service_registry.json" = (Get-Item "$root\assets\service_registry.json").Length
    "$stage\plugin_manifest.json"  = (Get-Item "$root\assets\plugin_manifest.json").Length
    "$stage\web\index.html"        = (Get-Item "$root\build\index.html").Length
    "$stage\start-bundle.sh"       = (Get-Item "$root\packaging\docker\start-bundle.sh").Length
}
foreach ($k in $expect.Keys) {
    if (-not (Test-Path $k)) { throw "组装核验失败(缺失): $k" }
    if ($expect[$k] -eq 1) {
        if ((Get-Item $k).Length -lt 1MB) { throw "组装核验失败(二进制过小,疑似提取失败): $k" }
    } elseif ((Get-Item $k).Length -ne $expect[$k]) { throw "组装核验失败(大小不一致): $k" }
}
Write-Host "[OK] 9 项组装核验通过"

# ---- 镜像构建(上下文 = staging,不含源码) ----
Write-Host "=== [6/6] 构建镜像 $Tag ===" -ForegroundColor Cyan
docker build -f "$root\packaging\docker\Dockerfile" -t $Tag $stage
if ($LASTEXITCODE -ne 0) { throw "镜像构建失败" }

Write-Host ""
Write-Host "=== 镜像就绪: $Tag ===" -ForegroundColor Green
Write-Host "运行:"
Write-Host "  docker run -d --name evorule -p 18080:18080 -p 18081:18081 -v evorule-data:/data $Tag"
Write-Host "验证:"
Write-Host "  curl http://localhost:18080/api/health"
Write-Host "  浏览器 http://localhost:18080 ;治理页连接 http://127.0.0.1:18081 (admin/evorule-demo)"
