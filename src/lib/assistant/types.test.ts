// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — Phase 3 LLM 抽象 + llm-config store + 注入机制 单测
//
// 运行: npx vitest run src/lib/assistant/types.test.ts src/lib/assistant/llm-context.test.ts

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

// ============ mock $app/environment(browser=true,启用 localStorage 路径) ============
vi.mock('$app/environment', () => ({
	browser: true
}));

// ============ mock localStorage(node 环境无 localStorage) ============

const localStorageStore = new Map<string, string>();
const mockLocalStorage = {
	getItem: (key: string) => localStorageStore.get(key) ?? null,
	setItem: (key: string, value: string) => {
		localStorageStore.set(key, String(value));
	},
	removeItem: (key: string) => {
		localStorageStore.delete(key);
	},
	clear: () => {
		localStorageStore.clear();
	},
	key: (index: number) => Array.from(localStorageStore.keys())[index] ?? null,
	get length() {
		return localStorageStore.size;
	}
};

vi.stubGlobal('localStorage', mockLocalStorage);

// ============ types.ts: 默认配置 ============

describe('DEFAULT_LLM_CONFIG', () => {
	test('enabled 默认 false(与内核一致,LLM 按钮不渲染)', async () => {
		const { DEFAULT_LLM_CONFIG } = await import('./types');
		expect(DEFAULT_LLM_CONFIG.enabled).toBe(false);
	});

	test('provider 默认 openai', async () => {
		const { DEFAULT_LLM_CONFIG } = await import('./types');
		expect(DEFAULT_LLM_CONFIG.provider).toBe('openai');
	});

	test('apiEndpoint 默认 OpenAI 端点', async () => {
		const { DEFAULT_LLM_CONFIG } = await import('./types');
		expect(DEFAULT_LLM_CONFIG.apiEndpoint).toBe(
			'https://api.openai.com/v1/chat/completions'
		);
	});

	test('apiKey 默认空字符串', async () => {
		const { DEFAULT_LLM_CONFIG } = await import('./types');
		expect(DEFAULT_LLM_CONFIG.apiKey).toBe('');
	});

	test('model 默认 gpt-4o-mini', async () => {
		const { DEFAULT_LLM_CONFIG } = await import('./types');
		expect(DEFAULT_LLM_CONFIG.model).toBe('gpt-4o-mini');
	});
});

// ============ llm-config.ts: store + 持久化 + 便捷函数 ============

describe('llmConfig store', () => {
	beforeEach(() => {
		localStorageStore.clear();
		vi.resetModules();
	});

	afterEach(() => {
		localStorageStore.clear();
	});

	test('默认配置 = DEFAULT_LLM_CONFIG(enabled=false)', async () => {
		const { llmConfig } = await import('../config/llm-config');
		const { DEFAULT_LLM_CONFIG } = await import('./types');
		const cfg = get(llmConfig);
		expect(cfg.enabled).toBe(DEFAULT_LLM_CONFIG.enabled);
		expect(cfg.provider).toBe(DEFAULT_LLM_CONFIG.provider);
	});

	test('setLlmEnabled(true) 后 store 更新', async () => {
		const { llmConfig, setLlmEnabled } = await import('../config/llm-config');
		setLlmEnabled(true);
		expect(get(llmConfig).enabled).toBe(true);
	});

	test('setLlmApiKey 更新 apiKey', async () => {
		const { llmConfig, setLlmApiKey } = await import('../config/llm-config');
		setLlmApiKey('sk-test-123');
		expect(get(llmConfig).apiKey).toBe('sk-test-123');
	});

	test('setLlmApiEndpoint 去除首尾空白', async () => {
		const { llmConfig, setLlmApiEndpoint } = await import('../config/llm-config');
		setLlmApiEndpoint('  https://api.example.com/v1/chat  ');
		expect(get(llmConfig).apiEndpoint).toBe('https://api.example.com/v1/chat');
	});

	test('updateLlmConfig 一次性更新多个字段', async () => {
		const { llmConfig, updateLlmConfig } = await import('../config/llm-config');
		updateLlmConfig({
			provider: 'qwen',
			apiEndpoint: 'https://dashscope.aliyuncs.com/v1/chat/completions',
			apiKey: 'sk-qwen',
			model: 'qwen-plus'
		});
		const cfg = get(llmConfig);
		expect(cfg.provider).toBe('qwen');
		expect(cfg.apiEndpoint).toContain('dashscope');
		expect(cfg.apiKey).toBe('sk-qwen');
		expect(cfg.model).toBe('qwen-plus');
	});

	test('resetLlmConfig 清空所有字段(enabled=false + apiKey="")', async () => {
		const { llmConfig, setLlmApiKey, setLlmEnabled, resetLlmConfig } = await import(
			'../config/llm-config'
		);
		setLlmApiKey('sk-xxx');
		setLlmEnabled(true);
		resetLlmConfig();
		const cfg = get(llmConfig);
		expect(cfg.enabled).toBe(false);
		expect(cfg.apiKey).toBe('');
	});

	test('clearLlmApiKey 只清 apiKey,保留其他', async () => {
		const { llmConfig, updateLlmConfig, clearLlmApiKey } = await import(
			'../config/llm-config'
		);
		updateLlmConfig({ apiKey: 'sk-secret', model: 'qwen-plus' });
		clearLlmApiKey();
		const cfg = get(llmConfig);
		expect(cfg.apiKey).toBe('');
		expect(cfg.model).toBe('qwen-plus');
	});

	test('localStorage 持久化(更新后写入)', async () => {
		const { setLlmApiKey } = await import('../config/llm-config');
		setLlmApiKey('sk-persist-test');
		const raw = mockLocalStorage.getItem('evorule-console-cloud:llm-config');
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw!) as { apiKey: string };
		expect(parsed.apiKey).toBe('sk-persist-test');
	});

	test('localStorage 读取(重新加载 store)', async () => {
		// 先写入一份配置
		mockLocalStorage.setItem(
			'evorule-console-cloud:llm-config',
			JSON.stringify({
				enabled: true,
				provider: 'glm',
				apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
				apiKey: 'sk-glm-xxx',
				model: 'glm-4-flash'
			})
		);

		// 重新加载 store
		const { llmConfig } = await import('../config/llm-config');
		const cfg = get(llmConfig);
		expect(cfg.enabled).toBe(true);
		expect(cfg.provider).toBe('glm');
		expect(cfg.apiEndpoint).toContain('bigmodel');
		expect(cfg.apiKey).toBe('sk-glm-xxx');
		expect(cfg.model).toBe('glm-4-flash');
	});

	test('localStorage 损坏时返回默认配置', async () => {
		mockLocalStorage.setItem('evorule-console-cloud:llm-config', 'not-json');
		const { llmConfig } = await import('../config/llm-config');
		expect(get(llmConfig).enabled).toBe(false);
	});
});

// ============ isLlmConfigured 形式完备性检查 ============

describe('isLlmConfigured', () => {
	test('enabled=false 返回 false(即使其他字段完备)', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: false,
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: 'sk-xxx',
				model: 'gpt-4o-mini'
			})
		).toBe(false);
	});

	test('apiKey 为空 返回 false', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: '',
				model: 'gpt-4o-mini'
			})
		).toBe(false);
	});

	test('apiEndpoint 为空 返回 false', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				provider: 'openai',
				apiEndpoint: '',
				apiKey: 'sk-xxx',
				model: 'gpt-4o-mini'
			})
		).toBe(false);
	});

	test('model 为空 返回 false', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: 'sk-xxx',
				model: ''
			})
		).toBe(false);
	});

	test('全部完备 返回 true', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				provider: 'qwen',
				apiEndpoint: 'https://dashscope.aliyuncs.com/v1/chat/completions',
				apiKey: 'sk-qwen',
				model: 'qwen-plus'
			})
		).toBe(true);
	});

	test('空白字符 apiKey 视为未配置(trim 后为空)', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: '   ',
				model: 'gpt-4o-mini'
			})
		).toBe(false);
	});
});
