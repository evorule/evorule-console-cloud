#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# evorule 一键停止(macOS / Linux):按 pid 文件优雅终止两个后台服务
set -u
cd "$(dirname "$0")"

stopped=0
for name in evorule-server evorule-rule; do
    pidfile="data/$name.pid"
    if [ -f "$pidfile" ]; then
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            echo "[OK] stopped $name (pid $pid)"
            stopped=1
        else
            echo "[--] $name (pid $pid) 已不在运行"
        fi
        rm -f "$pidfile"
    else
        echo "[--] 未找到 $name 的 pid 文件(可能未启动)"
    fi
done

# 兜底:pid 文件丢失时按进程名+端口特征清理(仅限本脚本命名特征)
pkill -f 'evorule-rule-serve --db ./data/rule.db' 2>/dev/null && stopped=1 || true
pkill -f 'evorule-server --addr 127.0.0.1:18080' 2>/dev/null && stopped=1 || true

if [ "$stopped" -eq 1 ]; then
    echo "已停止。全部关闭后可重新运行: sh start-evorule.sh"
else
    echo "没有发现正在运行的 evorule 服务。"
fi
