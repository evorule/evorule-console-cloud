// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 治理服务连接配置 store(Phase 2 F1)
//
// 持久化:localStorage(key: evorule-console-cloud:governance-config)
// 安全(UV-178 批次E+ 治理凭据升级,对齐 llm-config 批次B 同款方案):
//   - 运行时 password 一律内存明文(消费方 connect() 语义不变)
//   - 落盘形态由 passwordStorage 决定:
//       encrypted(缺省推荐):passwordEnc 加密块(AES-256-GCM+PBKDF2 口令,
//         见 config/key-crypto.ts);本会话未解锁时 locked=true、password=''
//       plain:明文 password 写入(旧版行为兼容,或用户显式选择;不推荐)
//       none:未保存密码
//   - 旧版明文配置自动识别为 plain,行为不变;升级经治理页重新保存
//   - 解锁成功后缓存会话密钥进 sessionStorage(scope='governance',
//     与 LLM Key 缓存隔离;同标签页刷新免重输,关标签即失效)
//   - 不进日志/错误/URL;令牌(access_token)不落 localStorage,
//     仅存 GovernanceBackend 实例内存(见 governance-backend.ts)
//
// 边界:治理数据来自 evorule-rule(:18081,规则资产库),执行数据来自
//      evorule-server(:18080,运行时),二者独立可达、互不耦合。

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
	cacheSessionKey,
	clearSessionKeyCache,
	decryptApiKey,
	decryptApiKeyWithSessionKey,
	encryptApiKey,
	hasWebCrypto,
	isEncryptedKeyBlob,
	readCachedSessionKey,
	type EncryptedKeyBlob
} from './key-crypto';

/** 密码保存形态（旧版明文配置自动识别为 plain,行为不变） */
export type GovernancePasswordStorage = 'plain' | 'encrypted' | 'none';

export interface GovernanceConfig {
	/** evorule-rule REST 地址 */
	baseUrl: string;
	/** 租户 ID(evorule-rule 多租户,默认 "default") */
	tenantId: string;
	/** 登录用户名 */
	username: string;
	/** 登录密码(运行时内存;落盘与否由 passwordStorage 决定) */
	password: string;
	/** 密码落盘形态 */
	passwordStorage: GovernancePasswordStorage;
	/** encrypted 且本会话未解锁(password 为空,须解锁后可用) */
	locked: boolean;
}

const STORAGE_KEY = 'evorule-console-cloud:governance-config';

/** 口令最短长度(与 llm-config 同规,防一字节口令形式化) */
export const PASSPHRASE_MIN_LEN = 8;

/** 加密块随运行时态保存在模块内(不进 GovernanceConfig 持久化契约) */
let passwordEncBlob: EncryptedKeyBlob | null = null;

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
	password: '',
	passwordStorage: 'none',
	locked: false
};

function loadConfig(): GovernanceConfig {
	const fallback: GovernanceConfig = { ...DEFAULT_CONFIG, baseUrl: defaultBaseUrl() };
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		// 加密块(合法 v1 形态才收;损坏按无块处理,不静默造明文)
		passwordEncBlob = isEncryptedKeyBlob(parsed.passwordEnc) ? parsed.passwordEnc : null;
		// 旧版明文密码:仅当无有效加密块时才认(加密态下明文字段一律忽略)
		const plainPassword =
			typeof parsed.password === 'string' && passwordEncBlob === null ? parsed.password : '';
		const storage: GovernancePasswordStorage =
			passwordEncBlob !== null ? 'encrypted' : plainPassword.length > 0 ? 'plain' : 'none';
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
			password: storage === 'plain' ? plainPassword : '',
			passwordStorage: storage,
			locked: storage === 'encrypted'
		};
	} catch {
		passwordEncBlob = null;
		return fallback;
	}
}

export const governanceConfig = writable<GovernanceConfig>(loadConfig());

// 持久化(订阅变化即写入;password 不直接落盘:形态由 passwordStorage 决定)
governanceConfig.subscribe((cfg) => {
	if (!browser) return;
	const persist: Record<string, unknown> = {
		baseUrl: cfg.baseUrl,
		tenantId: cfg.tenantId,
		username: cfg.username,
		passwordStorage: cfg.passwordStorage
	};
	if (cfg.passwordStorage === 'plain') {
		// 明文形态:沿用旧版"即改即存"行为(仅显式 plain 用户/旧配置)
		persist.password = cfg.password;
	} else if (cfg.passwordStorage === 'encrypted' && passwordEncBlob !== null) {
		persist.passwordEnc = passwordEncBlob;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
});

// 本会话自动解锁:加载时若存在加密块且 sessionStorage 有会话密钥 → 静默解锁
// (fire-and-forget;失败即保持锁定并清掉过期缓存)
if (browser && passwordEncBlob !== null) {
	const blob = passwordEncBlob;
	void (async () => {
		const sessionKey = await readCachedSessionKey(blob, 'governance');
		if (!sessionKey) return;
		try {
			const plain = await decryptApiKeyWithSessionKey(blob, sessionKey);
			governanceConfig.update((c) => ({ ...c, password: plain, locked: false }));
		} catch {
			clearSessionKeyCache('governance');
		}
	})();
}

// === 便捷更新函数 ===

export function updateGovernanceConfig(patch: Partial<GovernanceConfig>): void {
	governanceConfig.update((c) => ({ ...c, ...patch }));
}

/**
 * 更新运行时密码(内存)。落盘与否取决于 passwordStorage:
 * plain 模式随订阅自动持久化(旧版行为);encrypted/none 模式仅运行时,
 * 持久化须经 saveGovernancePasswordEncrypted / saveGovernancePasswordPlain。
 */
export function setGovernancePassword(password: string): void {
	governanceConfig.update((c) => ({ ...c, password }));
}

/** 重置为默认配置(连同加密块与会话缓存) */
export function resetGovernanceConfig(): void {
	passwordEncBlob = null;
	if (browser) clearSessionKeyCache('governance');
	governanceConfig.set({ ...DEFAULT_CONFIG, baseUrl: defaultBaseUrl() });
}

/** 清空已保存密码(保留其他连接配置;连同加密块与会话缓存) */
export function clearGovernancePassword(): void {
	passwordEncBlob = null;
	if (browser) clearSessionKeyCache('governance');
	governanceConfig.update((c) => ({
		...c,
		password: '',
		passwordStorage: 'none' as GovernancePasswordStorage,
		locked: false
	}));
}

/** 显式选择明文保存(旧版行为;UI 需警示。空密码视为清除) */
export function saveGovernancePasswordPlain(password: string): void {
	passwordEncBlob = null;
	if (browser) clearSessionKeyCache('governance');
	governanceConfig.update((c) => ({
		...c,
		password,
		passwordStorage: password ? ('plain' as GovernancePasswordStorage) : ('none' as GovernancePasswordStorage),
		locked: false
	}));
}

export type SaveGovPasswordResult = { ok: true } | { ok: false; error: SaveGovPasswordError };
export type UnlockGovResult =
	| { ok: true }
	| { ok: false; error: 'wrong-passphrase' | 'no-encrypted-password' | 'crypto-unavailable' };
export type SaveGovPasswordError =
	| 'password-empty'
	| 'passphrase-short'
	| 'passphrase-mismatch'
	| 'crypto-unavailable'
	| 'encrypt-failed';

/**
 * 以口令加密保存密码(缺省推荐路径)。
 * 成功后:运行时密码可用 + passwordEnc 块落盘 + 会话密钥缓存(scope=governance)。
 */
export async function saveGovernancePasswordEncrypted(
	password: string,
	passphrase: string
): Promise<SaveGovPasswordResult> {
	if (!password) return { ok: false, error: 'password-empty' };
	if (passphrase.trim().length < PASSPHRASE_MIN_LEN) {
		return { ok: false, error: 'passphrase-short' };
	}
	if (!hasWebCrypto()) return { ok: false, error: 'crypto-unavailable' };
	try {
		const blob = await encryptApiKey(password, passphrase.trim());
		passwordEncBlob = blob;
		governanceConfig.update((c) => ({
			...c,
			password,
			passwordStorage: 'encrypted' as GovernancePasswordStorage,
			locked: false
		}));
		await cacheSessionKey(blob, passphrase.trim(), 'governance');
		return { ok: true };
	} catch {
		return { ok: false, error: 'encrypt-failed' };
	}
}

/**
 * 解锁已加密保存的密码:优先用 sessionStorage 会话密钥(免重输),
 * 否则用口令派生。成功后运行时密码可用;口令路径成功会刷新会话缓存。
 */
export async function unlockGovernancePassword(passphrase: string): Promise<UnlockGovResult> {
	if (passwordEncBlob === null) return { ok: false, error: 'no-encrypted-password' };
	if (!hasWebCrypto()) return { ok: false, error: 'crypto-unavailable' };
	const blob = passwordEncBlob;
	// 1) 会话密钥(同标签页已解锁过)
	const sessionKey = await readCachedSessionKey(blob, 'governance');
	if (sessionKey) {
		try {
			const plain = await decryptApiKeyWithSessionKey(blob, sessionKey);
			governanceConfig.update((c) => ({ ...c, password: plain, locked: false }));
			return { ok: true };
		} catch {
			clearSessionKeyCache('governance'); // 过期缓存(如他处改了口令),回落口令路径
		}
	}
	// 2) 口令派生
	if (!passphrase) return { ok: false, error: 'wrong-passphrase' };
	try {
		const plain = await decryptApiKey(blob, passphrase.trim());
		governanceConfig.update((c) => ({ ...c, password: plain, locked: false }));
		await cacheSessionKey(blob, passphrase.trim(), 'governance');
		return { ok: true };
	} catch {
		return { ok: false, error: 'wrong-passphrase' };
	}
}

/** 立即锁定(清运行时密码与会话缓存;加密块保留,解锁后恢复) */
export function lockGovernancePassword(): void {
	if (browser) clearSessionKeyCache('governance');
	governanceConfig.update((c) =>
		c.passwordStorage === 'encrypted' ? { ...c, password: '', locked: true } : c
	);
}
