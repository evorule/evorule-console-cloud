// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — evorule-server 基址/凭据解析单点
//
// 此前 CloudHttpBackend / CloudWorkspaceBackend / audited-llm / marketplace /
// marketplace-plugins / flow / template-render / Settings / AiPluginActivationCard
// 各自维护「同逻辑」基址解析,proxy 第三态(嵌入托管,serve 同源反向代理)只落进了
// CloudHttpBackend 单跳,其余消费者在 proxy 态直连 localhost:18080 绕过代理。
// 本模块收敛为唯一实现:新增模式/改解析规则只动这里,禁止再复制。

import { DEFAULT_LOCAL_BASE_URL, type NetMode } from './types';

/** 基址解析输入形态(NetConfig / CloudBackendConfig / CloudWorkspaceBackendConfig 均兼容) */
export interface ServerBaseConfig {
	mode: NetMode;
	remoteBaseUrl: string;
	/** offline 态基址;缺省 DEFAULT_LOCAL_BASE_URL(NetConfig 无此字段) */
	localBaseUrl?: string;
}

/**
 * 解析 evorule-server 基址(唯一实现,勿再复制):
 *   - proxy   → '/console-api'(serve 同源反向代理;相对路径 fetch 自动落当前 origin,
 *               Authorization 由 serve 服务端注入)
 *   - online  → remoteBaseUrl
 *   - offline → localBaseUrl ?? DEFAULT_LOCAL_BASE_URL
 */
export function resolveServerBaseUrl(cfg: ServerBaseConfig): string {
	if (cfg.mode === 'proxy') return '/console-api';
	const url =
		cfg.mode === 'online' ? cfg.remoteBaseUrl : (cfg.localBaseUrl ?? DEFAULT_LOCAL_BASE_URL);
	// 去掉末尾斜杠(与内核 HttpBackend 构造行为一致,避免 path 拼接出现 //)
	return url.replace(/\/+$/, '');
}

/**
 * 请求凭据解析(proxy 恒不送:token 不进页面,由 serve 代理服务端注入;
 * 其余模式透传,空 = 不带头)。
 */
export function authTokenForRequest(
	mode: NetMode,
	token: string | null | undefined
): string | null {
	return mode === 'proxy' ? null : (token ?? null);
}
