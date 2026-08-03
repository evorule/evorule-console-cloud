// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud 执行后端 — 联网/离线双模式类型

/**
 * 网络模式:
 *   - offline: 连本地 evorule-server(127.0.0.1:18080,loopback)
 *   - online:  连远程 evorule-server(remoteBaseUrl 可配)
 *
 * 默认 offline — 与内核 evorule-console 行为一致(本地 HTTP)
 */
export type NetMode = "offline" | "online";

/**
 * CloudHttpBackend 配置。
 *
 * mode 切换决定 baseUrl:
 *   - offline → localBaseUrl(默认 http://localhost:18080)
 *   - online  → remoteBaseUrl(用户配置)
 */
export interface CloudBackendConfig {
  mode: NetMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
}

/**
 * 本地 evorule-server 默认地址。
 *
 * 用 `localhost` 而非 `127.0.0.1` —— 与 vite dev(preview)默认 host 对齐,
 * 避免 localhost ↔ 127.0.0.1 跨 origin 触发 CORS 误判。
 * (浏览器将 localhost 与 127.0.0.1 视为不同 origin,即使解析到同一 IP)
 *
 * 注:内核 evorule-console 的 HttpBackend 默认是 127.0.0.1,但内核无联网视图,
 * 不存在跨 origin 问题;大众版有联网视图,必须用 localhost 对齐。
 */
export const DEFAULT_LOCAL_BASE_URL = "http://localhost:18080";
