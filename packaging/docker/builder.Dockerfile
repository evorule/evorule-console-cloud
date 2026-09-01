# syntax=docker/dockerfile:1
# evorule 组合构建基础镜像(rust 工具链 + 原生构建依赖)
# 供 scripts/build-bundle-docker.ps1 以 bind-mount 方式在容器内编译
# evorule-server workspace 与 evorule-rule-serve(Linux 二进制)。
FROM rust:1.92-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libsqlite3-dev \
    libssl-dev \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
