// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理服务连接配置 store(Phase 2 F1)
//
// 持久化:localStorage(key: evorule-console-cloud:governance-config)
// 安全:密码随配置存 localStorage 明文(大众版可接受;UV-178 批次B 后 llm-config
//      的 apiKey 已升级为缺省加密存储,本处明文为已知遗留,待用户裁定是否跟进),
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

/**
 * 默认治理地址按运行形态分派(2026-09-06 CORS 环境坑修复):
 * - dev(vite :5174):相对路径 /rule-serve,经 vite 开发代理转发到 127.0.0.1:18081
 *   (同源请求,浏览器 CORS 不参与)——rule-serve 无需为 dev 端口追加白名单,
 *   保持其 --allowed-origins 原参即可;
 * - 生产构建:直连 http://127.0.0.1:18081(打包启动参数已配套 --allowed-origins);
 * - SSR/测试(browser=false):真实 URL(SvelteKit SSR 相对 fetch 不可用;虽不会在
 *   SSR 期发起治理请求,仍以真实 URL 保持初始态确定性)。
 */
function defaultBaseUrl(): string {
	if (browser && import.meta.env.DEV) return '/rule-serve';
	return 'http://127.0.0.1:18081';
}

const DEFAULT_CONFIG: GovernanceConfig = {
	baseUrl: 'http://127.0.0.1:18081', // 由 defaultBaseUrl() 分派,见下方 loadConfig
	tenantId: 'default',
	username: '',
	password: ''
};

function loadConfig(): GovernanceConfig {
	const fallback: GovernanceConfig = { ...DEFAULT_CONFIG, baseUrl: defaultBaseUrl() };
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return fallback;
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
		return fallback;
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
