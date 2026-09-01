#!/bin/bash
# evorule 一体镜像双服务启动脚本(UV-032 W1)
# 治理服务(18081)后台 + 主服务(18080)后台,tini 托管,TERM 时双进程优雅退出。
# 凭据默认与体验包一致(公开演示值),生产部署必须用环境变量覆盖(见 README-DOCKER)。
# server 绑定 0.0.0.0(容器外可达)触发 fail-closed 安全策略(B3):必须带 auth_token。
set -eu
mkdir -p /data/wal /data/logs

RULE_SECRET="${EVORULE_RULE_SECRET:-evorule-demo-secret-2026}"
RULE_ADMIN_USER="${EVORULE_RULE_ADMIN_USER:-admin}"
RULE_ADMIN_PASSWORD="${EVORULE_RULE_ADMIN_PASSWORD:-evorule-demo}"
RULE_ALLOWED_ORIGINS="${EVORULE_RULE_ALLOWED_ORIGINS:-http://localhost:18080,http://127.0.0.1:18080}"
AUTH_TOKEN="${EVORULE_AUTH_TOKEN:-evorule-demo-token-2026}"

evorule-rule-serve \
  --db /data/rule.db \
  --host 0.0.0.0 \
  --port 18081 \
  --secret "$RULE_SECRET" \
  --admin-user "$RULE_ADMIN_USER" \
  --admin-password "$RULE_ADMIN_PASSWORD" \
  --allowed-origins "$RULE_ALLOWED_ORIGINS" \
  >> /data/logs/evorule-rule.log 2>&1 &
RULE_PID=$!

evorule-server \
  --addr "${EVORULE_ADDR:-0.0.0.0:18080}" \
  --auth-token "$AUTH_TOKEN" \
  --web-dir /app/web \
  --rules-dir /app/rules \
  --service-registry /app/service_registry.json \
  --plugins /app/plugin_manifest.json \
  --wal-dir /data/wal \
  --wal-fsync \
  --log-file /data/logs/evorule-server.log &
SERVER_PID=$!

term() {
  kill -TERM "$SERVER_PID" "$RULE_PID" 2>/dev/null || true
}
trap term TERM INT

# 主服务退出码决定容器退出;治理服务独立存活(与体验包"两服务互相独立"同语义)
wait "$SERVER_PID" || STATUS=$?
STATUS=${STATUS:-0}
kill -TERM "$RULE_PID" 2>/dev/null || true
wait "$RULE_PID" 2>/dev/null || true
exit "$STATUS"
