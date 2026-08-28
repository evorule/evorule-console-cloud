// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// $lib/kernel 导入验证 — 验证内联内核快照(v0.2.0 子集)可正确 import
//
// 运行: npm run verify  (= vitest run src/verify.test.ts)
//
// 为什么用 vitest 而非 node verify-import.mjs:
//   - kernel 快照含 .svelte 组件,node 直接 import 会失败
//   - vitest 用 vite 解析,能正确处理 ESM + Svelte 组件 import
//   - svelte-check 验证类型,vitest 验证运行时,两者互补

import { describe, test, expect } from 'vitest';
import {
	CONSOLE_VERSION,
	HttpBackend,
	provideBackend,
	useBackendOrNull,
	provideAssistant,
	useAssistantOrNull,
	rules,
	selectedRuleId,
	currentView,
	setView,
	restoreView,
	VIEW_LIST,
	RuleValidator,
	type AssistantProvider,
	type ExecutionBackend
} from '$lib/kernel';

describe('$lib/kernel 导入验证', () => {
	test('CONSOLE_VERSION === 0.2.0(内核快照版本正确)', () => {
		expect(CONSOLE_VERSION).toBe('0.2.0');
	});

	test('HttpBackend 可用(执行后端实现)', () => {
		expect(typeof HttpBackend).toBe('function');
	});

	test('backend context 函数可用', () => {
		expect(typeof provideBackend).toBe('function');
		expect(typeof useBackendOrNull).toBe('function');
	});

	test('assistant context 函数可用(v0.1.1 扩展槽)', () => {
		expect(typeof provideAssistant).toBe('function');
		expect(typeof useAssistantOrNull).toBe('function');
	});

	test('rules store 可用', () => {
		expect(rules).toBeDefined();
		expect(selectedRuleId).toBeDefined();
	});

	test('view store 函数可用', () => {
		expect(currentView).toBeDefined();
		expect(typeof setView).toBe('function');
		expect(typeof restoreView).toBe('function');
	});

	test('VIEW_LIST 有 5 个视图', () => {
		expect(Array.isArray(VIEW_LIST)).toBe(true);
		expect(VIEW_LIST.length).toBe(5);
	});

	test('VIEW_LIST 包含预期的 5 个 id', () => {
		const ids = VIEW_LIST.map((v) => v.id);
		expect(ids).toEqual(['rules', 'execution', 'state', 'audit', 'timetravel']);
	});

	test('RuleValidator 可用(L_console 预校验)', () => {
		expect(typeof RuleValidator).toBe('function');
	});

	test('类型可导入(编译期检查,运行时无操作)', () => {
		// 类型导入在 TS 编译期验证,运行时只做占位
		const _typeCheck: { provider: AssistantProvider | null; backend: ExecutionBackend } | null = null;
		expect(_typeCheck).toBeNull();
	});

	// 注:useAssistantOrNull() 不能在 vitest 直接调用验证 — Svelte 5 的 hasContext
	// 在非组件初始化期间会抛 lifecycle_outside_component 错误(设计行为,非 bug)。
	// useAssistantOrNull 的 null 返回行为由内核 assistant-context.test.ts 覆盖(用 mock)。
	// 大众版验证重点:import 通路 + 版本 + 导出可用性,context 行为属内核职责。
});
