// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM API Key 本机加密存储（UV-178 批次B）
//
// 方案（按威胁模型选型，立项文档 11 §6.2 B1/B2）:
//   - AES-256-GCM 加密 + PBKDF2-SHA256(600k 次) 从用户口令派生密钥
//   - 威胁面:本机浏览器档案文件被读取/共享电脑翻看 → 加密后无法直接读出 Key
//   - 明确边界:XSS 面前任何客户端方案都无效(页面内可调用解密结果),
//     这是客户端存储的固有限制,不承诺超出
//   - 会话便利:解锁成功后把会话密钥(raw 字节 b64)缓存进 sessionStorage,
//     同一标签页刷新免重输口令;关标签即失效
//   - 非安全上下文(http 局域网 IP 直连)无 crypto.subtle → hasWebCrypto()
//     返回 false,UI 隐藏加密选项并提示(优雅降级,不崩溃)
//
// 凭据纪律:本模块不打印/不拼接任何 Key 或口令进日志/错误消息。

/** 加密块持久化形态（存入 localStorage llm-config 的 keyEnc 字段） */
export interface EncryptedKeyBlob {
	/** 格式版本（仅 v1；升级格式时新键并存做迁移） */
	v: 1;
	/** KDF 标识（当前仅 pbkdf2-sha256） */
	kdf: 'pbkdf2-sha256';
	/** PBKDF2 迭代次数 */
	iterations: number;
	/** 盐（b64，随机 16 字节） */
	salt: string;
	/** AES-GCM IV（b64，随机 12 字节，每次加密独立） */
	iv: string;
	/** 密文（b64） */
	ct: string;
}

/** OWASP 2023 推荐:PBKDF2-HMAC-SHA256 ≥ 600,000 次 */
export const PBKDF2_ITERATIONS = 600_000;

/** 会话密钥缓存键（sessionStorage；仅存派生后的原始密钥字节 b64） */
const SESSION_KEY_NAME = 'evorule-console-cloud:llm-session-key';

/** 解密失败（口令错误或数据损坏）。不携带任何内部细节。 */
export class KeyDecryptError extends Error {
	constructor() {
		super('key decrypt failed');
		this.name = 'KeyDecryptError';
	}
}

/** 当前环境是否具备 WebCrypto（需安全上下文:https/localhost） */
export function hasWebCrypto(): boolean {
	try {
		return typeof crypto !== 'undefined' && crypto.subtle !== undefined;
	} catch {
		return false;
	}
}

// ---- b64 编解码（UTF-8 安全，不依赖 btoa 的 Latin-1 限制） ----

function bufToB64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/** 形态守卫：localStorage 读回时判定是否合法 v1 加密块（不验内容可解性） */
export function isEncryptedKeyBlob(v: unknown): v is EncryptedKeyBlob {
	if (typeof v !== 'object' || v === null) return false;
	const b = v as Record<string, unknown>;
	return (
		b.v === 1 &&
		b.kdf === 'pbkdf2-sha256' &&
		typeof b.iterations === 'number' &&
		b.iterations >= 1 &&
		typeof b.salt === 'string' &&
		b.salt.length > 0 &&
		typeof b.iv === 'string' &&
		b.iv.length > 0 &&
		typeof b.ct === 'string' &&
		b.ct.length > 0
	);
}

async function deriveKey(
	passphrase: string,
	salt: Uint8Array,
	iterations: number,
	extractable: boolean
): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(passphrase),
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
		material,
		{ name: 'AES-GCM', length: 256 },
		extractable,
		['encrypt', 'decrypt']
	);
}

/** 加密 API Key：随机盐+IV，AES-256-GCM；同口令两次调用产物不同（盐/IV 独立） */
export async function encryptApiKey(plain: string, passphrase: string): Promise<EncryptedKeyBlob> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS, true);
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource },
		key,
		new TextEncoder().encode(plain)
	);
	return {
		v: 1,
		kdf: 'pbkdf2-sha256',
		iterations: PBKDF2_ITERATIONS,
		salt: bufToB64(salt.buffer as ArrayBuffer),
		iv: bufToB64(iv.buffer as ArrayBuffer),
		ct: bufToB64(ct)
	};
}

async function decryptWithKey(blob: EncryptedKeyBlob, key: CryptoKey): Promise<string> {
	try {
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: b64ToBuf(blob.iv) as BufferSource },
			key,
			b64ToBuf(blob.ct) as BufferSource
		);
		return new TextDecoder().decode(plain);
	} catch {
		// AES-GCM 认证失败 = 口令错误或数据被篡改；不透出内部细节
		throw new KeyDecryptError();
	}
}

/** 用口令解密 API Key（口令错误/数据损坏 → KeyDecryptError） */
export async function decryptApiKey(blob: EncryptedKeyBlob, passphrase: string): Promise<string> {
	const salt = b64ToBuf(blob.salt);
	const key = await deriveKey(passphrase, salt, blob.iterations, false);
	return decryptWithKey(blob, key);
}

// ---- 会话密钥缓存（sessionStorage；关标签即失效） ----

function sessionCacheAvailable(): boolean {
	try {
		return typeof sessionStorage !== 'undefined';
	} catch {
		return false;
	}
}

/** 解锁成功后缓存会话密钥（raw 字节 b64；失败静默——缓存是便利不是保证） */
export async function cacheSessionKey(blob: EncryptedKeyBlob, passphrase: string): Promise<void> {
	if (!sessionCacheAvailable()) return;
	try {
		const salt = b64ToBuf(blob.salt);
		const key = await deriveKey(passphrase, salt, blob.iterations, true);
		const raw = await crypto.subtle.exportKey('raw', key);
		sessionStorage.setItem(SESSION_KEY_NAME, bufToB64(raw));
	} catch {
		// 缓存失败不影响解锁结果
	}
}

/** 读取缓存的会话密钥（无缓存/形态不符 → null；导入后不可再导出） */
export async function readCachedSessionKey(blob: EncryptedKeyBlob): Promise<CryptoKey | null> {
	if (!sessionCacheAvailable()) return null;
	try {
		const b64 = sessionStorage.getItem(SESSION_KEY_NAME);
		if (!b64) return null;
		return await crypto.subtle.importKey(
			'raw',
			b64ToBuf(b64) as BufferSource,
			{ name: 'AES-GCM', length: 256 },
			false,
			['decrypt']
		);
	} catch {
		return null;
	}
}

/** 用缓存会话密钥解密（自动解锁路径；失败 → KeyDecryptError） */
export async function decryptApiKeyWithSessionKey(
	blob: EncryptedKeyBlob,
	key: CryptoKey
): Promise<string> {
	return decryptWithKey(blob, key);
}

/** 清除会话密钥缓存（锁定/清除 Key/换 blob 时调用） */
export function clearSessionKeyCache(): void {
	if (!sessionCacheAvailable()) return;
	try {
		sessionStorage.removeItem(SESSION_KEY_NAME);
	} catch {
		// 忽略
	}
}
