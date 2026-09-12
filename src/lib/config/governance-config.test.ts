// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — governance-config 治理凭据加密存储 单测(UV-178 批次E+)
//
// 运行: npx vitest run src/lib/config/governance-config.test.ts
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

const STORAGE_KEY = 'evorule-console-cloud:governance-config';
const GOV_SESSION_KEY = 'evorule-console-cloud:governance-session-key';

const PW = 'gov-secret-password';
const PASS = 'correct-horse-battery';

beforeEach(() => {
	vi.resetModules();
	localStore.clear();
	sessionStore.clear();
});

/** 重放模块初始化(先种 localStorage 再动态 import) */
async function loadModule() {
	return await import('./governance-config');
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
	test('无存储 → 缺省 none 不锁定', async () => {
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.governanceConfig);
		expect(cfg.passwordStorage).toBe('none');
		expect(cfg.locked).toBe(false);
		expect(cfg.password).toBe('');
	});

	test('旧版明文配置 → 自动识别 plain,行为不变', async () => {
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ baseUrl: 'http://127.0.0.1:18081', username: 'admin', password: PW })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.governanceConfig);
		expect(cfg.passwordStorage).toBe('plain');
		expect(cfg.password).toBe(PW);
		expect(cfg.locked).toBe(false);
		// plain 模式编辑即持久化(旧版行为)
		m.updateGovernanceConfig({ password: PW + '2' });
		expect(persisted().password).toBe(PW + '2');
	});

	test('加密块配置 → locked 未解锁,password 运行时空', async () => {
		const blob = await makeBlob(PW, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ username: 'admin', passwordEnc: blob, passwordStorage: 'encrypted' })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.governanceConfig);
		expect(cfg.passwordStorage).toBe('encrypted');
		expect(cfg.locked).toBe(true);
		expect(cfg.password).toBe('');
	});

	test('加密块损坏(形态非法) → 按无块处理,不虚构明文', async () => {
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ username: 'admin', passwordEnc: { v: 2 }, passwordStorage: 'encrypted' })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.governanceConfig);
		expect(cfg.passwordStorage).toBe('none');
		expect(cfg.password).toBe('');
	});

	test('加密态下遗留明文字段一律忽略(不静默回落明文)', async () => {
		const blob = await makeBlob(PW, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ username: 'admin', passwordEnc: blob, password: 'stale-plain' })
		);
		const m = await loadModule();
		const { get } = await import('svelte/store');
		const cfg = get(m.governanceConfig);
		expect(cfg.passwordStorage).toBe('encrypted');
		expect(cfg.locked).toBe(true);
		expect(cfg.password).toBe('');
	});

	test('none 模式输入密码仅运行时,不落盘', async () => {
		const m = await loadModule();
		m.setGovernancePassword(PW);
		expect(persisted().password).toBeUndefined();
		const { get } = await import('svelte/store');
		expect(get(m.governanceConfig).password).toBe(PW);
	});
});

describe('加密保存 / 解锁 / 锁定 / 清除 回环', () => {
	test('加密保存 → 块落盘无明文;口令解锁成功;错误口令拒绝', async () => {
		const m = await loadModule();
		m.setGovernancePassword(PW);
		const save = await m.saveGovernancePasswordEncrypted(PW, PASS);
		expect(save).toEqual({ ok: true });
		const p = persisted();
		expect(p.passwordEnc).toBeTruthy();
		expect(p.password).toBeUndefined();
		const { get } = await import('svelte/store');
		expect(get(m.governanceConfig).passwordStorage).toBe('encrypted');
		expect(get(m.governanceConfig).password).toBe(PW); // 保存后运行时可用
		// 会话密钥缓存进 governance 作用域
		expect(sessionStore.has(GOV_SESSION_KEY)).toBe(true);

		// 锁定 → 运行时空 + locked + 清会话缓存(锁定=有意遗忘便利,解锁须重输口令,与 llm 同构)
		m.lockGovernancePassword();
		expect(get(m.governanceConfig).locked).toBe(true);
		expect(get(m.governanceConfig).password).toBe('');
		expect(sessionStore.has(GOV_SESSION_KEY)).toBe(false);
		const unlock1 = await m.unlockGovernancePassword('');
		expect(unlock1).toEqual({ ok: false, error: 'wrong-passphrase' });

		// 清会话缓存后:错误口令拒绝 / 正确口令解锁
		sessionStore.clear();
		const unlock2 = await m.unlockGovernancePassword('wrong-passphrase');
		expect(unlock2).toEqual({ ok: false, error: 'wrong-passphrase' });
		const unlock3 = await m.unlockGovernancePassword(PASS);
		expect(unlock3).toEqual({ ok: true });
		expect(get(m.governanceConfig).password).toBe(PW);
	});

	test('口令过短 / 空密码 / 口令不一致 → 拒绝且不落块', async () => {
		const m = await loadModule();
		m.setGovernancePassword(PW);
		expect(await m.saveGovernancePasswordEncrypted(PW, 'short')).toEqual({
			ok: false,
			error: 'passphrase-short'
		});
		expect(await m.saveGovernancePasswordEncrypted('', PASS)).toEqual({
			ok: false,
			error: 'password-empty'
		});
		expect(persisted().passwordEnc).toBeUndefined();
	});

	test('显式明文保存 → plain 落盘(旧版行为);空密码视为清除', async () => {
		const m = await loadModule();
		m.setGovernancePassword(PW);
		m.saveGovernancePasswordPlain(PW);
		expect(persisted().password).toBe(PW);
		const { get } = await import('svelte/store');
		expect(get(m.governanceConfig).passwordStorage).toBe('plain');
		m.saveGovernancePasswordPlain('');
		expect(get(m.governanceConfig).passwordStorage).toBe('none');
	});

	test('clearGovernancePassword → none,持久化无密码无块;unlock 无块如实拒绝', async () => {
		const blob = await makeBlob(PW, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ username: 'admin', passwordEnc: blob, passwordStorage: 'encrypted' })
		);
		const m = await loadModule();
		m.clearGovernancePassword();
		const p = persisted();
		expect(p.passwordEnc).toBeUndefined();
		expect(p.password).toBeUndefined();
		expect(await m.unlockGovernancePassword(PASS)).toEqual({
			ok: false,
			error: 'no-encrypted-password'
		});
	});

	test('本会话自动解锁:种加密块+会话密钥缓存 → 加载即静默解锁', async () => {
		const blob = await makeBlob(PW, PASS);
		localStore.set(
			STORAGE_KEY,
			JSON.stringify({ username: 'admin', passwordEnc: blob, passwordStorage: 'encrypted' })
		);
		const kc = await import('./key-crypto');
		await kc.cacheSessionKey(blob, PASS, 'governance');
		const m = await loadModule();
		// auto-unlock 是 fire-and-forget,等微任务排空
		await new Promise((r) => setTimeout(r, 0));
		const { get } = await import('svelte/store');
		expect(get(m.governanceConfig).locked).toBe(false);
		expect(get(m.governanceConfig).password).toBe(PW);
	});

	test('resetGovernanceConfig → 全默认+清缓存', async () => {
		const m = await loadModule();
		m.setGovernancePassword(PW);
		await m.saveGovernancePasswordEncrypted(PW, PASS);
		m.resetGovernanceConfig();
		const { get } = await import('svelte/store');
		const cfg = get(m.governanceConfig);
		expect(cfg.passwordStorage).toBe('none');
		expect(cfg.password).toBe('');
		expect(sessionStore.has(GOV_SESSION_KEY)).toBe(false);
	});
});
