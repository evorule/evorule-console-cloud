// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 网络配置 store(联网/离线模式 + 远程 URL)
//
// 持久化:localStorage(key: evorule-console-cloud:net-config)
// 默认:offline(本地 loopback,与内核 evorule-console 一致)

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { DEFAULT_LOCAL_BASE_URL, type NetMode } from '$lib/backend/types';

export interface NetConfig {
	mode: NetMode;
	remoteBaseUrl: string;
}

const STORAGE_KEY = 'evorule-console-cloud:net-config';

const DEFAULT_CONFIG: NetConfig = {
	mode: 'offline',
	remoteBaseUrl: DEFAULT_LOCAL_BASE_URL
};

function loadConfig(): NetConfig {
	if (!browser) return DEFAULT_CONFIG;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_CONFIG;
		const parsed = JSON.parse(raw) as Partial<NetConfig>;
		return {
			mode: parsed.mode === 'online' ? 'online' : 'offline',
			remoteBaseUrl:
				typeof parsed.remoteBaseUrl === 'string' && parsed.remoteBaseUrl.length > 0
					? parsed.remoteBaseUrl
					: DEFAULT_CONFIG.remoteBaseUrl
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

/** 切换 online/offline(toggle) */
export function toggleNetMode(): void {
	netConfig.update((c) => ({ ...c, mode: c.mode === 'online' ? 'offline' : 'online' }));
}

/** 重置为默认配置 */
export function resetNetConfig(): void {
	netConfig.set({ ...DEFAULT_CONFIG });
}
