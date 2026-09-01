# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
<#
.SYNOPSIS
    UV-032 W2 部署验收:一体镜像 装→用→断电恢复 全流程断言

.DESCRIPTION
    前置:build-bundle-docker.ps1 已产出 evorule-bundle 镜像。
    场景:
      D1 装:容器拉起 + 双端口健康探针
      D2 用:web 静态页 / 会话创建+命令 / 审计档案入档 / 治理服务登录+鉴权读
      D3 断电恢复:docker kill(SIGKILL)→ 重启 → 健康恢复 + 审计档案回放 + 治理库存活
      D4 数据卷:WAL/SQLite/日志文件落卷核验
#>
[CmdletBinding()]
param(
    [string]$Image = "evorule-bundle:v0.1.0",
    [string]$Name = "evorule-accept",
    [string]$Volume = "evorule-accept-data",
    [int]$PortServer = 18280,
    [int]$PortRule = 18281
)

$ErrorActionPreference = 'Stop'
$script:pass = 0
$script:fail = 0

function Assert([string]$Name, [bool]$Cond, [string]$Detail = "") {
    if ($Cond) {
        $script:pass++
        Write-Host "  [PASS] $Name"
    } else {
        $script:fail++
        Write-Host "  [FAIL] $Name  $Detail" -ForegroundColor Red
    }
}

function Wait-Health([string]$Url, [int]$Sec) {
    for ($i = 0; $i -lt ($Sec * 2); $i++) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    return $false
}

$api = "http://127.0.0.1:$PortServer"
$rule = "http://127.0.0.1:$PortRule"
# server 绑 0.0.0.0 触发 fail-closed(B3),容器默认 token(见 start-bundle.sh)
$tok = @{ Authorization = 'Bearer evorule-demo-token-2026' }

# ---- 清理旧环境(存在才删,避免 stderr 被 Stop 语义放大) ----
Write-Host "`n===== 准备:清理旧容器/卷 ====="
if (docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $Name) { docker rm -f $Name | Out-Null }
if (docker volume ls --format '{{.Name}}' | Select-String -SimpleMatch $Volume) { docker volume rm $Volume | Out-Null }

# ============ D1 装 ============
Write-Host "`n===== D1 装:容器拉起 + 双端口健康 ====="
$imgExists = docker image inspect $Image 2>$null
Assert "D1.0 镜像存在($Image)" ($LASTEXITCODE -eq 0) "镜像未找到,先运行 build-bundle-docker.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }

docker run -d --name $Name -p "${PortServer}:18080" -p "${PortRule}:18081" -v "${Volume}:/data" $Image | Out-Null
Assert "D1.1 容器启动" ($LASTEXITCODE -eq 0) "docker run 失败"

$ok = Wait-Health "$api/api/health" 45
Assert "D1.2 server /api/health 就绪(45s 内)" $ok "见 docker logs $Name"
$okRule = Wait-Health "$rule/v1/health" 45
Assert "D1.3 rule-serve /v1/health 就绪(45s 内)" $okRule "见 docker logs $Name"

# ============ D2 用 ============
Write-Host "`n===== D2 用:web/会话/审计/治理 ====="
try {
    $web = Invoke-WebRequest -Uri "$api/" -UseBasicParsing -TimeoutSec 10
    Assert "D2.1 web 静态页可访问" ($web.StatusCode -eq 200 -and $web.Content -match '<html') "状态 $($web.StatusCode)"
} catch { Assert "D2.1 web 静态页可访问" $false $_.Exception.Message }

$sid = $null
try {
    $resp = Invoke-RestMethod -Uri "$api/api/sessions" -Method Post -Body '{}' -ContentType 'application/json' -Headers $tok
    $sid = if ($resp.session_id) { [int]$resp.session_id } elseif ($resp.session_new) { [int]$resp.session_new } elseif ($resp.id) { [int]$resp.id } else { $null }
    Assert "D2.2 会话创建(返回会话 ID)" ($null -ne $sid) "响应: $($resp | ConvertTo-Json -Compress)"
} catch { Assert "D2.2 会话创建" $false $_.Exception.Message }

if ($sid) {
    try {
        $body = '{"instruction":{"type":"set","params":{"attr":"uv032_probe","operation":"set","value":42}}}'
        $null = Invoke-RestMethod -Uri "$api/api/sessions/$sid/command" -Method Post -Body $body -ContentType 'application/json' -Headers $tok
        Start-Sleep -Milliseconds 800
        Assert "D2.3 规则命令执行成功" $true ""
    } catch { Assert "D2.3 规则命令执行" $false $_.Exception.Message }
}

try {
    $arch = Invoke-RestMethod -Uri "$api/api/audit-archive/sessions" -Headers $tok -UseBasicParsing -TimeoutSec 10
    $entry = $arch.sessions | Where-Object { $_.session_id -eq $sid }
    Assert "D2.4 会话 $sid 已入审计档案" ($null -ne $entry) "档案: $($arch | ConvertTo-Json -Compress -Depth 3)"
} catch { Assert "D2.4 审计档案" $false $_.Exception.Message }

$token = $null
try {
    # rule-serve 登录要求三字段:tenant_id/username/password(缺 tenant_id 会 422)
    $login = Invoke-RestMethod -Uri "$rule/v1/auth/login" -Method Post -Body '{"tenant_id":"default","username":"admin","password":"evorule-demo"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
    $token = if ($login.token) { $login.token } elseif ($login.access_token) { $login.access_token } else { $null }
    Assert "D2.5 治理服务登录(体验凭据)" ($null -ne $token -and $token.Length -gt 20) "响应: $($login | ConvertTo-Json -Compress)"
} catch { Assert "D2.5 治理服务登录" $false $_.Exception.Message }

if ($token) {
    try {
        $h = @{ Authorization = "Bearer $token" }
        $ds = Invoke-WebRequest -Uri "$rule/v1/datasets" -Headers $h -UseBasicParsing -TimeoutSec 10
        Assert "D2.6 治理服务鉴权读(/v1/datasets)" ($ds.StatusCode -eq 200) "状态 $($ds.StatusCode)"
    } catch { Assert "D2.6 治理服务鉴权读" $false $_.Exception.Message }
}

# ============ D4 数据卷核验(断电前取证) ============
Write-Host "`n===== D4 数据卷落盘核验 ====="
$ls = docker exec $Name bash -c "ls /data/wal/ 2>/dev/null; ls /data/*.db /data/logs/ 2>/dev/null" | Out-String
Assert "D4.1 WAL 会话文件落卷" ([bool]($ls -match 'session_')) "卷内容: $ls"
Assert "D4.2 治理库 rule.db 落卷" ([bool]($ls -match 'rule\.db')) "卷内容: $ls"
Assert "D4.3 服务日志落卷" ([bool]($ls -match 'evorule-server\.log')) "卷内容: $ls"

# ============ D3 断电恢复 ============
Write-Host "`n===== D3 断电恢复:kill -9(SIGKILL)→ 重启 ====="
docker kill $Name | Out-Null
Assert "D3.1 容器强杀(模拟断电)" ($LASTEXITCODE -eq 0) ""

docker start $Name | Out-Null
$ok2 = Wait-Health "$api/api/health" 45
Assert "D3.2 重启后 server 健康恢复" $ok2 "见 docker logs $Name"
$okRule2 = Wait-Health "$rule/v1/health" 45
Assert "D3.3 重启后 rule-serve 健康恢复" $okRule2 ""

if ($sid) {
    try {
        $arch2 = Invoke-RestMethod -Uri "$api/api/audit-archive/sessions" -Headers $tok -UseBasicParsing -TimeoutSec 10
        $entry2 = $arch2.sessions | Where-Object { $_.session_id -eq $sid }
        Assert "D3.4 断电前会话 $sid 审计档案可回放(重启存活)" ($null -ne $entry2 -and [int]$entry2.fact_count -gt 0) "档案: $($arch2 | ConvertTo-Json -Compress -Depth 3)"
        if ($entry2) {
            $detail = Invoke-WebRequest -Uri "$api/api/audit-archive/sessions/$sid/audit" -Headers $tok -UseBasicParsing -TimeoutSec 10
            Assert "D3.5 审计链详情 API 可读(含事实全文)" ($detail.StatusCode -eq 200) ""
        }
    } catch { Assert "D3.4/3.5 审计回放" $false $_.Exception.Message }
}

if ($token) {
    try {
        $login2 = Invoke-RestMethod -Uri "$rule/v1/auth/login" -Method Post -Body '{"tenant_id":"default","username":"admin","password":"evorule-demo"}' -ContentType 'application/json' -UseBasicParsing -TimeoutSec 10
        # 响应字段为 access_token(非 token),与 D2.5 口径一致
        $tok2 = if ($login2.token) { $login2.token } elseif ($login2.access_token) { $login2.access_token } else { $null }
        Assert "D3.6 治理库断电后可登录(rule.db 存活)" ($null -ne $tok2 -and $tok2.Length -gt 20) "响应: $($login2 | ConvertTo-Json -Compress)"
    } catch { Assert "D3.6 治理库断电后登录" $false $_.Exception.Message }
}

# ---- 清理(保留卷供人工复查,容器保留供日志检查;提示后自删) ----
Write-Host ""
Write-Host "===== 结果:PASS=$($script:pass) FAIL=$($script:fail) =====" -ForegroundColor $(if ($script:fail -eq 0) { 'Green' } else { 'Red' })
if ($script:fail -eq 0) {
    docker rm -f $Name | Out-Null
    docker volume rm $Volume | Out-Null
    Write-Host "[OK] 验收环境已清理(容器+卷)"
    exit 0
} else {
    Write-Host "[!] 存在失败,容器 $Name 与卷 $Volume 已保留供排查"
    exit 1
}
