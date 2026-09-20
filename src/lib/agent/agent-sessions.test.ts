// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// agent-sessions store 单测 — 会话元数据持久化(localStorage)
// 覆盖:创建/回填会话 ID/标题与状态更新/落盘回读(含损坏条目过滤)/重置
// localStorage 为浏览器能力,按文件声明 jsdom 环境
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const STORAGE_KEY = 'evorule-console-cloud:agent-sessions';

async function fresh() {
	vi.resetModules();
	return await import('./agent-sessions');
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(async () => {
	const mod = await fresh();
	mod.resetAgentSessions();
});

describe('agent-sessions — 会话生命周期', () => {
	it('createSession:草稿态(无服务端 ID/版本 1)且即落盘,最新在前', async () => {
		const { createSession, agentSessions } = await fresh();
		const a = createSession('general', '第一个');
		const b = createSession('researcher', '第二个');
		const list = get(agentSessions);
		expect(list.map((s) => s.localId)).toEqual([b.localId, a.localId]);
		expect(list[0]).toMatchObject({
			sessionId: '',
			title: '第二个',
			role: 'researcher',
			status: 'draft',
			version: 1
		});
		const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown[];
		expect(persisted).toHaveLength(2);
	});

	it('attachSessionId:草稿转正式(idle + 会话 ID 回填)', async () => {
		const { createSession, attachSessionId, agentSessions } = await fresh();
		const s = createSession('general', '新会话');
		attachSessionId(s.localId, 'session_9f3a2c');
		const [item] = get(agentSessions);
		expect(item.sessionId).toBe('session_9f3a2c');
		expect(item.status).toBe('idle');
	});

	it('setSessionTitle/setSessionStatus:更新并持久化', async () => {
		const { createSession, setSessionTitle, setSessionStatus, agentSessions } = await fresh();
		const s = createSession('general', '草稿');
		setSessionTitle(s.localId, 'serve 白名单排查');
		setSessionStatus(s.localId, 'disconnected');
		const [item] = get(agentSessions);
		expect(item.title).toBe('serve 白名单排查');
		expect(item.status).toBe('disconnected');
		const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Array<{
			title: string;
			status: string;
		}>;
		expect(persisted[0].title).toBe('serve 白名单排查');
		expect(persisted[0].status).toBe('disconnected');
	});
});

describe('agent-sessions — 持久化回读与防御', () => {
	it('回读:合法条目恢复、损坏条目过滤(不静默造数据)', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify([
				{
					localId: 's-ok',
					sessionId: 'session_abc',
					title: '历史会话',
					role: 'rule-copilot',
					status: 'idle',
					version: 1,
					createdAt: 1,
					updatedAt: 2
				},
				{ localId: '' }, // 缺 localId → 丢弃
				{ localId: 's-bad', status: 'ghost' }, // 非法状态 → 丢弃
				'nonsense' // 非对象 → 丢弃
			])
		);
		const { agentSessions } = await fresh();
		const list = get(agentSessions);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ localId: 's-ok', title: '历史会话' });
	});

	it('回读:非数组/坏 JSON 按空处理', async () => {
		localStorage.setItem(STORAGE_KEY, '{"oops":true');
		const { agentSessions } = await fresh();
		expect(get(agentSessions)).toEqual([]);
		localStorage.setItem(STORAGE_KEY, '42');
		const mod = await fresh();
		expect(get(mod.agentSessions)).toEqual([]);
	});

	it('resetAgentSessions:内存与 localStorage 双清', async () => {
		const { createSession, resetAgentSessions, agentSessions } = await fresh();
		createSession('general', '临时');
		expect(get(agentSessions)).toHaveLength(1);
		resetAgentSessions();
		expect(get(agentSessions)).toEqual([]);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});
