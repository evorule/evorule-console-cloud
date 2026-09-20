// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — AgentClient(WS 双向为主 + REST 兜底)单测
//
// 覆盖面:事件解析全表 / 帧收发 / 建连超时 / 首连失败 /
// 指数退避重连与会话续接 / 重连耗尽 / 用户关闭 / REST 兜底(listAgents/approve/cancel)。
// WS 以最小桩注入(与浏览器 WebSocket 同构的同步回调),fetch 以 vi.fn() 注入。

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentClient, type AgentStatusDetail, type AgentWebSocketLike } from './agent-client';
import { parseAgentEvent } from './types';

// ==== WS 桩 ====

class MockSocket implements AgentWebSocketLike {
	static made: MockSocket[] = [];
	readyState = 0;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
	onerror: ((ev: unknown) => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	constructor(readonly url: string) {
		MockSocket.made.push(this);
	}
	send(data: string): void {
		if (this.readyState !== 1) throw new Error('invalid-state');
		this.sent.push(data);
	}
	close(code?: number, reason?: string): void {
		this.readyState = 3;
		this.onclose?.({ code, reason });
	}
	// 测试辅助:模拟服务端行为
	serverOpen(): void {
		this.readyState = 1;
		this.onopen?.();
	}
	serverSend(frame: unknown): void {
		this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
	}
	serverClose(): void {
		this.readyState = 3;
		this.onclose?.({ code: 1006, reason: '' });
	}
}

type StatusEntry = { status: string; detail?: AgentStatusDetail };

function makeClient(
	overrides: Partial<ConstructorParameters<typeof AgentClient>[0]> = {}
): { client: AgentClient; events: unknown[]; statuses: StatusEntry[] } {
	const events: unknown[] = [];
	const statuses: StatusEntry[] = [];
	const client = new AgentClient({
		baseUrl: 'http://127.0.0.1:8081',
		agentType: 'general',
		authToken: 'secret-token',
		onEvent: (e) => void events.push(e),
		onStatus: (s, d) => void statuses.push({ status: s, detail: d }),
		wsFactory: (url) => new MockSocket(url),
		fetchImpl: vi.fn() as unknown as typeof fetch,
		...overrides
	});
	return { client, events, statuses };
}

const lastSocket = (): MockSocket => MockSocket.made[MockSocket.made.length - 1];

beforeEach(() => {
	MockSocket.made = [];
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('parseAgentEvent 事件解析(API.md §6 全表)', () => {
	test('九类事件全表解析', () => {
		expect(parseAgentEvent('{"type":"SessionCreated","session_id":"42"}')).toEqual({
			type: 'SessionCreated',
			session_id: '42'
		});
		expect(parseAgentEvent('{"type":"LlmDelta","text":"好的"}')).toEqual({
			type: 'LlmDelta',
			text: '好的'
		});
		expect(parseAgentEvent('{"type":"ToolCall","name":"file_read","args":{"path":"a.rs"}}')).toEqual(
			{
				type: 'ToolCall',
				name: 'file_read',
				args: { path: 'a.rs' }
			}
		);
		expect(
			parseAgentEvent('{"type":"ToolResult","name":"file_read","result":{"ok":true}}')
		).toEqual({
			type: 'ToolResult',
			name: 'file_read',
			result: { ok: true }
		});
		expect(
			parseAgentEvent(
				'{"type":"ApprovalRequired","tool_name":"shell_exec","command":"rm -rf /tmp/t","risk":"high","alternative":"use trash"}'
			)
		).toEqual({
			type: 'ApprovalRequired',
			tool_name: 'shell_exec',
			command: 'rm -rf /tmp/t',
			risk: 'high',
			alternative: 'use trash'
		});
		expect(parseAgentEvent('{"type":"ApprovalResult","tool_name":"shell_exec","approved":true}')).toEqual(
			{
				type: 'ApprovalResult',
				tool_name: 'shell_exec',
				approved: true
			}
		);
		expect(
			parseAgentEvent('{"type":"Done","success":true,"content":"完成","steps":3,"duration_ms":1523}')
		).toEqual({
			type: 'Done',
			success: true,
			content: '完成',
			steps: 3,
			duration_ms: 1523
		});
		expect(parseAgentEvent('{"type":"Error","error":"boom"}')).toEqual({
			type: 'Error',
			error: 'boom'
		});
		expect(parseAgentEvent('{"type":"Info","message":"interrupt sent"}')).toEqual({
			type: 'Info',
			message: 'interrupt sent'
		});
	});

	test('坏帧返回 null(非法 JSON / 非对象 / 未知 type / 必填字段缺失)', () => {
		expect(parseAgentEvent('not-json')).toBeNull();
		expect(parseAgentEvent('null')).toBeNull();
		expect(parseAgentEvent('42')).toBeNull();
		expect(parseAgentEvent('{}')).toBeNull();
		expect(parseAgentEvent('{"type":"Unknown"}')).toBeNull();
		expect(parseAgentEvent('{"type":"SessionCreated"}')).toBeNull();
		expect(parseAgentEvent('{"type":"LlmDelta"}')).toBeNull();
		expect(parseAgentEvent('{"type":"Done","success":true,"content":"x"}')).toBeNull();
	});

	test('宽容:多余字段忽略、可选字段缺省', () => {
		expect(parseAgentEvent('{"type":"LlmDelta","text":"a","extra":1}')).toEqual({
			type: 'LlmDelta',
			text: 'a'
		});
		expect(parseAgentEvent('{"type":"ApprovalRequired","tool_name":"file_write"}')).toEqual({
			type: 'ApprovalRequired',
			tool_name: 'file_write'
		});
	});

	test('Done.cancelled:中断收敛帧(cancelled=true;旧载荷缺省视为 false)', () => {
		expect(
			parseAgentEvent(
				'{"type":"Done","success":false,"content":"","steps":4,"duration_ms":4000,"cancelled":true}'
			)
		).toEqual({
			type: 'Done',
			success: false,
			content: '',
			steps: 4,
			duration_ms: 4000,
			cancelled: true
		});
	});
});

describe('建连与 URL', () => {
	test('connect 成功:状态序列 + URL(new 会话 + token)', async () => {
		const { client, statuses } = makeClient();
		const p = client.connect();
		expect(client.linkStatus).toBe('connecting');
		lastSocket().serverOpen();
		await p;
		expect(statuses.map((s) => s.status)).toEqual(['connecting', 'connected']);
		expect(lastSocket().url).toBe(
			'ws://127.0.0.1:8081/api/sessions/new/ws?agent_type=general&token=secret-token'
		);
		expect(client.linkStatus).toBe('connected');
	});

	test('https → wss;无 token 不带参数', async () => {
		const { client } = makeClient({ baseUrl: 'https://agent.example.com', authToken: undefined });
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		expect(lastSocket().url).toBe('wss://agent.example.com/api/sessions/new/ws?agent_type=general');
	});

	test('指定 sessionId → URL 续接', async () => {
		const { client } = makeClient({ sessionId: '42' });
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		expect(lastSocket().url).toContain('/api/sessions/42/ws');
	});

	test('连接中重复 connect 拒绝', async () => {
		const { client } = makeClient();
		const p1 = client.connect();
		await expect(client.connect()).rejects.toThrow('connect-already-active');
		client.close();
		await expect(p1).rejects.toThrow('connect-cancelled');
	});
});

describe('帧发送', () => {
	test('send/interrupt/rewind 帧 JSON 正确', async () => {
		const { client } = makeClient();
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		client.send('帮我查看当前目录结构');
		client.interrupt();
		client.rewind(5);
		expect(lastSocket().sent).toEqual([
			JSON.stringify({ type: 'message', content: '帮我查看当前目录结构' }),
			JSON.stringify({ type: 'interrupt' }),
			JSON.stringify({ type: 'rewind', version: 5 })
		]);
	});

	test('未连接发送抛 not-connected', () => {
		const { client } = makeClient();
		expect(() => client.send('x')).toThrow('not-connected');
		expect(() => client.interrupt()).toThrow('not-connected');
		expect(() => client.rewind(1)).toThrow('not-connected');
	});
});

describe('事件接收', () => {
	test('SessionCreated 更新 sessionId 并转发事件;坏帧静默', async () => {
		const { client, events } = makeClient();
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		lastSocket().serverSend({ type: 'SessionCreated', session_id: '77' });
		lastSocket().serverSend('garbage');
		lastSocket().serverSend({ type: 'LlmDelta', text: '好' });
		expect(client.sessionId).toBe('77');
		expect(events).toEqual([
			{ type: 'SessionCreated', session_id: '77' },
			{ type: 'LlmDelta', text: '好' }
		]);
	});
});

describe('建连超时与首连失败', () => {
	test('建连超时:reject connect-timeout,进入 disconnected,不自动重试', async () => {
		const { client, statuses } = makeClient({ connectTimeoutMs: 100 });
		const p = client.connect();
		const assertion = expect(p).rejects.toThrow('connect-timeout');
		vi.advanceTimersByTime(100);
		await assertion;
		expect(client.linkStatus).toBe('disconnected');
		expect(statuses[statuses.length - 1]).toEqual({
			status: 'disconnected',
			detail: { error: 'connect-timeout' }
		});
		vi.advanceTimersByTime(60_000);
		expect(MockSocket.made.length).toBe(1);
	});

	test('首连即断:reject connect-failed,不自动重试', async () => {
		const { client, statuses } = makeClient();
		const p = client.connect();
		const assertion = expect(p).rejects.toThrow('connect-failed');
		lastSocket().serverClose();
		await assertion;
		expect(client.linkStatus).toBe('disconnected');
		expect(statuses[statuses.length - 1].detail?.error).toBe('connect-failed');
		vi.advanceTimersByTime(60_000);
		expect(MockSocket.made.length).toBe(1);
	});
});

describe('断线重连与续接', () => {
	test('断线后 1s 重连,URL 续接同会话', async () => {
		const { client, statuses } = makeClient();
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		lastSocket().serverSend({ type: 'SessionCreated', session_id: '77' });
		lastSocket().serverClose();
		expect(client.linkStatus).toBe('reconnecting');
		expect(statuses[statuses.length - 1]).toMatchObject({
			status: 'reconnecting',
			detail: { attempt: 1 }
		});
		vi.advanceTimersByTime(1_000);
		expect(MockSocket.made.length).toBe(2);
		expect(lastSocket().url).toContain('/api/sessions/77/ws');
		lastSocket().serverOpen();
		expect(client.linkStatus).toBe('connected');
		expect(client.sessionId).toBe('77');
	});

	test('重试退避翻倍(1s → 2s)', async () => {
		const { client } = makeClient();
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		lastSocket().serverSend({ type: 'SessionCreated', session_id: '9' });
		lastSocket().serverClose(); // 断线 → 1s 后重试
		vi.advanceTimersByTime(1_000);
		lastSocket().serverClose(); // 重试未连上即断 → 2s 后重试
		vi.advanceTimersByTime(1_000);
		expect(MockSocket.made.length).toBe(2); // 2s 未到
		vi.advanceTimersByTime(1_000);
		expect(MockSocket.made.length).toBe(3);
		expect(lastSocket().url).toContain('/api/sessions/9/ws');
	});

	test('重连耗尽 → disconnected(reconnect-exhausted)', async () => {
		const { client, statuses } = makeClient({ reconnect: { maxAttempts: 2 } });
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		lastSocket().serverClose(); // → retry1 @1s
		vi.advanceTimersByTime(1_000);
		lastSocket().serverClose(); // retry1 失败 → retry2 @2s
		vi.advanceTimersByTime(2_000);
		lastSocket().serverClose(); // retry2 失败 → 耗尽
		expect(client.linkStatus).toBe('disconnected');
		expect(statuses[statuses.length - 1].detail?.error).toBe('reconnect-exhausted');
		vi.advanceTimersByTime(60_000);
		expect(MockSocket.made.length).toBe(3); // 不再重试
	});

	test('耗尽后可重新 connect 续接原会话', async () => {
		const { client } = makeClient({ reconnect: { maxAttempts: 1 } });
		let p = client.connect();
		lastSocket().serverOpen();
		await p;
		lastSocket().serverSend({ type: 'SessionCreated', session_id: '5' });
		lastSocket().serverClose();
		vi.advanceTimersByTime(1_000);
		lastSocket().serverClose(); // 耗尽
		expect(client.linkStatus).toBe('disconnected');
		p = client.connect(); // 用户手动重连
		lastSocket().serverOpen();
		await p;
		expect(lastSocket().url).toContain('/api/sessions/5/ws');
		expect(client.linkStatus).toBe('connected');
	});
});

describe('用户关闭', () => {
	test('已连接后 close:断开且不重连', async () => {
		const { client } = makeClient();
		const p = client.connect();
		lastSocket().serverOpen();
		await p;
		client.close();
		expect(client.linkStatus).toBe('disconnected');
		vi.advanceTimersByTime(60_000);
		expect(MockSocket.made.length).toBe(1);
	});
});

describe('REST 兜底', () => {
	test('listAgents:GET /agents + Bearer 头', async () => {
		const agents = [
			{ agent_type: 'general', version: '0.1.0', description: '通用', tools: ['file_read'] }
		];
		const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ agents }) });
		const { client } = makeClient({ fetchImpl: f as unknown as typeof fetch });
		await expect(client.listAgents()).resolves.toEqual(agents);
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://127.0.0.1:8081/agents');
		expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
	});

	test('listAgents:http 401 抛错', async () => {
		const { client } = makeClient({
			fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch
		});
		await expect(client.listAgents()).rejects.toThrow('list-agents-http-401');
	});

	test('approve:POST body 带 session_id', async () => {
		const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
		const { client } = makeClient({ sessionId: '77', fetchImpl: f as unknown as typeof fetch });
		await expect(client.approve(true)).resolves.toBeUndefined();
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://127.0.0.1:8081/agents/general/approve');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ session_id: '77', approved: true });
	});

	test('approve:无会话抛 no-session', async () => {
		const { client } = makeClient({
			fetchImpl: vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
		});
		await expect(client.approve(true)).rejects.toThrow('no-session');
	});

	test('cancel:URL query session_id;404 抛错', async () => {
		const f = vi.fn().mockResolvedValue({ ok: false, status: 404 });
		const { client } = makeClient({ sessionId: '77', fetchImpl: f as unknown as typeof fetch });
		await expect(client.cancel()).rejects.toThrow('cancel-http-404');
		const [url] = f.mock.calls[0] as [string];
		expect(url).toBe('http://127.0.0.1:8081/agents/general/cancel?session_id=77');
	});
});
