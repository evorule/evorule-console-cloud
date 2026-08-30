// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 审计桥(侧车协议)单测
//
// 运行: npx vitest run src/lib/assistant/audited-llm.test.ts
//
// 测试范围(与 evo-agent audited_llm.rs 测试面同构):
//   - happy path 全协议:create_session → SSE(IoRequest+Stable) →
//     command(承载 messages 全文) → io_response(承载结果全文) → 返回回复
//   - 多轮 history 进命令事实(prompt 全文与实际 LLM 请求一致)
//   - LLM 执行失败:错误仍回写 io_response(不留悬空 IoRequest)后如实上抛
//   - 引擎 Error 事件:如实上抛 AuditedBridgeError(kind=engine)
//   - SSE 流在 Stable 前关闭:如实报 protocol 错误
//   - create_session HTTP 失败:如实报 protocol 错误(无静默直连兜底)
//   - server 不可达(网络错误):kind=server_unreachable
//   - authToken:请求携带 Authorization 头

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { callChatApiAudited, AuditedBridgeError } from './audited-llm';
import { netConfig } from '$lib/config/net-config';
import { LlmAuthError } from './llm-fetch';

const SERVER_BASE = 'http://test-server';
const API_ENDPOINT = 'https://llm.example/v1/chat/completions';

// ============ mock fetch ============

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE_PARAMS = {
	apiEndpoint: API_ENDPOINT,
	apiKey: 'sk-audit-test-key',
	model: 'test-model',
	userMessage: '帮我写一条规则'
};

beforeEach(() => {
	mockFetch.mockReset();
	// 审计桥从 netConfig 解析 server 基址;online 模式指向测试地址
	netConfig.set({ mode: 'online', remoteBaseUrl: SERVER_BASE, authToken: '' });
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============ 测试工具 ============

/** LLM 聊天补全响应(OpenAI 兼容) */
function chatResponse(content: string): Response {
	return {
		ok: true,
		status: 200,
		text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
		json: async () => ({ choices: [{ message: { content } }] })
	} as unknown as Response;
}

/** SSE 响应(body 为一次性推完的 data 行流) */
function sseResponse(events: object[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const e of events) {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
			}
			controller.close();
		}
	});
	return { ok: true, status: 200, body: stream } as unknown as Response;
}

/** 空对象 200 响应 */
function emptyOk(): Response {
	return {
		ok: true,
		status: 200,
		text: async () => '{}',
		json: async () => ({})
	} as unknown as Response;
}

/** 挂载全套 sidecar mock,返回按类捕获的请求记录 */
function mountSidecarMocks(opts: {
	sseEvents: object[];
	llm?: () => Response;
	createSessionStatus?: number;
}) {
	const calls = {
		commandBodies: [] as Array<{ instruction: { type: string; params: Record<string, unknown> } }>,
		ioResponseBodies: [] as Array<{ request_id: number; result: unknown; error: string | null }>,
		llmBodies: [] as unknown[]
	};
	mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
		const method = (init?.method ?? 'GET').toUpperCase();
		if (url === `${SERVER_BASE}/api/sessions` && method === 'POST') {
			if (opts.createSessionStatus !== undefined) {
				return {
					ok: false,
					status: opts.createSessionStatus,
					text: async () => 'server busy',
					json: async () => ({ error: 'server busy' })
				} as unknown as Response;
			}
			return {
				ok: true,
				status: 200,
				json: async () => ({ session_id: 42, message: 'Session created' })
			} as unknown as Response;
		}
		if (url === `${SERVER_BASE}/api/sessions/42/events`) {
			return sseResponse(opts.sseEvents);
		}
		if (url === `${SERVER_BASE}/api/sessions/42/command`) {
			calls.commandBodies.push(JSON.parse(String(init?.body)));
			return emptyOk();
		}
		if (url === `${SERVER_BASE}/api/sessions/42/io_response`) {
			calls.ioResponseBodies.push(JSON.parse(String(init?.body)));
			return emptyOk();
		}
		if (url === `${SERVER_BASE}/api/sessions/42` && method === 'DELETE') {
			return emptyOk();
		}
		if (url === API_ENDPOINT) {
			calls.llmBodies.push(JSON.parse(String(init?.body)));
			return opts.llm ? opts.llm() : chatResponse('好的,这是回复');
		}
		throw new Error(`mock fetch 未处理的请求: ${method} ${url}`);
	});
	return calls;
}

// ============ happy path ============

describe('审计桥 happy path', () => {
	test('全协议走通:命令带 messages 全文,io_response 带结果全文,返回回复', async () => {
		const calls = mountSidecarMocks({
			sseEvents: [{ type: 'IoRequest', id: 5, io_type: 'call_external' }, { type: 'Stable' }]
		});

		const reply = await callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'draft_rule' });

		expect(reply).toBe('好的,这是回复');

		// 命令事实:call_external + prompt 全文 + audit_purpose
		expect(calls.commandBodies).toHaveLength(1);
		const cmd = calls.commandBodies[0];
		expect(cmd.instruction.type).toBe('call_external');
		expect(cmd.instruction.params.audit_purpose).toBe('draft_rule');
		expect(cmd.instruction.params.model).toBe('test-model');
		expect(cmd.instruction.params.messages).toEqual([{ role: 'user', content: '帮我写一条规则' }]);

		// LLM 本地执行:实际发给 LLM 的 messages 与命令事实一致
		expect(calls.llmBodies).toHaveLength(1);
		expect((calls.llmBodies[0] as { messages: unknown }).messages).toEqual(
			cmd.instruction.params.messages
		);

		// io_response:结果全文回写,无 error
		expect(calls.ioResponseBodies).toHaveLength(1);
		expect(calls.ioResponseBodies[0]).toEqual({
			request_id: 5,
			result: { content: '好的,这是回复' },
			error: null
		});
	});

	test('多轮 history 进命令事实(审计内容与真实请求一致)', async () => {
		const calls = mountSidecarMocks({
			sseEvents: [{ type: 'IoRequest', id: 1 }, { type: 'Stable' }]
		});

		await callChatApiAudited({
			...BASE_PARAMS,
			systemMessage: '你是助手',
			history: [
				{ role: 'user', content: '第一问' },
				{ role: 'assistant', content: '第一答' }
			],
			auditPurpose: 'chat'
		});

		const expectedMessages = [
			{ role: 'system', content: '你是助手' },
			{ role: 'user', content: '第一问' },
			{ role: 'assistant', content: '第一答' },
			{ role: 'user', content: '帮我写一条规则' }
		];
		expect(calls.commandBodies[0].instruction.params.messages).toEqual(expectedMessages);
		expect((calls.llmBodies[0] as { messages: unknown }).messages).toEqual(expectedMessages);
	});

	test('authToken 存在时请求携带 Authorization 头', async () => {
		netConfig.set({
			mode: 'online',
			remoteBaseUrl: SERVER_BASE,
			authToken: 'secret-token'
		});
		mountSidecarMocks({
			sseEvents: [{ type: 'IoRequest', id: 2 }, { type: 'Stable' }]
		});

		await callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'help_qa' });

		// 仅校验 server 侧请求(create/command/io_response);
		// LLM 端点带自己的 Bearer apiKey,不在此范围
		const serverCalls = mockFetch.mock.calls.filter(([u]) =>
			String(u).startsWith(SERVER_BASE)
		);
		expect(serverCalls.length).toBeGreaterThanOrEqual(3); // create/command/io_response
		for (const [, init] of serverCalls) {
			const h = (init as RequestInit | undefined)?.headers as Record<string, string>;
			expect(h['Authorization']).toBe('Bearer secret-token');
		}
	});
});

// ============ 失败语义 ============

describe('审计桥失败语义', () => {
	test('LLM 执行失败:错误仍回写 io_response,再如实上抛原始 LLM 错误', async () => {
		const calls = mountSidecarMocks({
			sseEvents: [{ type: 'IoRequest', id: 9 }],
			llm: () =>
				({
					ok: false,
					status: 401,
					text: async () => '{"error":{"message":"invalid key"}}',
					json: async () => ({ error: { message: 'invalid key' } })
				}) as unknown as Response
		});

		await expect(
			callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'explain_rule' })
		).rejects.toBeInstanceOf(LlmAuthError);

		// 关键契约:错误 io_response 必须被调用(不留悬空 IoRequest)
		expect(calls.ioResponseBodies).toHaveLength(1);
		expect(calls.ioResponseBodies[0].request_id).toBe(9);
		expect(calls.ioResponseBodies[0].error).toBeTruthy();
	});

	test('引擎 Error 事件:如实上抛 AuditedBridgeError(kind=engine)', async () => {
		mountSidecarMocks({
			sseEvents: [
				{ type: 'IoRequest', id: 3 },
				{ type: 'Error', message: 'path resolution failed' }
			]
		});

		const err = await callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'chat' }).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(AuditedBridgeError);
		expect((err as AuditedBridgeError).kind).toBe('engine');
		expect((err as Error).message).toContain('path resolution failed');
	});

	test('SSE 流在 Stable 前关闭:如实报 protocol 错误', async () => {
		mountSidecarMocks({
			sseEvents: [{ type: 'IoRequest', id: 1 }]
		});

		const err = await callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'chat' }).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(AuditedBridgeError);
		expect((err as AuditedBridgeError).kind).toBe('protocol');
		expect((err as Error).message).toContain('Stable');
	});

	test('create_session HTTP 失败(500):如实报 protocol 错误,无静默直连兜底', async () => {
		const calls = mountSidecarMocks({
			sseEvents: [],
			createSessionStatus: 500
		});

		await expect(
			callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'draft_rule' })
		).rejects.toMatchObject({ kind: 'protocol' });

		// 未走直连:LLM 端点未被调用
		expect(calls.llmBodies).toHaveLength(0);
	});

	test('server 不可达(网络错误):kind=server_unreachable', async () => {
		mockFetch.mockImplementation(async () => {
			throw new TypeError('fetch failed');
		});

		const err = await callChatApiAudited({ ...BASE_PARAMS, auditPurpose: 'chat' }).catch(
			(e) => e
		);
		expect(err).toBeInstanceOf(AuditedBridgeError);
		expect((err as AuditedBridgeError).kind).toBe('server_unreachable');
	});
});
