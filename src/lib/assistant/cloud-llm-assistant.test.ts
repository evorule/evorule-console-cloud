// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — CloudLlmAssistant 单测
//
// 运行: npx vitest run src/lib/assistant/cloud-llm-assistant.test.ts
//
// 测试范围:
//   - 三方法 happy path(规则草案 / 解释规则 / 生成输入)
//   - 各错误场景(网络/401/429/JSON 解析失败/响应结构异常)
//   - apiKey 不泄露断言(error.message 不含 apiKey)
//   - isConfigured 配置完备性
//   - testConnection 成功/失败
//   - 草案经内核 RuleValidator 校验(valid 时 confidence=0.7)
//   - markdown 代码块包裹的 JSON 提取

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudLlmAssistant } from './cloud-llm-assistant';
import type { CloudLlmConfig } from './types';
import {
	LlmError,
	LlmNetworkError,
	LlmAuthError,
	LlmRateLimitError,
	LlmApiError,
	LlmParseError,
	LlmResponseError
} from './llm-fetch';

// 审计桥 mock:委托真实 callChatApi(走全局 fetch mock)。
// 协议回路本身由 audited-llm.test.ts 单测覆盖;本文件聚焦三方法的
// prompt 组装/JSON 提取/校验/错误映射,不重复 mock 侧车协议。
vi.mock('./audited-llm', () => ({
	callChatApiAudited: async (
		params: Record<string, unknown> & { auditPurpose?: string }
	): Promise<string> => {
		const { callChatApi } = await import('./llm-fetch');
		const { auditPurpose: _auditPurpose, ...rest } = params;
		void _auditPurpose;
		return callChatApi(rest as unknown as Parameters<typeof callChatApi>[0]);
	}
}));

// ============ mock fetch ============

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
	mockFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============ 测试用配置 ============

const TEST_API_KEY = 'sk-test-key-secret-12345';
const FULL_CONFIG: CloudLlmConfig = {
	enabled: true,
	provider: 'openai',
	apiEndpoint: 'https://api.openai.com/v1/chat/completions',
	apiKey: TEST_API_KEY,
	model: 'gpt-4o-mini'
};

function makeAssistant(config: Partial<CloudLlmConfig> = {}): CloudLlmAssistant {
	return new CloudLlmAssistant({ ...FULL_CONFIG, ...config });
}

function mockOkResponse(content: string): Response {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: async () => ({
			choices: [{ message: { content } }]
		}),
		text: async () => JSON.stringify({ choices: [{ message: { content } }] })
	} as unknown as Response;
}

function mockHttpError(status: number, body: string = ''): Response {
	return {
		ok: false,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		text: async () => body,
		json: async () => ({ error: body })
	} as unknown as Response;
}

// ============ isConfigured ============

describe('isConfigured', () => {
	test('全部完备 返回 true', () => {
		const a = makeAssistant();
		expect(a.isConfigured()).toBe(true);
	});

	test('enabled=false 返回 false', () => {
		const a = makeAssistant({ enabled: false });
		expect(a.isConfigured()).toBe(false);
	});

	test('apiKey 空 返回 false', () => {
		const a = makeAssistant({ apiKey: '' });
		expect(a.isConfigured()).toBe(false);
	});

	test('apiEndpoint 空 返回 false', () => {
		const a = makeAssistant({ apiEndpoint: '' });
		expect(a.isConfigured()).toBe(false);
	});

	test('model 空 返回 false', () => {
		const a = makeAssistant({ model: '' });
		expect(a.isConfigured()).toBe(false);
	});

	test('apiKey 全空白 返回 false', () => {
		const a = makeAssistant({ apiKey: '   ' });
		expect(a.isConfigured()).toBe(false);
	});
});

// ============ testConnection ============

describe('testConnection', () => {
	test('成功 返回 ok=true', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockOkResponse('OK'));
		const result = await a.testConnection();
		expect(result.ok).toBe(true);
		expect(result.message).toContain('连接成功');
	});

	test('配置不完备 返回 ok=false(不调 fetch)', async () => {
		const a = makeAssistant({ enabled: false });
		const result = await a.testConnection();
		expect(result.ok).toBe(false);
		expect(result.message).toContain('配置不完备');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	test('401 错误 返回 ok=false(不暴露 apiKey)', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockHttpError(401, 'Invalid API key'));
		const result = await a.testConnection();
		expect(result.ok).toBe(false);
		expect(result.message).toContain('401');
		// apiKey 不进 message
		expect(result.message).not.toContain(TEST_API_KEY);
	});

	test('网络错误 返回 ok=false(不暴露 apiKey)', async () => {
		const a = makeAssistant();
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
		const result = await a.testConnection();
		expect(result.ok).toBe(false);
		expect(result.message).toContain('网络错误');
		expect(result.message).not.toContain(TEST_API_KEY);
	});
});

// ============ generateRuleDraft happy path ============

describe('generateRuleDraft happy path', () => {
	test('合法 JSON 草案 → confidence=0.7 + rule 对象', async () => {
		const a = makeAssistant();
		const validRuleJson = JSON.stringify({
			transform: [
				{
					type: 'branch',
					params: {
						domain: { type: 'eq', path: '__exec__.instruction.type', value: 'register' },
						on_true: [
							{ type: 'set', params: { attr: '__exec__.payload.status', operation: 'set', value: 'ok' } }
						],
						on_false: []
					}
				},
				{
					type: 'branch',
					params: {
						domain: { type: 'all', inner: [] },
						on_true: [
							{
								type: 'set',
								params: { attr: '__exec__.payload.result', operation: 'set', value: '未匹配' }
							}
						],
						on_false: []
					}
				}
			]
		});
		mockFetch.mockResolvedValue(mockOkResponse(validRuleJson));

		const result = await a.generateRuleDraft('注册时设置 status=ok');
		expect(result.confidence).toBe(0.7);
		expect(result.rule).toHaveProperty('transform');
		// 不应有 _validationErrors 字段(校验通过)
		expect((result.rule as { _validationErrors?: unknown })._validationErrors).toBeUndefined();
	});

	test('markdown ```json 包裹 仍能提取', async () => {
		const a = makeAssistant();
		const validRuleJson = '```json\n' + JSON.stringify({
			transform: [
				{
					type: 'branch',
					params: {
						domain: { type: 'all', inner: [] },
						on_true: [
							{
								type: 'set',
								params: { attr: '__exec__.payload.result', operation: 'set', value: '默认' }
							}
						],
						on_false: []
					}
				}
			]
		}) + '\n```';
		mockFetch.mockResolvedValue(mockOkResponse(validRuleJson));

		const result = await a.generateRuleDraft('默认设置 result=默认');
		expect(result.confidence).toBe(0.7);
		expect(result.rule).toHaveProperty('transform');
	});

	test('markdown ``` 包裹(无语言标识) 仍能提取', async () => {
		const a = makeAssistant();
		const validRuleJson = '```\n' + JSON.stringify({
			transform: [
				{
					type: 'branch',
					params: {
						domain: { type: 'all', inner: [] },
						on_true: [
							{
								type: 'set',
								params: { attr: '__exec__.payload.result', operation: 'set', value: '默认' }
							}
						],
						on_false: []
					}
				}
			]
		}) + '\n```';
		mockFetch.mockResolvedValue(mockOkResponse(validRuleJson));

		const result = await a.generateRuleDraft('默认设置 result=默认');
		expect(result.confidence).toBe(0.7);
	});
});

// ============ generateRuleDraft 校验失败 ============

describe('generateRuleDraft 校验失败', () => {
	test('校验失败 → confidence=0.3 + _validationErrors', async () => {
		const a = makeAssistant();
		// 非法域类型(G4 error 级;注意 G6 缺兜底在 W2.1 后降为 warning,不再构成校验失败)
		const invalidRuleJson = JSON.stringify({
			transform: [
				{
					type: 'branch',
					params: {
						domain: { type: 'greater_than', path: '__exec__.payload.amount', value: 100 },
						on_true: [
							{ type: 'set', params: { attr: '__exec__.payload.status', operation: 'set', value: 'ok' } }
						],
						on_false: []
					}
				},
				{
					type: 'branch',
					params: { domain: { type: 'all', inner: [] }, on_true: [] }
				}
			]
		});
		mockFetch.mockResolvedValue(mockOkResponse(invalidRuleJson));

		const result = await a.generateRuleDraft('注册时设置 status=ok');
		expect(result.confidence).toBe(0.3);
		expect(
			(result.rule as { _validationErrors?: unknown[] })._validationErrors
		).toBeDefined();
	});

	test('JSON 解析失败 → confidence=0 + _error 字段', async () => {
		const a = makeAssistant();
		// LLM 返回的不是 JSON
		mockFetch.mockResolvedValue(mockOkResponse('this is not json at all'));

		const result = await a.generateRuleDraft('描述');
		expect(result.confidence).toBe(0);
		expect((result.rule as { _error?: string })._error).toContain('JSON 解析失败');
	});
});

// ============ explainRule ============

describe('explainRule', () => {
	test('返回说明文本', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockOkResponse('这条规则在用户注册时设置 status=ok。'));

		const result = await a.explainRule({ type: 'set', params: {} });
		expect(result).toContain('注册');
		expect(result).toContain('status');
	});

	test('接受 object 输入(JSON.stringify 后传给 LLM)', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockOkResponse('说明文本'));

		const result = await a.explainRule({ type: 'set' });
		expect(result).toBe('说明文本');
	});

	test('返回值去除首尾空白', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockOkResponse('  说明文本  \n'));

		const result = await a.explainRule({ type: 'set' });
		expect(result).toBe('说明文本');
	});
});

// ============ generateInput ============

describe('generateInput', () => {
	test('返回测试输入 JSON 对象', async () => {
		const a = makeAssistant();
		const inputJson = JSON.stringify({ type: 'register', user_id: 123 });
		mockFetch.mockResolvedValue(mockOkResponse(inputJson));

		const result = await a.generateInput('注册 user_id=123');
		expect(result).toHaveProperty('type', 'register');
		expect(result).toHaveProperty('user_id', 123);
	});

	test('markdown 包裹 仍能提取', async () => {
		const a = makeAssistant();
		const inputJson = '```json\n' + JSON.stringify({ type: 'register' }) + '\n```';
		mockFetch.mockResolvedValue(mockOkResponse(inputJson));

		const result = await a.generateInput('注册');
		expect(result).toHaveProperty('type', 'register');
	});

	test('JSON 解析失败 返回 _error 对象', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockOkResponse('not json'));

		const result = (await a.generateInput('描述')) as {
			_error?: string;
			_raw?: string;
		};
		expect(result._error).toContain('JSON 解析失败');
		expect(result._raw).toBeDefined();
	});
});

// ============ 错误场景(三方法统一) ============

describe('错误场景', () => {
	test('网络错误 抛 LlmNetworkError', async () => {
		const a = makeAssistant();
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(LlmNetworkError);
		await expect(a.explainRule({})).rejects.toThrow(LlmNetworkError);
		await expect(a.generateInput('描述')).rejects.toThrow(LlmNetworkError);
	});

	test('401 抛 LlmAuthError', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockHttpError(401, 'Invalid API key'));

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(LlmAuthError);
		await expect(a.explainRule({})).rejects.toThrow(LlmAuthError);
		await expect(a.generateInput('描述')).rejects.toThrow(LlmAuthError);
	});

	test('429 抛 LlmRateLimitError', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockHttpError(429, 'Rate limited'));

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(LlmRateLimitError);
	});

	test('500 抛 LlmApiError', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockHttpError(500, 'Internal error'));

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(LlmApiError);
	});

	test('JSON 解析失败 抛 LlmParseError', async () => {
		const a = makeAssistant();
		const badJsonResponse = {
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => {
				throw new SyntaxError('Unexpected token in JSON');
			},
			text: async () => 'not-json'
		} as unknown as Response;
		mockFetch.mockResolvedValue(badJsonResponse);

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(LlmParseError);
	});

	test('响应结构异常(无 choices) 抛 LlmResponseError', async () => {
		const a = makeAssistant();
		const noChoicesResponse = {
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({ /* no choices */ }),
			text: async () => '{}'
		} as unknown as Response;
		mockFetch.mockResolvedValue(noChoicesResponse);

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(LlmResponseError);
	});

	test('200 + error 体({error:{message}}) 抛 LlmApiError 并透出真实错误', async () => {
		const a = makeAssistant();
		const vendorError = { error: { message: 'model not found: gpt-4o-unknown' } };
		const response = {
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => vendorError,
			text: async () => JSON.stringify(vendorError)
		} as unknown as Response;
		mockFetch.mockResolvedValue(response);

		try {
			await a.generateRuleDraft('描述');
			expect.fail('应该抛错');
		} catch (e) {
			const err = e as LlmError;
			expect(err).toBeInstanceOf(LlmApiError);
			expect(err.kind).toBe('api');
			expect(err.message).toContain('model not found');
			// apiKey 不泄露
			expect(err.message).not.toContain(TEST_API_KEY);
		}
	});

	test('200 + error 体({error:"string"}) 抛 LlmApiError 并透出错误', async () => {
		const a = makeAssistant();
		const vendorError = { error: 'balance insufficient' };
		const response = {
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => vendorError,
			text: async () => JSON.stringify(vendorError)
		} as unknown as Response;
		mockFetch.mockResolvedValue(response);

		await expect(a.generateRuleDraft('描述')).rejects.toThrow(/balance insufficient/);
	});

	test('非 2xx 错误体含结构化 error.message 时透出(500)', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(
			mockHttpError(500, JSON.stringify({ error: { message: 'upstream timeout' } }))
		);

		try {
			await a.generateRuleDraft('描述');
			expect.fail('应该抛错');
		} catch (e) {
			const err = e as LlmError;
			expect(err).toBeInstanceOf(LlmApiError);
			expect(err.message).toContain('upstream timeout');
			expect(err.message).not.toContain(TEST_API_KEY);
		}
	});
});

// ============ apiKey 不泄露断言(核心安全约束) ============

describe('apiKey 安全(apiKey 不进 error.message / 不进 URL)', () => {
	test('网络错误 message 不含 apiKey', async () => {
		const a = makeAssistant();
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		try {
			await a.generateRuleDraft('描述');
			expect.fail('应该抛错');
		} catch (e) {
			const err = e as LlmError;
			expect(err.message).not.toContain(TEST_API_KEY);
		}
	});

	test('401 错误 message 不含 apiKey', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockHttpError(401, `key=${TEST_API_KEY}`));

		try {
			await a.generateRuleDraft('描述');
			expect.fail('应该抛错');
		} catch (e) {
			const err = e as LlmError;
			expect(err.message).not.toContain(TEST_API_KEY);
		}
	});

	test('500 错误 message 不含 apiKey', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockHttpError(500, `internal: ${TEST_API_KEY}`));

		try {
			await a.generateRuleDraft('描述');
			expect.fail('应该抛错');
		} catch (e) {
			const err = e as LlmError;
			expect(err.message).not.toContain(TEST_API_KEY);
		}
	});

	test('fetch URL 不含 apiKey(只在 Authorization header)', async () => {
		const a = makeAssistant();
		mockFetch.mockResolvedValue(mockOkResponse('{}'));

		await a.generateInput('描述').catch(() => null); // 即使失败也检查 fetch 调用

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const callArgs = mockFetch.mock.calls[0];
		const url = callArgs[0] as string;
		const init = callArgs[1] as RequestInit;

		// URL 不应含 apiKey
		expect(url).not.toContain(TEST_API_KEY);
		// Authorization header 含 Bearer apiKey
		const headers = init.headers as Record<string, string>;
		expect(headers['Authorization']).toBe(`Bearer ${TEST_API_KEY}`);
		// body 不应含 apiKey(只含 model/messages)
		const body = JSON.parse(init.body as string);
		expect(JSON.stringify(body)).not.toContain(TEST_API_KEY);
	});
});

// ============ 防御性拷贝(配置不变性) ============

describe('配置防御性拷贝', () => {
	test('构造后修改外部 config 不影响 assistant', () => {
		const config: CloudLlmConfig = { ...FULL_CONFIG };
		const a = new CloudLlmAssistant(config);

		// 外部修改 apiKey
		config.apiKey = 'sk-changed';
		config.enabled = false;

		// assistant 内部不变
		expect(a.isConfigured()).toBe(true); // 仍是初始配置
	});
});

// ============ 接口完整性 ============

describe('LlmAssistant 接口完整性', () => {
	test('实现三方法 + isConfigured + testConnection', () => {
		const a = makeAssistant();
		expect(typeof a.generateRuleDraft).toBe('function');
		expect(typeof a.explainRule).toBe('function');
		expect(typeof a.generateInput).toBe('function');
		expect(typeof a.isConfigured).toBe('function');
		expect(typeof a.testConnection).toBe('function');
	});
});
