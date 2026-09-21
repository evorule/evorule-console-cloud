// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// rule-draft-extract 单测 — 会话台「转规则草稿」提取口径

import { describe, expect, it } from 'vitest';
import { extractRuleDraftJson, messageDraftSummary } from '../rule-draft-extract';

describe('extractRuleDraftJson', () => {
	it('extracts a fenced json block and pretty-prints it', () => {
		const text = '这是草案:\n```json\n{"name":"r1","when":{}}\n```\n请审核。';
		expect(extractRuleDraftJson(text)).toBe('{\n  "name": "r1",\n  "when": {}\n}');
	});

	it('extracts an unfenced code block', () => {
		const text = '```\n{"a": 1}\n```';
		expect(JSON.parse(extractRuleDraftJson(text) as string)).toEqual({ a: 1 });
	});

	it('parses a bare json object message', () => {
		expect(JSON.parse(extractRuleDraftJson('{"a":1}') as string)).toEqual({ a: 1 });
	});

	it('returns null for arrays and scalars', () => {
		expect(extractRuleDraftJson('[1,2,3]')).toBeNull();
		expect(extractRuleDraftJson('"just a string"')).toBeNull();
		expect(extractRuleDraftJson('42')).toBeNull();
		expect(extractRuleDraftJson('plain words, no json')).toBeNull();
		expect(extractRuleDraftJson('null')).toBeNull();
	});

	it('falls back to whole text when the fence is not valid json', () => {
		const text = '```\nnot json at all\n```\n{"ok":true}';
		// 围栏内容不可解析 → 回退整条消息;整条以 ``` 开头也不可解析 → null
		// (口径:不猜,提取失败不给入口)
		expect(extractRuleDraftJson(text)).toBeNull();
	});

	it('prefers the first fenced block over surrounding prose', () => {
		const text = '{"outer":true}\n```json\n{"inner":true}\n```';
		expect(JSON.parse(extractRuleDraftJson(text) as string)).toEqual({ inner: true });
	});
});

describe('messageDraftSummary', () => {
	it('strips code blocks and collapses whitespace', () => {
		const text = '给用户注册\n```json\n{"a":1}\n```\n的规则草案';
		expect(messageDraftSummary(text)).toBe('给用户注册 的规则草案');
	});

	it('truncates long prose with ellipsis', () => {
		const summary = messageDraftSummary('x'.repeat(80), 50);
		expect(summary).toBe(`${'x'.repeat(50)}...`);
	});

	it('returns empty when the message is only code', () => {
		expect(messageDraftSummary('```json\n{"a":1}\n```')).toBe('');
	});
});
