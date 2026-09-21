// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — Agent 会话元数据持久化 store(localStorage)
//
// 范围:仅会话元数据(标题/角色/服务端会话 ID/状态/版本指针)落盘;
// 消息内容不落盘——刷新后对话流以「续接提示行」呈现,上下文由 evo-agent
// 侧按会话 ID 保留(续接语义由 AgentClient 承担),UI 不伪造历史消息。
//
// 形态:草稿(draft,尚未从服务端取得会话 ID)→ 建立(idle)→ 可达性异常
// (disconnected,显式断线态)。活跃轮次的「绿点脉动」是选中态+轮次进行中
// 的派生视觉,不落盘。

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

/** 会话条目持久状态(live 派生态不在此列) */
export type AgentSessionStatus = 'draft' | 'idle' | 'disconnected';

export interface AgentSession {
	/** 本地唯一标识(草稿期服务端会话 ID 尚未产生,续接/持久化均以此为主键) */
	localId: string;
	/** 服务端会话 ID(空串 = 草稿,尚未建立) */
	sessionId: string;
	title: string;
	role: string;
	status: AgentSessionStatus;
	/** 工作区版本指针(初始 1;每完成一轮 +1 的轮次近似口径,rewind 回执以 actual_version 权威修正) */
	version: number;
	/** 会话是否执行过回滚(左栏「已回滚」角标;回滚成功后置位,持久留存) */
	rolledBack: boolean;
	/** 是否开启多轮记忆(SessionCreated.memory_enabled;左栏「多轮记忆」小徽标,仅 true 显示) */
	memoryEnabled: boolean;
	createdAt: number;
	updatedAt: number;
}

const STORAGE_KEY = 'evorule-console-cloud:agent-sessions';
const MAX_SESSIONS = 50;

const VALID_STATUS: readonly AgentSessionStatus[] = ['draft', 'idle', 'disconnected'];

function makeLocalId(): string {
	if (browser && typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSession(v: unknown): v is AgentSession {
	if (typeof v !== 'object' || v === null) return false;
	const s = v as Record<string, unknown>;
	return (
		typeof s.localId === 'string' &&
		s.localId.length > 0 &&
		typeof s.sessionId === 'string' &&
		typeof s.title === 'string' &&
		typeof s.role === 'string' &&
		VALID_STATUS.includes(s.status as AgentSessionStatus) &&
		typeof s.version === 'number' &&
		Number.isFinite(s.version) &&
		typeof s.createdAt === 'number' &&
		Number.isFinite(s.createdAt) &&
		typeof s.updatedAt === 'number' &&
		Number.isFinite(s.updatedAt)
	);
}

/** 旧版落盘数据无 rolledBack/memoryEnabled 字段,装载时归一化为 false */
function normalize(s: AgentSession): AgentSession {
	return { ...s, rolledBack: s.rolledBack === true, memoryEnabled: s.memoryEnabled === true };
}

function loadSessions(): AgentSession[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		// 最新在前(创建时 unshift;损坏条目过滤,不静默造数据)
		return parsed.filter(isSession).map(normalize).slice(0, MAX_SESSIONS);
	} catch {
		return [];
	}
}

export const agentSessions = writable<AgentSession[]>(loadSessions());

agentSessions.subscribe((list) => {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)));
	} catch {
		// 存储不可用(隐私模式/配额):会话仅本页内存可用,不阻断交互
	}
});

/** 新建草稿会话(未连接;首个发送任务时经服务端建立并回填会话 ID) */
export function createSession(role: string, title: string): AgentSession {
	const now = Date.now();
	const s: AgentSession = {
		localId: makeLocalId(),
		sessionId: '',
		title,
		role,
		status: 'draft',
		version: 1,
		rolledBack: false,
		memoryEnabled: false,
		createdAt: now,
		updatedAt: now
	};
	agentSessions.update((list) => [s, ...list].slice(0, MAX_SESSIONS));
	return s;
}

/** 服务端会话建立(SessionCreated)后回填会话 ID;草稿转正式 */
export function attachSessionId(localId: string, sessionId: string): void {
	agentSessions.update((list) =>
		list.map((s) =>
			s.localId === localId ? { ...s, sessionId, status: 'idle' as const, updatedAt: Date.now() } : s
		)
	);
}

export function setSessionTitle(localId: string, title: string): void {
	agentSessions.update((list) =>
		list.map((s) => (s.localId === localId ? { ...s, title, updatedAt: Date.now() } : s))
	);
}

export function setSessionStatus(localId: string, status: AgentSessionStatus): void {
	agentSessions.update((list) =>
		list.map((s) => (s.localId === localId ? { ...s, status, updatedAt: Date.now() } : s))
	);
}

export function touchSession(localId: string): void {
	agentSessions.update((list) =>
		list.map((s) => (s.localId === localId ? { ...s, updatedAt: Date.now() } : s))
	);
}

/** 版本指针 +1(每完成一轮 Done 调用;轮次近似口径,回滚前后一致递推) */
export function advanceSessionVersion(localId: string): void {
	agentSessions.update((list) =>
		list.map((s) =>
			s.localId === localId ? { ...s, version: s.version + 1, updatedAt: Date.now() } : s
		)
	);
}

/**
 * 版本指针权威修正(rewind 回执 actual_version;服务端 Fact 版本为准)。
 * 与 advanceSessionVersion 的每轮 +1 轮次近似口径相区分:回执携带的
 * actual_version 可能与请求目标版本不一致,以此处为权威。
 */
export function updateSessionVersion(localId: string, actualVersion: number): void {
	agentSessions.update((list) =>
		list.map((s) =>
			s.localId === localId ? { ...s, version: actualVersion, updatedAt: Date.now() } : s
		)
	);
}

/** 回滚收敛:「已回滚」角标置位(版本指针由 updateSessionVersion 按 actual_version 权威修正) */
export function setSessionRewound(localId: string): void {
	agentSessions.update((list) =>
		list.map((s) => (s.localId === localId ? { ...s, rolledBack: true, updatedAt: Date.now() } : s))
	);
}

/** 多轮记忆标记回填(SessionCreated.memory_enabled;服务端开启时置 true) */
export function setSessionMemoryEnabled(localId: string, enabled: boolean): void {
	agentSessions.update((list) =>
		list.map((s) =>
			s.localId === localId ? { ...s, memoryEnabled: enabled, updatedAt: Date.now() } : s
		)
	);
}

/** 清空会话(测试辅助;亦可用于用户主动重置会话列表) */
export function resetAgentSessions(): void {
	// 先置空再删键:置空会触发订阅持久化,顺序反了会把空表写回
	agentSessions.set([]);
	if (browser) {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			// 忽略存储异常,内存态照常清空
		}
	}
}
