// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — LLM 厂商预设单测(UV-004)

import { describe, test, expect } from 'vitest';
import { LLM_PRESETS, findPreset, getPresetOptions } from './llm-presets';

describe('LLM_PRESETS 覆盖面(UV-004 DoD)', () => {
	test('必含厂商:智谱/通义/DeepSeek/Kimi/OpenAI/Ollama/自定义', () => {
		const ids = LLM_PRESETS.map((p) => p.provider);
		expect(ids).toEqual(
			expect.arrayContaining(['glm', 'qwen', 'deepseek', 'kimi', 'openai', 'ollama', 'custom'])
		);
	});

	test('Kimi 预设:Moonshot OpenAI 兼容端点 + 申请指引', () => {
		const kimi = findPreset('kimi');
		expect(kimi).toBeDefined();
		expect(kimi!.apiEndpoint).toBe('https://api.moonshot.cn/v1/chat/completions');
		expect(kimi!.models.length).toBeGreaterThan(0);
		expect(kimi!.helpUrl).toBeTruthy();
	});

	test('Ollama 预设:本机端点 + 占位 Key + 安装指引', () => {
		const ollama = findPreset('ollama');
		expect(ollama).toBeDefined();
		expect(ollama!.apiEndpoint).toBe('http://127.0.0.1:11434/v1/chat/completions');
		expect(ollama!.presetApiKey).toBe('ollama');
		expect(ollama!.helpUrl).toBeTruthy();
	});

	test('除 ernie(needsAdapter)外全部为 OpenAI 兼容端点', () => {
		for (const p of LLM_PRESETS) {
			if (p.needsAdapter || p.provider === 'custom') continue;
			// MiniMax 现网端点为 /v1/text/chatcompletion_v2(2026-09-01 UV-030 实测),
			// 其余厂商为 /chat/completions —— 两种 OpenAI 兼容形态均合法
			const ok =
				/\/chat\/completions$/.test(p.apiEndpoint) ||
				/\/text\/chatcompletion_v2$/.test(p.apiEndpoint);
			expect(ok, `${p.provider}: ${p.apiEndpoint}`).toBe(true);
		}
	});

	test('MiniMax 预设:现网端点(api.minimaxi.com,实测可达)+ 平台指引一致', () => {
		const minimax = findPreset('minimax');
		expect(minimax).toBeDefined();
		expect(minimax!.apiEndpoint).toBe('https://api.minimaxi.com/v1/text/chatcompletion_v2');
		expect(minimax!.defaultModel).toBe('MiniMax-Text-01');
		expect(minimax!.helpUrl).toContain('platform.minimaxi.com');
	});

	test('全部非 custom 预设有默认模型与备选列表', () => {
		for (const p of LLM_PRESETS) {
			if (p.provider === 'custom') continue;
			if (p.needsAdapter) continue;
			expect(p.defaultModel, p.provider).toBeTruthy();
			expect(p.models, p.provider).toContain(p.defaultModel);
		}
	});
});

describe('getPresetOptions', () => {
	test('ernie 被禁用,其余可选', () => {
		const opts = getPresetOptions();
		const ernie = opts.find((o) => o.value === 'ernie');
		expect(ernie?.disabled).toBe(true);
		for (const o of opts) {
			if (o.value !== 'ernie') expect(o.disabled).toBeFalsy();
		}
	});
});
