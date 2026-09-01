// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM HTTP 客户端单测(UV-030:MiniMax base_resp 业务错误如实透出)

import { describe, test, expect, vi, afterEach } from 'vitest';
import { callChatApi, LlmApiError, LlmAuthError } from './llm-fetch';

function stubFetch(status: number, body: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
		)
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

const base = {
	apiEndpoint: 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
	apiKey: 'sk-test',
	model: 'MiniMax-Text-01',
	userMessage: 'ping'
};

describe('callChatApi 响应解析', () => {
	test('OpenAI 兼容成功响应(含 MiniMax base_resp status_code=0)→ 返回 content', async () => {
		stubFetch(200, {
			choices: [{ index: 0, message: { content: '你好', role: 'assistant' } }],
			base_resp: { status_code: 0, status_msg: '' }
		});
		await expect(callChatApi(base)).resolves.toBe('你好');
	});

	test('MiniMax 业务错误(200 + base_resp.status_code=2049)→ LlmApiError 透出厂商 status_msg,不误报无 choices', async () => {
		// 2026-09-01 实测形态:{"base_resp":{"status_code":2049,"status_msg":"invalid api key"}}
		stubFetch(200, { base_resp: { status_code: 2049, status_msg: 'invalid api key' } });
		const err = await callChatApi(base).catch((e) => e);
		expect(err).toBeInstanceOf(LlmApiError);
		expect(err.message).toContain('2049');
		expect(err.message).toContain('invalid api key');
		expect(err.message).not.toContain('无 choices');
	});

	test('MiniMax 业务错误缺 status_msg → 仍报 status_code,不静默', async () => {
		stubFetch(200, { base_resp: { status_code: 1008 } });
		const err = await callChatApi(base).catch((e) => e);
		expect(err).toBeInstanceOf(LlmApiError);
		expect(err.message).toContain('1008');
	});

	test('error 字段形态(200)→ LlmApiError 透出厂商错误', async () => {
		stubFetch(200, { error: { message: 'balance insufficient' } });
		const err = await callChatApi(base).catch((e) => e);
		expect(err).toBeInstanceOf(LlmApiError);
		expect(err.message).toContain('balance insufficient');
	});

	test('401 → LlmAuthError(不回显 apiKey)', async () => {
		stubFetch(401, { error: { message: 'unauthorized' } });
		const err = await callChatApi(base).catch((e) => e);
		expect(err).toBeInstanceOf(LlmAuthError);
		expect(err.message).not.toContain('sk-test');
	});
});
