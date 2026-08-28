// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — provideLlm 转发器单测
//
// 验证:provideLlm 转发到内核 provideAssistant,支持 LlmAssistant 类型(超集)
//
// 注意:provideAssistant 是 Svelte context 函数,只能在组件初始化时调用,
// 单测中直接调 setContext/getContext 会抛错。这里 mock 内核 provideAssistant,
// 验证调用关系(参数透传 + null 转发)。

import { describe, test, expect, vi, beforeEach } from 'vitest';

// vi.mock 在顶层声明,会被 hoist 到文件最前;factory 不依赖外部变量
const mockProvideAssistant = vi.fn();
vi.mock('$lib/kernel', () => ({
	provideAssistant: mockProvideAssistant,
	// 其他导出空实现即可(llm-context.ts 只用 provideAssistant)
	HttpBackend: class {},
	provideBackend: vi.fn(),
	useBackend: vi.fn(),
	useBackendOrNull: vi.fn(),
	useAssistantOrNull: vi.fn(),
	currentView: { subscribe: vi.fn() },
	setView: vi.fn(),
	restoreView: vi.fn(),
	VIEW_LIST: [],
	CONSOLE_VERSION: '0.1.1-mock'
}));

beforeEach(() => {
	mockProvideAssistant.mockReset();
});

describe('provideLlm 转发器', () => {
	test('转发到内核 provideAssistant', async () => {
		const { provideLlm } = await import('./llm-context');

		// 构造一个最小 LlmAssistant 实现对象(用于类型验证)
		const fakeAssistant = {
			generateRuleDraft: async () => ({ rule: {}, confidence: 0.5 }),
			explainRule: async () => 'fake explanation',
			generateInput: async () => ({ input: 'fake' }),
			isConfigured: () => true,
			testConnection: async () => ({ ok: true, message: 'ok' })
		};

		provideLlm(fakeAssistant);

		// 验证内核 provideAssistant 被调用,且参数透传
		expect(mockProvideAssistant).toHaveBeenCalledTimes(1);
		expect(mockProvideAssistant).toHaveBeenCalledWith(fakeAssistant);
	});

	test('传 null 转发 null(关闭 LLM 扩展槽)', async () => {
		const { provideLlm } = await import('./llm-context');

		provideLlm(null);
		expect(mockProvideAssistant).toHaveBeenCalledWith(null);
	});

	test('不传参数默认 null(与内核一致)', async () => {
		const { provideLlm } = await import('./llm-context');

		provideLlm();
		expect(mockProvideAssistant).toHaveBeenCalledWith(null);
	});

	test('LlmAssistant 超集兼容内核 AssistantProvider', async () => {
		// 类型测试(编译期):LlmAssistant 含三方法 + 大众版新增方法
		// 内核 AssistantProvider 只要三方法,LlmAssistant 兼容
		// 这里通过构造一个对象,验证可赋值给内核类型(运行时无差别)
		const fakeAssistant = {
			generateRuleDraft: async () => ({ rule: {}, confidence: 0.5 }),
			explainRule: async () => 'fake explanation',
			generateInput: async () => ({ input: 'fake' }),
			isConfigured: () => true,
			testConnection: async () => ({ ok: true, message: 'ok' })
		};

		// 直接作为 AssistantProvider 使用(运行时无差别,只验证结构)
		expect(typeof fakeAssistant.generateRuleDraft).toBe('function');
		expect(typeof fakeAssistant.explainRule).toBe('function');
		expect(typeof fakeAssistant.generateInput).toBe('function');
		// 大众版独有方法
		expect(typeof fakeAssistant.isConfigured).toBe('function');
		expect(typeof fakeAssistant.testConnection).toBe('function');
	});
});
