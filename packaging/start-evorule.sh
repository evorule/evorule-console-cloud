#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# evorule 一键启动(macOS / Linux)
# 用法: sh start-evorule.sh   (或 macOS 双击 start-evorule.command)
# 停止: sh stop-evorule.sh
# 中文说明见 README-STARTUP.txt
set -eu
cd "$(dirname "$0")"

PORT_MAIN=18080
PORT_RULE=18081
LOG_DIR=data/logs
mkdir -p "$LOG_DIR" data/wal

echo "================================================"
echo "  evorule demo   |   http://localhost:$PORT_MAIN"
echo "================================================"
echo

# ---- 前置校验(fail-fast) ----
for bin in ./evorule-server ./evorule-rule-serve; do
    if [ ! -x "$bin" ]; then
        echo "[ERR] $bin 不存在或不可执行。" >&2
        echo "      macOS 首次使用请执行: chmod +x evorule-server evorule-rule-serve" >&2
        echo "      (若 Gatekeeper 拦截,见 README-STARTUP.txt 常见问题)" >&2
        exit 1
    fi
done

echo "[1/3] Starting governance service (evorule-rule-serve, port $PORT_RULE)..."
nohup ./evorule-rule-serve \
    --db ./data/rule.db --port "$PORT_RULE" \
    --secret evorule-demo-secret-2026 \
    --admin-user admin --admin-password evorule-demo \
    --allowed-origins "http://localhost:$PORT_MAIN,http://127.0.0.1:$PORT_MAIN" \
    > "$LOG_DIR/evorule-rule.log" 2>&1 &
echo $! > data/evorule-rule.pid

echo "[2/3] Starting main service (evorule-server, port $PORT_MAIN)..."
nohup ./evorule-server \
    --addr "127.0.0.1:$PORT_MAIN" --web-dir web --rules-dir rules \
    --service-registry service_registry.json \
    --wal-dir ./data/wal --wal-fsync \
    > "$LOG_DIR/evorule-server.log" 2>&1 &
echo $! > data/evorule-server.pid

sleep 2

echo "[3/3] Opening browser..."
(
    if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT_MAIN"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT_MAIN"
    else echo "请手动访问 http://localhost:$PORT_MAIN"
    fi
) >/dev/null 2>&1 || true

echo
echo "Done. If the browser did not open, visit http://localhost:$PORT_MAIN"
echo "To stop: sh stop-evorule.sh"
echo "Logs: $LOG_DIR/"
echo
echo "SECURITY NOTE: this demo pack ships PUBLIC default credentials"
echo "  governance login: admin / evorule-demo"
echo "For real deployments, change --admin-user, --admin-password AND"
echo "--secret in this script BEFORE first start (see README-STARTUP.txt,"
echo "section 安全提示(正式部署必读))."
