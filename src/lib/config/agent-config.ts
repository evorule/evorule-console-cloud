// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — evo-agent 连接配置 store(设置页 Agent 会话台)
//
// 持久化:localStorage(key: evorule-console-cloud:agent-config)
// 默认:enabled=false、baseUrl=http://127.0.0.1:8081(evo-agent serve 缺省端口)
//
// 凭据安全(对齐 governance-config 同款方案):
//   - 运行时 authToken 一律内存明文(消费方语义不变)
//   - 落盘形态由 tokenStorage 决定:
//       encrypted(缺省推荐):tokenEnc 加密块(AES-256-GCM+PBKDF2 口令,
//         见 config/key-crypto.ts);本会话未解锁时 locked=true、authToken=''
//       plain:明文 authToken 写入(用户显式选择;不推荐)
//       none:未保存 Token
//   - 解锁成功后缓存会话密钥进 sessionStorage(scope='agent',
//     与 LLM/治理面缓存隔离;同标签页刷新免重输,关标签即失效)
//   - 不进日志/错误;WS 侧 token 走 URL query 是 evo-agent 协议既定形态
//     (该形态的遗留升级项已另行登记),本 store 不做额外持久化规避
//
// 边界:LLM 模型配置在 evo-agent 侧(config.toml/.env)
//      面板只配连接与凭据;agent 工具白名单也由 evo-agent agents/*.json 决定。

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

/** Token 保存形态 */
export type AgentTokenStorage = 'plain' | 'encrypted' | 'none';

export interface AgentConfig {
	/** 是否启用 Agent 会话台(禁用时导航不渲染该入口) */
	enabled: boolean;
	/** evo-agent serve REST 地址(WS 地址由客户端按 http→ws 规则推导) */
	baseUrl: string;
	/** 鉴权 Token(运行时内存;落盘与否由 tokenStorage 决定;serve 未开鉴权可留空) */
	authToken: string;
	/** Token 落盘形态 */
	tokenStorage: AgentTokenStorage;
	/** encrypted 且本会话未解锁(authToken 为空,须解锁后可用) */
	locked: boolean;
}

const STORAGE_KEY = 'evorule-console-cloud:agent-config';

/** evo-agent serve 缺省端口 */
export const AGENT_DEFAULT_BASE_URL = 'http://127.0.0.1:8081';

/** 口令最短长度(与 llm/governance 同规,防一字节口令形式化) */
export const PASSPHRASE_MIN_LEN = 8;

/** 加密块随运行时态保存在模块内(不进 AgentConfig 持久化契约) */
let tokenEncBlob: EncryptedKeyBlob | null = null;

const DEFAULT_CONFIG: AgentConfig = {
	enabled: false,
	baseUrl: AGENT_DEFAULT_BASE_URL,
	authToken: '',
	tokenStorage: 'none',
	locked: false
};

function loadConfig(): AgentConfig {
	if (!browser) return { ...DEFAULT_CONFIG };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_CONFIG };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		// 加密块(合法 v1 形态才收;损坏按无块处理,不静默造明文)
		tokenEncBlob = isEncryptedKeyBlob(parsed.tokenEnc) ? parsed.tokenEnc : null;
		// 遗留明文 Token:仅当无有效加密块时才认(加密态下明文字段一律忽略)
		const plainToken =
			typeof parsed.authToken === 'string' && tokenEncBlob === null ? parsed.authToken : '';
		const storage: AgentTokenStorage =
			tokenEncBlob !== null ? 'encrypted' : plainToken.length > 0 ? 'plain' : 'none';
		return {
			enabled: parsed.enabled === true,
			baseUrl:
				typeof parsed.baseUrl === 'string' && parsed.baseUrl.length > 0
					? parsed.baseUrl
					: DEFAULT_CONFIG.baseUrl,
			authToken: storage === 'plain' ? plainToken : '',
			tokenStorage: storage,
			locked: storage === 'encrypted'
		};
	} catch {
		tokenEncBlob = null;
		return { ...DEFAULT_CONFIG };
	}
}

export const agentConfig = writable<AgentConfig>(loadConfig());

// 持久化(订阅变化即写入;authToken 不直接落盘:形态由 tokenStorage 决定)
agentConfig.subscribe((cfg) => {
	if (!browser) return;
	const persist: Record<string, unknown> = {
		enabled: cfg.enabled,
		baseUrl: cfg.baseUrl,
		tokenStorage: cfg.tokenStorage
	};
	if (cfg.tokenStorage === 'plain') {
		// 明文形态:仅显式 plain 用户
		persist.authToken = cfg.authToken;
	} else if (cfg.tokenStorage === 'encrypted' && tokenEncBlob !== null) {
		persist.tokenEnc = tokenEncBlob;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
});

// 本会话自动解锁:加载时若存在加密块且 sessionStorage 有会话密钥 → 静默解锁
// (fire-and-forget;失败即保持锁定并清掉过期缓存)
if (browser && tokenEncBlob !== null) {
	const blob = tokenEncBlob;
	void (async () => {
		const sessionKey = await readCachedSessionKey(blob, 'agent');
		if (!sessionKey) return;
		try {
			const plain = await decryptApiKeyWithSessionKey(blob, sessionKey);
			agentConfig.update((c) => ({ ...c, authToken: plain, locked: false }));
		} catch {
			clearSessionKeyCache('agent');
		}
	})();
}

// === 便捷更新函数 ===

export function setAgentEnabled(enabled: boolean): void {
	agentConfig.update((c) => ({ ...c, enabled }));
}

export function setAgentBaseUrl(baseUrl: string): void {
	agentConfig.update((c) => ({ ...c, baseUrl: baseUrl.trim() }));
}

/**
 * 更新运行时 Token(内存)。落盘与否取决于 tokenStorage:
 * plain 模式随订阅自动持久化(仅显式 plain 用户);encrypted/none 模式仅运行时,
 * 持久化须经 saveAgentTokenEncrypted / saveAgentTokenPlain。
 */
export function setAgentToken(token: string): void {
	agentConfig.update((c) => ({ ...c, authToken: token }));
}

/** 重置为默认配置(连同加密块与会话缓存) */
export function resetAgentConfig(): void {
	tokenEncBlob = null;
	if (browser) clearSessionKeyCache('agent');
	agentConfig.set({ ...DEFAULT_CONFIG });
}

/** 清空已保存 Token(保留其他连接配置;连同加密块与会话缓存) */
export function clearAgentToken(): void {
	tokenEncBlob = null;
	if (browser) clearSessionKeyCache('agent');
	agentConfig.update((c) => ({
		...c,
		authToken: '',
		tokenStorage: 'none' as AgentTokenStorage,
		locked: false
	}));
}

/** 显式选择明文保存(UI 需警示;空 Token 视为清除) */
export function saveAgentTokenPlain(token: string): void {
	tokenEncBlob = null;
	if (browser) clearSessionKeyCache('agent');
	agentConfig.update((c) => ({
		...c,
		authToken: token,
		tokenStorage: token ? ('plain' as AgentTokenStorage) : ('none' as AgentTokenStorage),
		locked: false
	}));
}

export type SaveAgentTokenResult = { ok: true } | { ok: false; error: SaveAgentTokenError };
export type UnlockAgentTokenResult =
	| { ok: true }
	| { ok: false; error: 'wrong-passphrase' | 'no-encrypted-token' | 'crypto-unavailable' };
export type SaveAgentTokenError =
	| 'token-empty'
	| 'passphrase-short'
	| 'crypto-unavailable'
	| 'encrypt-failed';

/**
 * 以口令加密保存 Token(缺省推荐路径)。
 * 成功后:运行时 Token 可用 + tokenEnc 块落盘 + 会话密钥缓存(scope=agent)。
 */
export async function saveAgentTokenEncrypted(
	token: string,
	passphrase: string
): Promise<SaveAgentTokenResult> {
	if (!token) return { ok: false, error: 'token-empty' };
	if (passphrase.trim().length < PASSPHRASE_MIN_LEN) {
		return { ok: false, error: 'passphrase-short' };
	}
	if (!hasWebCrypto()) return { ok: false, error: 'crypto-unavailable' };
	try {
		const blob = await encryptApiKey(token, passphrase.trim());
		tokenEncBlob = blob;
		agentConfig.update((c) => ({
			...c,
			authToken: token,
			tokenStorage: 'encrypted' as AgentTokenStorage,
			locked: false
		}));
		await cacheSessionKey(blob, passphrase.trim(), 'agent');
		return { ok: true };
	} catch {
		return { ok: false, error: 'encrypt-failed' };
	}
}

/**
 * 解锁已加密保存的 Token:优先用 sessionStorage 会话密钥(免重输),
 * 否则用口令派生。成功后运行时 Token 可用;口令路径成功会刷新会话缓存。
 */
export async function unlockAgentToken(passphrase: string): Promise<UnlockAgentTokenResult> {
	if (tokenEncBlob === null) return { ok: false, error: 'no-encrypted-token' };
	if (!hasWebCrypto()) return { ok: false, error: 'crypto-unavailable' };
	const blob = tokenEncBlob;
	// 1) 会话密钥(同标签页已解锁过)
	const sessionKey = await readCachedSessionKey(blob, 'agent');
	if (sessionKey) {
		try {
			const plain = await decryptApiKeyWithSessionKey(blob, sessionKey);
			agentConfig.update((c) => ({ ...c, authToken: plain, locked: false }));
			return { ok: true };
		} catch {
			clearSessionKeyCache('agent'); // 过期缓存(如他处改了口令),回落口令路径
		}
	}
	// 2) 口令派生
	if (!passphrase) return { ok: false, error: 'wrong-passphrase' };
	try {
		const plain = await decryptApiKey(blob, passphrase.trim());
		agentConfig.update((c) => ({ ...c, authToken: plain, locked: false }));
		await cacheSessionKey(blob, passphrase.trim(), 'agent');
		return { ok: true };
	} catch {
		return { ok: false, error: 'wrong-passphrase' };
	}
}

/** 立即锁定(清运行时 Token 与会话缓存;加密块保留,解锁后恢复) */
export function lockAgentToken(): void {
	if (browser) clearSessionKeyCache('agent');
	agentConfig.update((c) =>
		c.tokenStorage === 'encrypted' ? { ...c, authToken: '', locked: true } : c
	);
}

/**
 * 检查配置是否形式完备(用于决定 Agent 会话台入口是否可用)。
 * 完备 = enabled && baseUrl 非空;Token 可空(serve 未开鉴权场景)。
 * 只做形式检查,可达性由 testAgentConnection() 在用户主动测试时验证。
 */
export function isAgentConfigured(cfg: AgentConfig): boolean {
	return cfg.enabled && cfg.baseUrl.trim().length > 0;
}

export interface AgentSummary {
	agent_type: string;
	version: string;
	description: string;
	tools: string[];
}

export type TestAgentConnectionResult =
	| { ok: true; agents: AgentSummary[] }
	| { ok: false; message: string };

/**
 * 连接测试:GET /agents(与 agent 角色清单同一端点,顺带验证鉴权)。
 * serve 开启鉴权时带 Bearer 头;本函数不打印 Token,错误消息不携带凭据。
 */
export async function testAgentConnection(
	cfg: AgentConfig
): Promise<TestAgentConnectionResult> {
	const base = cfg.baseUrl.trim().replace(/\/+$/, '');
	try {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (cfg.authToken) headers.Authorization = `Bearer ${cfg.authToken}`;
		const res = await fetch(`${base}/agents`, { headers });
		if (res.status === 401) {
			return { ok: false, message: 'unauthorized' };
		}
		if (!res.ok) {
			return { ok: false, message: `http-${res.status}` };
		}
		const data = (await res.json()) as { agents?: AgentSummary[] };
		if (!Array.isArray(data.agents)) {
			return { ok: false, message: 'bad-payload' };
		}
		return { ok: true, agents: data.agents };
	} catch (e) {
		return { ok: false, message: (e as Error).message || 'network-error' };
	}
}

// === LLM 配置状态(脱敏只读;O-029 收口) ===

export interface AgentLlmKeyStatus {
	/** evo-agent 侧是否已配置 key(仅存在性,永不含 key 值) */
	present: boolean;
	/** 末 4 位提示(服务端脱敏生成;不足 4 位时缺省) */
	hint: string | null;
	/** key 来源(环境变量名或 "config") */
	source: string | null;
}

export interface AgentLlmStatus {
	/** = api_key 存在(能否思考的唯一硬事实) */
	configured: boolean;
	provider: string;
	model: string;
	/** 不含 query/fragment 的 API 地址 */
	api_base: string;
	api_key: AgentLlmKeyStatus;
}

export type AgentLlmStatusResult =
	| { ok: true; status: AgentLlmStatus }
	| { ok: false; message: string };

/**
 * 查询 evo-agent 侧 LLM 配置状态:GET /admin/llm-status(走既有鉴权中间件)。
 * 响应本身脱敏(全值 key 永不出网);本函数不打印 Token,错误消息不携带凭据。
 */
export async function fetchAgentLlmStatus(cfg: AgentConfig): Promise<AgentLlmStatusResult> {
	const base = cfg.baseUrl.trim().replace(/\/+$/, '');
	try {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (cfg.authToken) headers.Authorization = `Bearer ${cfg.authToken}`;
		const res = await fetch(`${base}/admin/llm-status`, { headers });
		if (res.status === 401) {
			return { ok: false, message: 'unauthorized' };
		}
		if (!res.ok) {
			return { ok: false, message: `http-${res.status}` };
		}
		const data = (await res.json()) as Record<string, unknown> | null;
		if (
			!data ||
			typeof data !== 'object' ||
			!data.api_key ||
			typeof data.api_key !== 'object' ||
			typeof (data.api_key as Record<string, unknown>).present !== 'boolean'
		) {
			return { ok: false, message: 'bad-payload' };
		}
		const key = data.api_key as Record<string, unknown>;
		return {
			ok: true,
			status: {
				configured: data.configured === true,
				provider: typeof data.provider === 'string' ? data.provider : '',
				model: typeof data.model === 'string' ? data.model : '',
				api_base: typeof data.api_base === 'string' ? data.api_base : '',
				api_key: {
					present: key.present === true,
					hint: typeof key.hint === 'string' ? key.hint : null,
					source: typeof key.source === 'string' ? key.source : null
				}
			}
		};
	} catch (e) {
		return { ok: false, message: (e as Error).message || 'network-error' };
	}
}
