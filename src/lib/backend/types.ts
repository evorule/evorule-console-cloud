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
export type NetMode = 'offline' | 'online';

/**
 * CloudHttpBackend 配置。
 *
 * mode 切换决定 baseUrl:
 *   - offline → localBaseUrl(默认 http://127.0.0.1:18080)
 *   - online  → remoteBaseUrl(用户配置)
 */
export interface CloudBackendConfig {
	mode: NetMode;
	remoteBaseUrl: string;
	localBaseUrl: string;
}

/** 本地 evorule-server 默认地址(与内核 HttpBackend 默认一致) */
export const DEFAULT_LOCAL_BASE_URL = 'http://127.0.0.1:18080';
