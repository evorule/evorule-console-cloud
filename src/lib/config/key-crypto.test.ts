// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — key-crypto 加密存储 单测(UV-178 批次B)
//
// 运行: npx vitest run src/lib/config/key-crypto.test.ts
// node 环境:无 WebCrypto 时以 node:crypto.webcrypto 兜底(vitest 进程内)

import { describe, test, expect, vi, beforeEach } from 'vitest';

// ---- WebCrypto 兜底(node <19 无全局 crypto) ----
if (!globalThis.crypto?.subtle) {
	const { webcrypto } = await import('node:crypto');
	vi.stubGlobal('crypto', webcrypto);
}

// ---- sessionStorage 桩(node 环境无) ----
const sessionStore = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
	getItem: (k: string) => sessionStore.get(k) ?? null,
	setItem: (k: string, v: string) => void sessionStore.set(k, String(v)),
	removeItem: (k: string) => void sessionStore.delete(k),
	clear: () => void sessionStore.clear()
});

import {
	PBKDF2_ITERATIONS,
	KeyDecryptError,
	encryptApiKey,
	decryptApiKey,
	decryptApiKeyWithSessionKey,
	isEncryptedKeyBlob,
	hasWebCrypto,
	cacheSessionKey,
	readCachedSessionKey,
	clearSessionKeyCache
} from './key-crypto';

const KEY = 'sk-test-1234567890';
const PASS = 'correct-horse-battery';

beforeEach(() => {
	sessionStore.clear();
});

describe('hasWebCrypto', () => {
	test('node webcrypto 兜底后可用', () => {
		expect(hasWebCrypto()).toBe(true);
	});
});

describe('encryptApiKey / decryptApiKey', () => {
	test('加解密回环还原原文', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		const plain = await decryptApiKey(blob, PASS);
		expect(plain).toBe(KEY);
	});

	test('错误口令 → KeyDecryptError(不透出内部细节)', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		await expect(decryptApiKey(blob, 'wrong-passphrase')).rejects.toThrow(KeyDecryptError);
	});

	test('密文不含明文 Key', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		expect(blob.ct).not.toContain(KEY);
		// b64 解码后也不含明文(GCM 密文 + 随机 IV/盐)
		expect(JSON.stringify(blob)).not.toContain(KEY);
	});

	test('同口令两次加密产物不同(随机盐/IV)', async () => {
		const a = await encryptApiKey(KEY, PASS);
		const b = await encryptApiKey(KEY, PASS);
		expect(a.salt).not.toBe(b.salt);
		expect(a.iv).not.toBe(b.iv);
		expect(a.ct).not.toBe(b.ct);
	});

	test('迭代次数 = PBKDF2_ITERATIONS(600k)', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		expect(blob.iterations).toBe(PBKDF2_ITERATIONS);
		expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
	});

	test('空明文也可回环', async () => {
		const blob = await encryptApiKey('', PASS);
		expect(await decryptApiKey(blob, PASS)).toBe('');
	});
});

describe('isEncryptedKeyBlob 形态守卫', () => {
	test('合法 v1 块通过', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		expect(isEncryptedKeyBlob(blob)).toBe(true);
	});

	test('非法形态拒绝', () => {
		expect(isEncryptedKeyBlob(null)).toBe(false);
		expect(isEncryptedKeyBlob('str')).toBe(false);
		expect(isEncryptedKeyBlob({})).toBe(false);
		expect(isEncryptedKeyBlob({ ...{ v: 2, kdf: 'pbkdf2-sha256' } })).toBe(false);
		expect(
			isEncryptedKeyBlob({ v: 1, kdf: 'other', iterations: 1, salt: 'a', iv: 'b', ct: 'c' })
		).toBe(false);
		expect(
			isEncryptedKeyBlob({ v: 1, kdf: 'pbkdf2-sha256', iterations: 0, salt: 'a', iv: 'b', ct: 'c' })
		).toBe(false);
		expect(
			isEncryptedKeyBlob({ v: 1, kdf: 'pbkdf2-sha256', iterations: 1, salt: '', iv: 'b', ct: 'c' })
		).toBe(false);
	});
});

describe('会话密钥缓存(sessionStorage)', () => {
	test('缓存后可免口令解密', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		await cacheSessionKey(blob, PASS);
		const sessionKey = await readCachedSessionKey(blob);
		expect(sessionKey).not.toBeNull();
		const plain = await decryptApiKeyWithSessionKey(blob, sessionKey as CryptoKey);
		expect(plain).toBe(KEY);
	});

	test('无缓存 → null;清除后 → null', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		expect(await readCachedSessionKey(blob)).toBeNull();
		await cacheSessionKey(blob, PASS);
		clearSessionKeyCache();
		expect(await readCachedSessionKey(blob)).toBeNull();
	});

	test('缓存会话密钥不可再导出(非可提取导入)', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		await cacheSessionKey(blob, PASS);
		const sessionKey = (await readCachedSessionKey(blob)) as CryptoKey;
		expect(sessionKey.extractable).toBe(false);
	});
});

describe('会话密钥缓存作用域(UV-178 批次E+ 治理凭据升级)', () => {
	test('llm 缺省作用域沿用既有键名(批次B 已解锁会话不失效)', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		await cacheSessionKey(blob, PASS);
		expect(sessionStore.has('evorule-console-cloud:llm-session-key')).toBe(true);
		expect(await readCachedSessionKey(blob)).not.toBeNull();
	});

	test('governance 作用域独立缓存,各自 blob 可用各自会话密钥解密', async () => {
		const blobL = await encryptApiKey(KEY, PASS);
		const blobG = await encryptApiKey(KEY, PASS);
		await cacheSessionKey(blobL, PASS, 'llm');
		await cacheSessionKey(blobG, PASS, 'governance');
		expect(sessionStore.has('evorule-console-cloud:governance-session-key')).toBe(true);
		const kL = (await readCachedSessionKey(blobL, 'llm')) as CryptoKey;
		const kG = (await readCachedSessionKey(blobG, 'governance')) as CryptoKey;
		expect(await decryptApiKeyWithSessionKey(blobL, kL)).toBe(KEY);
		expect(await decryptApiKeyWithSessionKey(blobG, kG)).toBe(KEY);
	});

	test('跨面复用会话密钥解密必败(盐不同派生密钥不通用)', async () => {
		const blobG = await encryptApiKey(KEY, PASS);
		const blobL = await encryptApiKey(KEY, PASS);
		await cacheSessionKey(blobL, PASS, 'llm');
		const kL = (await readCachedSessionKey(blobL, 'llm')) as CryptoKey;
		await expect(decryptApiKeyWithSessionKey(blobG, kL)).rejects.toThrow(KeyDecryptError);
	});

	test('clearSessionKeyCache 按作用域清除;缺省仅清 llm', async () => {
		const blob = await encryptApiKey(KEY, PASS);
		await cacheSessionKey(blob, PASS, 'llm');
		await cacheSessionKey(blob, PASS, 'governance');
		clearSessionKeyCache('governance');
		expect(await readCachedSessionKey(blob, 'governance')).toBeNull();
		expect(await readCachedSessionKey(blob, 'llm')).not.toBeNull();
		clearSessionKeyCache();
		expect(await readCachedSessionKey(blob, 'llm')).toBeNull();
	});
});
