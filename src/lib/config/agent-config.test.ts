// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — agent-config 连接配置与 Token 加密存储 单测
//
// 运行: npx vitest run src/lib/config/agent-config.test.ts
// 说明: store 是模块单例(loadConfig 在 import 期执行),每个用例经
//       vi.resetModules() + 动态 import 重放模块初始化,先种 localStorage。

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---- WebCrypto 兜底(node <19 无全局 crypto) ----
if (!globalThis.crypto?.subtle) {
	const { webcrypto } = await import('node:crypto');
	vi.stubGlobal('crypto', webcrypto);
}

// ---- localStorage/sessionStorage 桩(node 环境无) ----
const localStore = new Map<string, string>();
const sessionStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => localStore.get(k) ?? null,
	setItem: (k: string, v: string) => void localStore.set(k, String(v)),
	removeItem: (k: string) => void localStore.delete(k),
	clear: () => void localStore.clear()
});
vi.stubGlobal('sessionStorage', {
	getItem: (k: string) => sessionStore.get(k) ?? null,
	setItem: (k: string, v: string) => void sessionStore.set(k, String(v)),
	removeItem: (k: string) => void sessionStore.delete(k),
	clear: () => void sessionStore.clear()
});

// 浏览器态(走 loadConfig/持久化/auto-unlock 全路径)
vi.mock('$app/environment', () => ({ browser: true }));

const STORAGE_KEY = 'evorule-console-cloud:agent-config';
const AGENT_SESSION_KEY = 'evorule-console-cloud:agent-session-key';

const TOKEN = 'agent-secret-token';
const PASS = 'correct-horse-battery';

beforeEach(() => {
	vi.resetModules();
	localStore.clear();
	sessionStore.clear();
});

/** 重放模块初始化(先种 localStorage 再动态 import) */
async function loadModule() {
	return await import('./agent-config');
}

/** 读当前持久化 JSON */
function persisted(): Record<string, unknown> {
	const raw = localStore.get(STORAGE_KEY);
	expect(raw).toBeTruthy();
	return JSON.parse(raw as string) as Record<string, unknown>;
}

/** 用真实 WebCrypto 造一个合法加密块(与 key-crypto 同构) */
async function makeBlob(plain: string, passphrase: string) {
	const { encryptApiKey } = await import('./key-crypto');
	return encryptApiKey(plain, passphrase);
}

describe('loadConfig 存储形态识别', () => {
	test('无存储 → 缺省禁用 + 默认端口 + none 不锁定', async () => {
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.enabled).toBe(false);
		expect(cfg.baseUrl).toBe('http://127.0.0.1:8081');
		expect(cfg.tokenStorage).toBe('none');
		expect(cfg.locked).toBe(false);
		expect(cfg.authToken).toBe('');
	});

	test('已启用 + baseUrl + 遗留明文 Token → 自动识别 plain,行为不变', async () => {
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ enabled: true, baseUrl: 'http://127.0.0.1:9000', authToken: TOKEN })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.enabled).toBe(true);
		expect(cfg.baseUrl).toBe('http://127.0.0.1:9000');
		expect(cfg.tokenStorage).toBe('plain');
		expect(cfg.authToken).toBe(TOKEN);
		expect(cfg.locked).toBe(false);
		// plain 模式编辑即持久化
		m.setAgentToken(TOKEN + '2');
		expect(persisted().authToken).toBe(TOKEN + '2');
	});

	test('加密块配置 → locked 未解锁,Token 运行时空', async () => {
		const blob = await makeBlob(TOKEN, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ enabled: true, tokenEnc: blob, tokenStorage: 'encrypted' })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.tokenStorage).toBe('encrypted');
		expect(cfg.locked).toBe(true);
		expect(cfg.authToken).toBe('');
	});

	test('加密块损坏(形态非法) → 按无块处理,不虚构明文', async () => {
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ enabled: true, tokenEnc: { v: 2 }, tokenStorage: 'encrypted' })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.tokenStorage).toBe('none');
		expect(cfg.authToken).toBe('');
	});

	test('加密态下遗留明文字段一律忽略(不静默回落明文)', async () => {
		const blob = await makeBlob(TOKEN, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ enabled: true, tokenEnc: blob, authToken: 'stale-plain' })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.tokenStorage).toBe('encrypted');
		expect(cfg.locked).toBe(true);
		expect(cfg.authToken).toBe('');
	});

	test('none 模式输入 Token 仅运行时,不落盘', async () => {
		const m = await loadModule();
		m.setAgentToken(TOKEN);
		expect(persisted().authToken).toBeUndefined();
		const { get } = await import('svelte/store');
		expect(get(m.agentConfig).authToken).toBe(TOKEN);
	});

	test('非法/缺省字段回退默认(baseUrl 空串 → 默认端口;enabled 非布尔 → false)', async () => {
		localStore.set(STORAGE_KEY, JSON.stringify({ enabled: 'yes', baseUrl: '' }));
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.enabled).toBe(false);
		expect(cfg.baseUrl).toBe('http://127.0.0.1:8081');
	});
});

describe('加密保存 / 解锁 / 锁定 / 清除 回环', () => {
	test('加密保存 → 块落盘无明文;口令解锁成功;错误口令拒绝', async () => {
		const m = await loadModule();
		m.setAgentToken(TOKEN);
		const save = await m.saveAgentTokenEncrypted(TOKEN, PASS);
		expect(save).toEqual({ ok: true });
		const p = persisted();
		expect(p.tokenEnc).toBeTruthy();
		expect(p.authToken).toBeUndefined();
		const { get } = await import('svelte/store');
		expect(get(m.agentConfig).tokenStorage).toBe('encrypted');
		expect(get(m.agentConfig).authToken).toBe(TOKEN); // 保存后运行时可用
		// 会话密钥缓存进 agent 作用域(与 llm/governance 隔离)
		expect(sessionStore.has(AGENT_SESSION_KEY)).toBe(true);

		// 锁定 → 运行时空 + locked + 清会话缓存
		m.lockAgentToken();
		expect(get(m.agentConfig).locked).toBe(true);
		expect(get(m.agentConfig).authToken).toBe('');
		expect(sessionStore.has(AGENT_SESSION_KEY)).toBe(false);
		const unlock1 = await m.unlockAgentToken('');
		expect(unlock1).toEqual({ ok: false, error: 'wrong-passphrase' });

		// 清会话缓存后:错误口令拒绝 / 正确口令解锁
		sessionStore.clear();
		const unlock2 = await m.unlockAgentToken('wrong-passphrase');
		expect(unlock2).toEqual({ ok: false, error: 'wrong-passphrase' });
		const unlock3 = await m.unlockAgentToken(PASS);
		expect(unlock3).toEqual({ ok: true });
		expect(get(m.agentConfig).authToken).toBe(TOKEN);
	});

	test('口令过短 / 空 Token → 拒绝且不落块', async () => {
		const m = await loadModule();
		m.setAgentToken(TOKEN);
		expect(await m.saveAgentTokenEncrypted(TOKEN, 'short')).toEqual({
			ok: false,
			error: 'passphrase-short'
		});
		expect(await m.saveAgentTokenEncrypted('', PASS)).toEqual({
			ok: false,
			error: 'token-empty'
		});
		expect(persisted().tokenEnc).toBeUndefined();
	});

	test('显式明文保存 → plain 落盘;空 Token 视为清除', async () => {
		const m = await loadModule();
		m.setAgentToken(TOKEN);
		m.saveAgentTokenPlain(TOKEN);
		expect(persisted().authToken).toBe(TOKEN);
		const { get } = await import('svelte/store');
		expect(get(m.agentConfig).tokenStorage).toBe('plain');
		m.saveAgentTokenPlain('');
		expect(get(m.agentConfig).tokenStorage).toBe('none');
	});

	test('clearAgentToken → none,持久化无 Token 无块;unlock 无块如实拒绝', async () => {
		const blob = await makeBlob(TOKEN, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ enabled: true, tokenEnc: blob, tokenStorage: 'encrypted' })
		);
		const m = await loadModule();
		m.clearAgentToken();
		const p = persisted();
		expect(p.tokenEnc).toBeUndefined();
		expect(p.authToken).toBeUndefined();
		expect(await m.unlockAgentToken(PASS)).toEqual({
			ok: false,
			error: 'no-encrypted-token'
		});
	});

	test('本会话自动解锁:种加密块+agent 作用域会话密钥缓存 → 加载即静默解锁', async () => {
		const blob = await makeBlob(TOKEN, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ enabled: true, tokenEnc: blob, tokenStorage: 'encrypted' })
		);
		const kc = await import('./key-crypto');
		await kc.cacheSessionKey(blob, PASS, 'agent');
		const m = await loadModule();
		// auto-unlock 是 fire-and-forget,且内含 PBKDF2 口令派生(耗时随负载浮动):
		// 轮询等待解锁完成(带超时上限,真回归仍响亮失败)
		const { get } = await import('svelte/store');
		await vi.waitFor(
			() => {
				expect(get(m.agentConfig).locked).toBe(false);
			},
			{ timeout: 10_000, interval: 20 }
		);
		expect(get(m.agentConfig).authToken).toBe(TOKEN);
	});

	test('resetAgentConfig → 全默认+清缓存', async () => {
		const m = await loadModule();
		m.setAgentEnabled(true);
		m.setAgentToken(TOKEN);
		await m.saveAgentTokenEncrypted(TOKEN, PASS);
		m.resetAgentConfig();
		const { get } = await import('svelte/store');
		const cfg = get(m.agentConfig);
		expect(cfg.enabled).toBe(false);
		expect(cfg.tokenStorage).toBe('none');
		expect(cfg.authToken).toBe('');
		expect(sessionStore.has(AGENT_SESSION_KEY)).toBe(false);
	});
});

describe('isAgentConfigured 形式完备性', () => {
	test('enabled + baseUrl 非空 = 完备;Token 可空(serve 未开鉴权)', async () => {
		const m = await loadModule();
		const { get } = await import('svelte/store');
		m.setAgentEnabled(true);
		expect(m.isAgentConfigured(get(m.agentConfig))).toBe(true);
		m.setAgentBaseUrl('');
		expect(m.isAgentConfigured(get(m.agentConfig))).toBe(false);
	});
});
