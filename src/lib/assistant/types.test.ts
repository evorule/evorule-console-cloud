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

// ============ mock sessionStorage(node 环境无;加密 Key 会话缓存用) ============
const sessionStore = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
	getItem: (key: string) => sessionStore.get(key) ?? null,
	setItem: (key: string, value: string) => void sessionStore.set(key, String(value)),
	removeItem: (key: string) => void sessionStore.delete(key),
	clear: () => void sessionStore.clear()
});

// ============ WebCrypto 兜底(node <19 无全局 crypto) ============
if (!globalThis.crypto?.subtle) {
	const { webcrypto } = await import('node:crypto');
	vi.stubGlobal('crypto', webcrypto);
}

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

	test('localStorage 持久化(明文形态:即改即存,旧版行为)', async () => {
		const { saveLlmApiKeyPlain } = await import('../config/llm-config');
		saveLlmApiKeyPlain('sk-persist-test');
		const raw = mockLocalStorage.getItem('evorule-console-cloud:llm-config');
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw!) as { apiKey: string; keyStorage: string };
		expect(parsed.apiKey).toBe('sk-persist-test');
		expect(parsed.keyStorage).toBe('plain');
	});

	test('加密形态落盘不含明文 Key(keyEnc 块)', async () => {
		const { saveLlmApiKeyEncrypted } = await import('../config/llm-config');
		const r = await saveLlmApiKeyEncrypted('sk-enc-secret', 'passphrase-123');
		expect(r.ok).toBe(true);
		const raw = mockLocalStorage.getItem('evorule-console-cloud:llm-config')!;
		const parsed = JSON.parse(raw) as {
			apiKey?: string;
			keyEnc?: { v: number; kdf: string; salt: string; iv: string; ct: string };
			keyStorage: string;
		};
		expect(parsed.keyStorage).toBe('encrypted');
		expect(parsed.apiKey).toBeUndefined(); // 明文字段绝不落盘
		expect(parsed.keyEnc).toBeTruthy();
		expect(parsed.keyEnc!.v).toBe(1);
		expect(parsed.keyEnc!.kdf).toBe('pbkdf2-sha256');
		expect(raw).not.toContain('sk-enc-secret');
	});

	test('localStorage 读取(重新加载 store;旧版明文配置自动识别为 plain)', async () => {
		// 先写入一份旧版明文配置(无 keyStorage 字段)
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
		expect(cfg.keyStorage).toBe('plain');
		expect(cfg.locked).toBe(false);
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
				channel: 'browser',
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: 'sk-xxx',
				model: 'gpt-4o-mini',
				keyStorage: 'plain',
				locked: false
			})
		).toBe(false);
	});

	test('apiKey 为空 返回 false', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				channel: 'browser',
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: '',
				model: 'gpt-4o-mini',
				keyStorage: 'plain',
				locked: false
			})
		).toBe(false);
	});

	test('apiEndpoint 为空 返回 false', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				channel: 'browser',
				provider: 'openai',
				apiEndpoint: '',
				apiKey: 'sk-xxx',
				model: 'gpt-4o-mini',
				keyStorage: 'plain',
				locked: false
			})
		).toBe(false);
	});

	test('model 为空 返回 false', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				channel: 'browser',
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: 'sk-xxx',
				model: '',
				keyStorage: 'plain',
				locked: false
			})
		).toBe(false);
	});

	test('全部完备 返回 true', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				channel: 'browser',
				provider: 'qwen',
				apiEndpoint: 'https://dashscope.aliyuncs.com/v1/chat/completions',
				apiKey: 'sk-qwen',
				model: 'qwen-plus',
				keyStorage: 'plain',
				locked: false
			})
		).toBe(true);
	});

	test('空白字符 apiKey 视为未配置(trim 后为空)', async () => {
		const { isLlmConfigured } = await import('../config/llm-config');
		expect(
			isLlmConfigured({
				enabled: true,
				channel: 'browser',
				provider: 'openai',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				apiKey: '   ',
				model: 'gpt-4o-mini',
				keyStorage: 'plain',
				locked: false
			})
		).toBe(false);
	});
});

// ============ 凭据加密生命周期(UV-178 批次B) ============

describe('凭据加密生命周期', () => {
	beforeEach(() => {
		localStorageStore.clear();
		sessionStore.clear();
		vi.resetModules();
	});

	afterEach(() => {
		localStorageStore.clear();
		sessionStore.clear();
	});

	test('saveLlmApiKeyEncrypted 校验:key-empty / passphrase-short', async () => {
		const mod = await import('../config/llm-config');
		expect((await mod.saveLlmApiKeyEncrypted('', 'passphrase-123')).ok).toBe(false);
		expect((await mod.saveLlmApiKeyEncrypted('sk-x', 'short')).ok).toBe(false);
		expect((await mod.saveLlmApiKeyEncrypted('sk-x', '       ')).ok).toBe(false);
	});

	test('加密保存 → 重载进 locked 态 → 口令解锁恢复(错误口令被拒)', async () => {
		// 1) 加密保存
		const mod1 = await import('../config/llm-config');
		updateForConfigure(mod1);
		const r = await mod1.saveLlmApiKeyEncrypted('sk-lifecycle', 'passphrase-123');
		expect(r.ok).toBe(true);
		expect(get(mod1.llmConfig).keyStorage).toBe('encrypted');
		expect(get(mod1.llmConfig).locked).toBe(false);

		// 2) 模拟新会话重载(会话缓存已清)
		sessionStore.clear();
		vi.resetModules();
		const mod2 = await import('../config/llm-config');
		const locked = get(mod2.llmConfig);
		expect(locked.locked).toBe(true);
		expect(locked.apiKey).toBe('');
		expect(mod2.isLlmConfigured(locked)).toBe(false); // 未解锁 = 未配置

		// 3) 错误口令
		const wrong = await mod2.unlockLlmApiKey('wrong-passphrase');
		expect(wrong).toEqual({ ok: false, error: 'wrong-passphrase' });
		expect(get(mod2.llmConfig).locked).toBe(true);

		// 4) 正确口令 → 解锁 + 会话缓存刷新
		const ok = await mod2.unlockLlmApiKey('passphrase-123');
		expect(ok).toEqual({ ok: true });
		const unlocked = get(mod2.llmConfig);
		expect(unlocked.locked).toBe(false);
		expect(unlocked.apiKey).toBe('sk-lifecycle');
		expect(mod2.isLlmConfigured(unlocked)).toBe(true);
		expect(sessionStore.has('evorule-console-cloud:llm-session-key')).toBe(true);

		// 5) 同会话重载 → 会话缓存自动解锁(免重输口令)
		vi.resetModules();
		const mod3 = await import('../config/llm-config');
		await new Promise((r2) => setTimeout(r2, 0)); // 自动解锁为 fire-and-forget
		await new Promise((r2) => setTimeout(r2, 0));
		const auto = get(mod3.llmConfig);
		expect(auto.locked).toBe(false);
		expect(auto.apiKey).toBe('sk-lifecycle');
	});

	test('lockLlmApiKey 立即锁定(加密块保留)', async () => {
		const mod = await import('../config/llm-config');
		updateForConfigure(mod);
		expect((await mod.saveLlmApiKeyEncrypted('sk-lock', 'passphrase-123')).ok).toBe(true);
		mod.lockLlmApiKey();
		const cfg = get(mod.llmConfig);
		expect(cfg.locked).toBe(true);
		expect(cfg.apiKey).toBe('');
		expect(cfg.keyStorage).toBe('encrypted');
		// 加密块仍在(重载可再解锁)
		const parsed = JSON.parse(
			mockLocalStorage.getItem('evorule-console-cloud:llm-config')!
		) as { keyEnc?: unknown };
		expect(parsed.keyEnc).toBeTruthy();
	});

	test('clearLlmApiKey 连同加密块与会话缓存一并清除', async () => {
		const mod = await import('../config/llm-config');
		updateForConfigure(mod);
		await mod.saveLlmApiKeyEncrypted('sk-clear', 'passphrase-123');
		mod.clearLlmApiKey();
		const cfg = get(mod.llmConfig);
		expect(cfg.keyStorage).toBe('none');
		expect(cfg.locked).toBe(false);
		expect(sessionStore.has('evorule-console-cloud:llm-session-key')).toBe(false);
		const parsed = JSON.parse(
			mockLocalStorage.getItem('evorule-console-cloud:llm-config')!
		) as { keyEnc?: unknown; apiKey?: string };
		expect(parsed.keyEnc).toBeUndefined();
		expect(parsed.apiKey).toBeUndefined();
	});

	test('损坏的 keyEnc 块按无 Key 处理(不静默造明文)', async () => {
		mockLocalStorage.setItem(
			'evorule-console-cloud:llm-config',
			JSON.stringify({
				enabled: true,
				channel: 'browser',
				apiEndpoint: 'https://x/v1/chat/completions',
				model: 'm',
				keyStorage: 'encrypted',
				keyEnc: { v: 1, kdf: 'pbkdf2-sha256', salt: '' } // 缺 iv/ct
			})
		);
		const mod = await import('../config/llm-config');
		const cfg = get(mod.llmConfig);
		expect(cfg.locked).toBe(false);
		expect(cfg.apiKey).toBe('');
		expect(cfg.keyStorage).toBe('none');
	});
});

/** 配置 browser 通道基本项(enabled+endpoint+model),配合加密保存用例 */
function updateForConfigure(mod: {
	llmConfig: typeof import('../config/llm-config').llmConfig;
	setLlmEnabled: (v: boolean) => void;
	setLlmApiEndpoint: (v: string) => void;
	setLlmModel: (v: string) => void;
}): void {
	mod.setLlmEnabled(true);
	mod.setLlmApiEndpoint('https://api.example.com/v1/chat/completions');
	mod.setLlmModel('m1');
}
