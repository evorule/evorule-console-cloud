# syntax=docker/dockerfile:1
# evorule 单机一体镜像(server + rule-serve 双服务,UV-032 W1)
#
# 构建:scripts/build-bundle-docker.ps1(组装 staging 目录后调用本文件;
#      构建上下文 = staging 目录,不含任何源码,Rust 二进制在容器内编译产出)
# 运行:docker run -d -p 18080:18080 -p 18081:18081 -v evorule-data:/data evorule-bundle
#
# 语义与体验包(pack-dist)一致:
#   - evorule-server  :18080 主服务(web/rules/宪法/服务声明同包内布局)
#   - evorule-rule-serve :18081 治理服务(规则资产库)
#   - /data 卷持久化全部数据(wal/SQLite/日志),容器重建数据不丢
#   - 双进程由 tini + start-bundle.sh 托管,停机时两进程均收 SIGTERM
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
    bash \
    && rm -rf /var/lib/apt/lists/*
# 注:不装 libsqlite3-0——双二进制经 rusqlite bundled 特性静态内嵌 SQLite,
# ldd 实证无 libsqlite3 动态依赖(UV-041,2026-09-02 清理)

COPY evorule-server /usr/local/bin/evorule-server
COPY evorule-rule-serve /usr/local/bin/evorule-rule-serve
COPY start-bundle.sh /app/start-bundle.sh
COPY web/ /app/web/
COPY rules/ /app/rules/
COPY resources/ /app/resources/
COPY service_registry.json /app/service_registry.json
COPY plugin_manifest.json /app/plugin_manifest.json

RUN chmod +x /usr/local/bin/evorule-server /usr/local/bin/evorule-rule-serve /app/start-bundle.sh \
    && useradd -r -u 1000 -m -d /home/evorule -s /usr/sbin/nologin evorule \
    && mkdir -p /data \
    && chown -R evorule:evorule /data /app

# 数据卷:WAL / SQLite 库 / 日志全部落在 /data
VOLUME ["/data"]

EXPOSE 18080 18081

WORKDIR /app
USER 1000

ENV EVORULE_ADDR=0.0.0.0:18080
# SQLite 库与 memory 目录入数据卷(否则落在容器层 /app/data,容器删除即丢)
ENV EVORULE_DB_PATH=/data/evorule.db
ENV EVORULE_MEMORY_DIR=/data/memory

# tini 作 PID 1:正确转发 SIGTERM,双服务优雅退出
ENTRYPOINT ["/usr/bin/tini", "--", "/app/start-bundle.sh"]
