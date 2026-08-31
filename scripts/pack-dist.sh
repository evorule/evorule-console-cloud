#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# evorule-console-cloud 一键启动分发包打包脚本(macOS / Linux)
#
# 对应 Windows 侧 scripts/pack-dist.ps1;组装口径一致(全部为复制,不删源):
#   evorule-server           <- evorule-server release 构建(运行时 :18080)
#   evorule-rule-serve       <- evorule-rule release 构建(治理 :18081)
#   web/                     <- 本仓 adapter-static 产物(build/)
#   rules/                   <- 本仓 assets/evorule-rules/
#   resources/core_eval.json <- evorule-server 仓 TCB 宪法
#   plugin_manifest.json     <- 插件清单缺省文件(全启用;部署方可编辑裁剪,UV-033)
#   start-evorule.sh / stop-evorule.sh / README-STARTUP.txt
#
# 用法(先完成三处构建,在目标平台本机执行):
#   cargo build --release -p evorule-server        (在 evorule-server 仓)
#   cargo build --release --bin evorule-rule-serve (在 evorule-rule 仓)
#   npm run build                                  (在本仓)
#   sh scripts/pack-dist.sh --platform linux64 \
#      --server-bin ../evorule-server/target/release/evorule-server \
#      --rule-bin ../evorule-rule/target/release/evorule-rule-serve
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SERVER_BIN=""
RULE_BIN=""
CORE_EVAL="../evorule-server/resources/core_eval.json"
PLATFORM=""

while [ $# -gt 0 ]; do
    case "$1" in
        --platform) PLATFORM="$2"; shift 2 ;;
        --server-bin) SERVER_BIN="$2"; shift 2 ;;
        --rule-bin) RULE_BIN="$2"; shift 2 ;;
        --core-eval) CORE_EVAL="$2"; shift 2 ;;
        *) echo "未知参数: $1" >&2; exit 1 ;;
    esac
done

case "$PLATFORM" in
    linux64) ;;
    macos64) ;;
    *) echo "--platform 必须为 linux64 或 macos64" >&2; exit 1 ;;
esac

# ---- 前置校验(fail-fast,缺件不打包) ----
for f in "$SERVER_BIN" "$RULE_BIN" "$CORE_EVAL" \
         "$ROOT/build/index.html" \
         "$ROOT/assets/evorule-rules/llm-audit-bridge.json" \
         "$ROOT/assets/evorule-rules/demo-svc.json" \
         "$ROOT/assets/service_registry.json" \
         "$ROOT/assets/plugin_manifest.json" \
         "$ROOT/packaging/start-evorule.sh" \
         "$ROOT/packaging/stop-evorule.sh" \
         "$ROOT/packaging/README-STARTUP.txt"; do
    if [ ! -f "$f" ]; then
        echo "[ERR] 缺少前置文件: $f (是否已完成 release 构建 / npm run build?)" >&2
        exit 1
    fi
done

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)
STAGE_NAME="evorule-console-cloud-v$VERSION-$PLATFORM"
STAGE="$ROOT/dist/$STAGE_NAME"

# ---- 组装(纯复制;stage 目录属 dist 产物,重建允许) ----
rm -rf "$STAGE"
mkdir -p "$STAGE/web" "$STAGE/rules" "$STAGE/resources"

cp "$SERVER_BIN" "$STAGE/evorule-server"
cp "$RULE_BIN" "$STAGE/evorule-rule-serve"
cp -R "$ROOT/build/." "$STAGE/web"
cp "$ROOT/assets/evorule-rules/"* "$STAGE/rules"
cp "$CORE_EVAL" "$STAGE/resources/core_eval.json"
cp "$ROOT/assets/service_registry.json" "$STAGE/service_registry.json"
cp "$ROOT/assets/plugin_manifest.json" "$STAGE/plugin_manifest.json"
cp "$ROOT/packaging/start-evorule.sh" "$STAGE/start-evorule.sh"
cp "$ROOT/packaging/stop-evorule.sh" "$STAGE/stop-evorule.sh"
chmod +x "$STAGE/start-evorule.sh" "$STAGE/stop-evorule.sh" \
         "$STAGE/evorule-server" "$STAGE/evorule-rule-serve"
if [ "$PLATFORM" = "macos64" ]; then
    if [ ! -f "$ROOT/packaging/start-evorule.command" ]; then
        echo "[ERR] 缺少前置文件: packaging/start-evorule.command" >&2
        exit 1
    fi
    cp "$ROOT/packaging/start-evorule.command" "$STAGE/start-evorule.command"
    chmod +x "$STAGE/start-evorule.command"
fi
cp "$ROOT/packaging/README-STARTUP.txt" "$STAGE/README-STARTUP.txt"

# ---- 复制后逐项核验(文件安全规约:先验证后交付) ----
check() {
    src=$1; dst=$2
    if [ ! -f "$dst" ]; then echo "[ERR] 复制核验失败(目标缺失): $dst" >&2; exit 1; fi
    if [ "$(wc -c < "$src")" -ne "$(wc -c < "$dst")" ]; then
        echo "[ERR] 复制核验失败(大小不一致): $dst" >&2
        exit 1
    fi
}
check "$SERVER_BIN" "$STAGE/evorule-server"
check "$RULE_BIN" "$STAGE/evorule-rule-serve"
check "$CORE_EVAL" "$STAGE/resources/core_eval.json"
check "$ROOT/assets/evorule-rules/llm-audit-bridge.json" "$STAGE/rules/llm-audit-bridge.json"
check "$ROOT/assets/evorule-rules/demo-svc.json" "$STAGE/rules/demo-svc.json"
check "$ROOT/assets/service_registry.json" "$STAGE/service_registry.json"
check "$ROOT/assets/plugin_manifest.json" "$STAGE/plugin_manifest.json"
check "$ROOT/build/index.html" "$STAGE/web/index.html"
check "$ROOT/packaging/start-evorule.sh" "$STAGE/start-evorule.sh"
check "$ROOT/packaging/stop-evorule.sh" "$STAGE/stop-evorule.sh"
check "$ROOT/packaging/README-STARTUP.txt" "$STAGE/README-STARTUP.txt"
echo "[OK] 11 项关键文件复制核验通过"

# ---- 打 tar.gz ----
cd "$ROOT/dist"
TARBALL="$STAGE_NAME.tar.gz"
rm -f "$TARBALL"
tar -czf "$TARBALL" "$STAGE_NAME"
echo "[OK] 分发包就绪: $ROOT/dist/$TARBALL ($(du -h "$TARBALL" | cut -f1))"
echo "     解压后运行: sh start-evorule.sh (停止: sh stop-evorule.sh)"
