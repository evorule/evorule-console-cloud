// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 配置 store(enabled + endpoint + key + model)
//
// 持久化:localStorage(key: evorule-console-cloud:llm-config)
// 默认:enabled=false(与内核 evorule-console 一致,LLM 按钮不渲染)
//
// 凭据安全(UV-178 批次B):
//   - 运行时 apiKey 一律内存明文(消费方语义不变)
//   - 落盘形态由 keyStorage 决定:
//       encrypted(缺省推荐):keyEnc 加密块(AES-256-GCM+PBKDF2 口令,
//         见 config/key-crypto.ts);本会话未解锁时 locked=true、apiKey=''
//       plain:明文 apiKey 写入(旧版行为兼容,或用户显式选择;不推荐)
//       none:未保存 Key
//   - 旧版明文配置自动识别为 plain,行为不变;升级经设置面板重新保存
//   - 解锁成功后缓存会话密钥进 sessionStorage(同标签页刷新免重输,
//     关标签即失效)
//   - 不进日志/错误/URL(由 cloud-llm-assistant.ts 保证)
//
// 与内核边界:本 store 是大众版独有的,内核不感知。

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
	DEFAULT_LLM_CONFIG,
	type CloudLlmConfig,
	type LlmChannel,
	type LlmKeyStorage
} from '$lib/assistant/types';
import {
	clearSessionKeyCache,
	cacheSessionKey,
	decryptApiKey,
	decryptApiKeyWithSessionKey,
	encryptApiKey,
	hasWebCrypto,
	isEncryptedKeyBlob,
	readCachedSessionKey,
	type EncryptedKeyBlob
} from './key-crypto';

const STORAGE_KEY = 'evorule-console-cloud:llm-config';

/** 加密块随运行时态保存在模块内(不进 CloudLlmConfig 公共契约) */
let keyEncBlob: EncryptedKeyBlob | null = null;

/** channel 白名单解析(老配置无此字段/非法值 → 缺省 browser,向后兼容) */
function parseChannel(v: unknown): LlmChannel {
	return v === 'server' ? 'server' : 'browser';
}

/** keyStorage 白名单解析(老配置无此字段 → 按 apiKey 有无回推) */
function parseKeyStorage(v: unknown, hasPlainKey: boolean): LlmKeyStorage {
	if (v === 'encrypted') return 'encrypted';
	if (v === 'plain') return 'plain';
	return hasPlainKey ? 'plain' : 'none';
}

function loadConfig(): CloudLlmConfig {
	if (!browser) return { ...DEFAULT_LLM_CONFIG };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_LLM_CONFIG };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		// 加密块(合法 v1 形态才收;损坏按无 Key 处理,不静默造明文)
		keyEncBlob = isEncryptedKeyBlob(parsed.keyEnc) ? parsed.keyEnc : null;
		const plainKey =
			typeof parsed.apiKey === 'string' && keyEncBlob === null ? parsed.apiKey : '';
		// keyStorage 归一:加密块有效才认 encrypted;声明 encrypted 但块损坏
		// → 回落 plain(有明文)/none(无),不留"有形态无块"的僵尸态
		const ksRaw =
			keyEncBlob !== null
				? 'encrypted'
				: parsed.keyStorage === 'encrypted'
					? undefined
					: parsed.keyStorage;
		const keyStorage = parseKeyStorage(ksRaw, plainKey.length > 0);
		return {
			enabled: parsed.enabled === true,
			channel: parseChannel(parsed.channel),
			provider:
				typeof parsed.provider === 'string' && parsed.provider.length > 0
					? parsed.provider
					: DEFAULT_LLM_CONFIG.provider,
			apiEndpoint:
				typeof parsed.apiEndpoint === 'string' && parsed.apiEndpoint.length > 0
					? parsed.apiEndpoint
					: DEFAULT_LLM_CONFIG.apiEndpoint,
			apiKey: keyStorage === 'plain' ? plainKey : '',
			model:
				typeof parsed.model === 'string' && parsed.model.length > 0
					? parsed.model
					: DEFAULT_LLM_CONFIG.model,
			keyStorage,
			locked: keyStorage === 'encrypted'
		};
	} catch {
		keyEncBlob = null;
		return { ...DEFAULT_LLM_CONFIG };
	}
}

export const llmConfig = writable<CloudLlmConfig>(loadConfig());

// 持久化(apiKey 不直接落盘:形态由 keyStorage 决定)
llmConfig.subscribe((cfg) => {
	if (!browser) return;
	const persist: Record<string, unknown> = {
		enabled: cfg.enabled,
		channel: cfg.channel,
		provider: cfg.provider,
		apiEndpoint: cfg.apiEndpoint,
		model: cfg.model,
		keyStorage: cfg.keyStorage
	};
	if (cfg.keyStorage === 'plain') {
		// 明文形态:沿用旧版"即改即存"行为(仅显式 plain 用户)
		persist.apiKey = cfg.apiKey;
	} else if (cfg.keyStorage === 'encrypted' && keyEncBlob !== null) {
		persist.keyEnc = keyEncBlob;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
});

// 本会话自动解锁:加载时若存在加密块且 sessionStorage 有会话密钥 → 静默解锁
// (fire-and-forget;失败即保持锁定并清掉过期缓存)
if (browser && keyEncBlob !== null) {
	const blob = keyEncBlob;
	void (async () => {
		const sessionKey = await readCachedSessionKey(blob);
		if (!sessionKey) return;
		try {
			const plain = await decryptApiKeyWithSessionKey(blob, sessionKey);
			llmConfig.update((c) => ({ ...c, apiKey: plain, locked: false }));
		} catch {
			clearSessionKeyCache();
		}
	})();
}

// === 便捷更新函数 ===

export function setLlmEnabled(enabled: boolean): void {
	llmConfig.update((c) => ({ ...c, enabled }));
}

/** 切换执行通道(browser=浏览器直连自有 key;server=服务端托管 key) */
export function setLlmChannel(channel: LlmChannel): void {
	llmConfig.update((c) => ({ ...c, channel }));
}

export function setLlmProvider(provider: string): void {
	llmConfig.update((c) => ({ ...c, provider }));
}

export function setLlmApiEndpoint(apiEndpoint: string): void {
	llmConfig.update((c) => ({ ...c, apiEndpoint: apiEndpoint.trim() }));
}

/**
 * 更新运行时 apiKey(内存)。落盘与否取决于 keyStorage:
 * plain 模式随订阅自动持久化(旧版行为);encrypted/none 模式仅运行时,
 * 持久化须经 saveLlmApiKeyEncrypted。
 */
export function setLlmApiKey(apiKey: string): void {
	llmConfig.update((c) => ({ ...c, apiKey }));
}

export function setLlmModel(model: string): void {
	llmConfig.update((c) => ({ ...c, model: model.trim() }));
}

/** 一次性更新多个字段(用于切换厂商预设;不改变 keyStorage 形态) */
export function updateLlmConfig(patch: Partial<CloudLlmConfig>): void {
	llmConfig.update((c) => ({ ...c, ...patch }));
}

/** 重置为默认配置(enabled=false + 清 Key/加密块/会话缓存) */
export function resetLlmConfig(): void {
	keyEncBlob = null;
	if (browser) clearSessionKeyCache();
	llmConfig.set({ ...DEFAULT_LLM_CONFIG });
}

/** 清空 apiKey(保留其他配置;连同加密块与会话缓存) */
export function clearLlmApiKey(): void {
	keyEncBlob = null;
	if (browser) clearSessionKeyCache();
	llmConfig.update((c) => ({
		...c,
		apiKey: '',
		keyStorage: 'none' as LlmKeyStorage,
		locked: false
	}));
}

/** 显式选择明文保存(旧版行为;UI 需警示。空 Key 视为清除) */
export function saveLlmApiKeyPlain(apiKey: string): void {
	keyEncBlob = null;
	if (browser) clearSessionKeyCache();
	llmConfig.update((c) => ({
		...c,
		apiKey,
		keyStorage: apiKey ? ('plain' as LlmKeyStorage) : ('none' as LlmKeyStorage),
		locked: false
	}));
}

export type SaveKeyResult = { ok: true } | { ok: false; error: SaveKeyError };
export type UnlockResult =
	| { ok: true }
	| { ok: false; error: 'wrong-passphrase' | 'no-encrypted-key' | 'crypto-unavailable' };
export type SaveKeyError =
	| 'key-empty'
	| 'passphrase-short'
	| 'crypto-unavailable'
	| 'encrypt-failed';

/** 口令最短长度(防一字节口令形式化) */
export const PASSPHRASE_MIN_LEN = 8;

/**
 * 以口令加密保存 Key(缺省推荐路径)。
 * 成功后:运行时 Key 可用 + keyEnc 块落盘 + 会话密钥缓存(sessionStorage)。
 */
export async function saveLlmApiKeyEncrypted(
	apiKey: string,
	passphrase: string
): Promise<SaveKeyResult> {
	if (!apiKey) return { ok: false, error: 'key-empty' };
	if (passphrase.trim().length < PASSPHRASE_MIN_LEN) {
		return { ok: false, error: 'passphrase-short' };
	}
	if (!hasWebCrypto()) return { ok: false, error: 'crypto-unavailable' };
	try {
		const blob = await encryptApiKey(apiKey, passphrase.trim());
		keyEncBlob = blob;
		llmConfig.update((c) => ({ ...c, apiKey, keyStorage: 'encrypted' as LlmKeyStorage, locked: false }));
		await cacheSessionKey(blob, passphrase.trim());
		return { ok: true };
	} catch {
		return { ok: false, error: 'encrypt-failed' };
	}
}

/**
 * 解锁已加密保存的 Key:优先用 sessionStorage 会话密钥(免重输),
 * 否则用口令派生。成功后运行时 Key 可用;口令路径成功会刷新会话缓存。
 */
export async function unlockLlmApiKey(passphrase: string): Promise<UnlockResult> {
	if (keyEncBlob === null) return { ok: false, error: 'no-encrypted-key' };
	if (!hasWebCrypto()) return { ok: false, error: 'crypto-unavailable' };
	const blob = keyEncBlob;
	// 1) 会话密钥(同标签页已解锁过)
	const sessionKey = await readCachedSessionKey(blob);
	if (sessionKey) {
		try {
			const plain = await decryptApiKeyWithSessionKey(blob, sessionKey);
			llmConfig.update((c) => ({ ...c, apiKey: plain, locked: false }));
			return { ok: true };
		} catch {
			clearSessionKeyCache(); // 过期缓存(如他处改了口令),回落口令路径
		}
	}
	// 2) 口令派生
	if (!passphrase) return { ok: false, error: 'wrong-passphrase' };
	try {
		const plain = await decryptApiKey(blob, passphrase.trim());
		llmConfig.update((c) => ({ ...c, apiKey: plain, locked: false }));
		await cacheSessionKey(blob, passphrase.trim());
		return { ok: true };
	} catch {
		return { ok: false, error: 'wrong-passphrase' };
	}
}

/** 立即锁定(清运行时 Key 与会话缓存;加密块保留,解锁后恢复) */
export function lockLlmApiKey(): void {
	if (browser) clearSessionKeyCache();
	llmConfig.update((c) =>
		c.keyStorage === 'encrypted' ? { ...c, apiKey: '', locked: true } : c
	);
}

/**
 * 检查配置是否完备(用于决定是否注入 provider)。
 *
 * browser 通道:完备 = enabled && apiEndpoint 非空 && apiKey 非空 && model 非空
 *   (locked 态下 apiKey 为空 → 视为未配置,LLM UI 不出现,直到解锁)
 * server 通道:完备 = enabled(凭据在 ai-plugin 侧环境变量/配置文件,model 可选覆盖)
 *
 * 注意:此处只做"形式完备性"检查,不验证 key/服务是否真正可用。
 * 有效性由 testConnection() 在用户主动测试时验证。
 */
export function isLlmConfigured(cfg: CloudLlmConfig): boolean {
	if (cfg.channel === 'server') {
		return cfg.enabled;
	}
	return (
		cfg.enabled &&
		cfg.apiEndpoint.trim().length > 0 &&
		cfg.apiKey.trim().length > 0 &&
		cfg.model.trim().length > 0
	);
}
