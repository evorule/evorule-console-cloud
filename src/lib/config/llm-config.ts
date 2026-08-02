// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 配置 store(enabled + endpoint + key + model)
//
// 持久化:localStorage(key: evorule-console-cloud:llm-config)
// 默认:enabled=false(与内核 evorule-console 一致,LLM 按钮不渲染)
//
// 安全:
//   - apiKey 存在 localStorage 明文(大众版可接受)
//   - 不进日志/错误/URL(由 cloud-llm-assistant.ts 保证)
//   - 设置面板提示"key 存于本地,不上传"
//
// 与内核边界:本 store 是大众版独有的,内核不感知。

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
	DEFAULT_LLM_CONFIG,
	type CloudLlmConfig
} from '$lib/assistant/types';

const STORAGE_KEY = 'evorule-console-cloud:llm-config';

function loadConfig(): CloudLlmConfig {
	if (!browser) return { ...DEFAULT_LLM_CONFIG };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_LLM_CONFIG };
		const parsed = JSON.parse(raw) as Partial<CloudLlmConfig>;
		return {
			enabled: parsed.enabled === true,
			provider:
				typeof parsed.provider === 'string' && parsed.provider.length > 0
					? parsed.provider
					: DEFAULT_LLM_CONFIG.provider,
			apiEndpoint:
				typeof parsed.apiEndpoint === 'string' && parsed.apiEndpoint.length > 0
					? parsed.apiEndpoint
					: DEFAULT_LLM_CONFIG.apiEndpoint,
			apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
			model:
				typeof parsed.model === 'string' && parsed.model.length > 0
					? parsed.model
					: DEFAULT_LLM_CONFIG.model
		};
	} catch {
		return { ...DEFAULT_LLM_CONFIG };
	}
}

export const llmConfig = writable<CloudLlmConfig>(loadConfig());

// 持久化(订阅变化即写入)
llmConfig.subscribe((cfg) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
});

// === 便捷更新函数 ===

export function setLlmEnabled(enabled: boolean): void {
	llmConfig.update((c) => ({ ...c, enabled }));
}

export function setLlmProvider(provider: string): void {
	llmConfig.update((c) => ({ ...c, provider }));
}

export function setLlmApiEndpoint(apiEndpoint: string): void {
	llmConfig.update((c) => ({ ...c, apiEndpoint: apiEndpoint.trim() }));
}

export function setLlmApiKey(apiKey: string): void {
	llmConfig.update((c) => ({ ...c, apiKey }));
}

export function setLlmModel(model: string): void {
	llmConfig.update((c) => ({ ...c, model: model.trim() }));
}

/** 一次性更新多个字段(用于切换厂商预设) */
export function updateLlmConfig(patch: Partial<CloudLlmConfig>): void {
	llmConfig.update((c) => ({ ...c, ...patch }));
}

/** 重置为默认配置(enabled=false + 清空 apiKey) */
export function resetLlmConfig(): void {
	llmConfig.set({ ...DEFAULT_LLM_CONFIG });
}

/** 清空 apiKey(保留其他配置) */
export function clearLlmApiKey(): void {
	llmConfig.update((c) => ({ ...c, apiKey: '' }));
}

/**
 * 检查配置是否完备(用于决定是否注入 provider)。
 *
 * 完备 = enabled && apiEndpoint 非空 && apiKey 非空 && model 非空
 *
 * 注意:此处只做"形式完备性"检查,不验证 apiKey 是否有效。
 * apiKey 有效性由 testConnection() 在用户主动测试时验证。
 */
export function isLlmConfigured(cfg: CloudLlmConfig): boolean {
	return (
		cfg.enabled &&
		cfg.apiEndpoint.trim().length > 0 &&
		cfg.apiKey.trim().length > 0 &&
		cfg.model.trim().length > 0
	);
}
