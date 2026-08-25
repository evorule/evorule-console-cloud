// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理服务连接配置 store(Phase 2 F1)
//
// 持久化:localStorage(key: evorule-console-cloud:governance-config)
// 安全:密码随配置存 localStorage 明文(大众版可接受,与 llm-config 的 apiKey 同策略),
//      不进日志/错误/URL;页面提示"密码存于本地,不上传"。令牌(access_token)
//      不落 localStorage,仅存 GovernanceBackend 实例内存(见 governance-backend.ts)。
//
// 边界:治理数据来自 evorule-rule(:18081,规则资产库),执行数据来自
//      evorule-server(:18080,运行时),二者独立可达、互不耦合。

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface GovernanceConfig {
	/** evorule-rule REST 地址 */
	baseUrl: string;
	/** 租户 ID(evorule-rule 多租户,默认 "default") */
	tenantId: string;
	/** 登录用户名 */
	username: string;
	/** 登录密码(本地明文保存,页面有提示) */
	password: string;
}

const STORAGE_KEY = 'evorule-console-cloud:governance-config';

const DEFAULT_CONFIG: GovernanceConfig = {
	baseUrl: 'http://127.0.0.1:18081',
	tenantId: 'default',
	username: '',
	password: ''
};

function loadConfig(): GovernanceConfig {
	if (!browser) return { ...DEFAULT_CONFIG };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_CONFIG };
		const parsed = JSON.parse(raw) as Partial<GovernanceConfig>;
		return {
			baseUrl:
				typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0
					? parsed.baseUrl
					: DEFAULT_CONFIG.baseUrl,
			tenantId:
				typeof parsed.tenantId === 'string' && parsed.tenantId.length > 0
					? parsed.tenantId
					: DEFAULT_CONFIG.tenantId,
			username: typeof parsed.username === 'string' ? parsed.username : '',
			password: typeof parsed.password === 'string' ? parsed.password : ''
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export const governanceConfig = writable<GovernanceConfig>(loadConfig());

// 持久化(订阅变化即写入)
governanceConfig.subscribe((cfg) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
});

// === 便捷更新函数 ===

export function updateGovernanceConfig(patch: Partial<GovernanceConfig>): void {
	governanceConfig.update((c) => ({ ...c, ...patch }));
}

/** 重置为默认配置 */
export function resetGovernanceConfig(): void {
	governanceConfig.set({ ...DEFAULT_CONFIG });
}
