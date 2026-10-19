// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 网络配置 store(联网/离线模式 + 远程 URL)
//
// 持久化:localStorage(key: evorule-console-cloud:net-config)
// 默认:offline(本地 loopback,与内核 evorule-console 一致)

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { base } from '$app/paths';
import { DEFAULT_LOCAL_BASE_URL, type NetMode } from '$lib/backend/types';

export interface NetConfig {
	mode: NetMode;
	remoteBaseUrl: string;
	/**
	 * Bearer token(evorule-server `EVORULE_AUTH_TOKEN`)。
	 *
	 * 旁路 store 收敛专项(2026-08-28):server 开启认证后,workspace/发布队列/
	 * 生产状态等端点均需凭据。localStorage 持久化(与 mode/baseUrl 同级)——
	 * 安全取舍:面向内网单机部署场景,XSS 可读取此凭据(代码明示,不隐藏)。
	 * 留空 = 不带 Authorization 头(仅免认证 server / dev 模式可用)。
	 * proxy 模式不使用本字段(凭据由 serve 代理服务端注入)。
	 */
	authToken: string;
}

const STORAGE_KEY = 'evorule-console-cloud:net-config';

/** 嵌入托管态判定:构建期 base path 非根(如 /console)= 被 serve 同源托管 */
const EMBEDDED = base !== '' && base !== '/';

const DEFAULT_CONFIG: NetConfig = {
	// 嵌入态缺省 proxy(同源反向代理,免 CORS、token 不进页面);
	// 独立部署缺省 offline(与内核 evorule-console 行为一致)
	mode: EMBEDDED ? 'proxy' : 'offline',
	remoteBaseUrl: DEFAULT_LOCAL_BASE_URL,
	authToken: ''
};

function loadConfig(): NetConfig {
	if (!browser) return DEFAULT_CONFIG;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_CONFIG;
		const parsed = JSON.parse(raw) as Partial<NetConfig>;
		return {
			// 显式有效配置(含 offline)一律尊重;无效/缺位按嵌入态分派缺省
			mode:
				parsed.mode === 'online' || parsed.mode === 'proxy' || parsed.mode === 'offline'
					? parsed.mode
					: EMBEDDED
						? 'proxy'
						: 'offline',
			remoteBaseUrl:
				typeof parsed.remoteBaseUrl === 'string' && parsed.remoteBaseUrl.length > 0
					? parsed.remoteBaseUrl
					: DEFAULT_CONFIG.remoteBaseUrl,
			authToken: typeof parsed.authToken === 'string' ? parsed.authToken : ''
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}

export const netConfig = writable<NetConfig>(loadConfig());

// 持久化(订阅变化即写入)
netConfig.subscribe((cfg) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
});

// === 便捷更新函数 ===

export function setNetMode(mode: NetMode): void {
	netConfig.update((c) => ({ ...c, mode }));
}

export function setRemoteBaseUrl(url: string): void {
	netConfig.update((c) => ({ ...c, remoteBaseUrl: url.trim() }));
}

/** 更新认证 token(设置面板输入;空串 = 不带 Authorization 头) */
export function setAuthToken(token: string): void {
	netConfig.update((c) => ({ ...c, authToken: token.trim() }));
}

/** 切换 online/offline(toggle;proxy 模式不参与 toggle,经 Settings 面板切换) */
export function toggleNetMode(): void {
	netConfig.update((c) => ({
		...c,
		mode: c.mode === 'online' ? 'offline' : c.mode === 'offline' ? 'online' : c.mode
	}));
}

/** 重置为默认配置 */
export function resetNetConfig(): void {
	netConfig.set({ ...DEFAULT_CONFIG });
}
