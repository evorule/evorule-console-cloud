// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — CloudLlmAssistant: 云 LLM 实现(OpenAI 兼容协议)
//
// 设计:
//   - 实现 LlmAssistant 接口(继承内核 AssistantProvider 三方法 + 大众版独有方法)
//   - 三方法:generateRuleDraft / explainRule / generateInput
//   - 大众版独有:isConfigured(配置完备性) + testConnection(测试连接)
//   - 草案校验:LLM 产出后用内核 RuleValidator 校验,失败也不抛错,返回 confidence=0 + 校验错误
//   - apiKey 安全:不进 prompt / 不进日志 / 不进 error.message(由 llm-fetch.ts 保证)
//
// 与内核边界:
//   - 注入到内核扩展槽后,内核视图只调三方法,不感知 CloudLlmConfig
//   - LLM 只生成草案,最终规则是用户审核后的 JSON(规则即数据),不破坏执行确定性

import { RuleValidator, type ValidationResult } from '$lib/kernel';
import type { LlmAssistant, CloudLlmConfig } from './types';
import { callChatApi, LlmError } from './llm-fetch';
import {
	promptGenerateRuleDraft,
	promptExplainRule,
	promptGenerateInput,
	promptTestConnection
} from './prompts';

/**
 * CloudLlmAssistant — 云 LLM 实现(OpenAI 兼容协议)。
 *
 * 用法:
 *   const assistant = new CloudLlmAssistant(config);
 *   if (assistant.isConfigured()) {
 *     provideLlm(assistant);  // 注入到内核扩展槽
 *   } else {
 *     provideLlm(null);       // 配置不完备,不注入
 *   }
 *
 * 三方法:
 *   - generateRuleDraft(naturalLanguage) → { rule, confidence, validation? }
 *   - explainRule(rule) → 自然语言说明
 *   - generateInput(description) → 测试输入 JSON
 *
 * 错误处理:三方法均抛 LlmError 子类,UI 层 catch 后显示错误。
 */
export class CloudLlmAssistant implements LlmAssistant {
	private readonly config: CloudLlmConfig;

	constructor(config: CloudLlmConfig) {
		// 防御性拷贝(避免外部修改 store 后影响 assistant)
		this.config = { ...config };
	}

	/** 当前配置是否完备 */
	isConfigured(): boolean {
		return (
			this.config.enabled &&
			this.config.apiEndpoint.trim().length > 0 &&
			this.config.apiKey.trim().length > 0 &&
			this.config.model.trim().length > 0
		);
	}

	/** 测试连接(返回成功/失败 + 信息;不产生草案) */
	async testConnection(): Promise<{ ok: boolean; message: string }> {
		if (!this.isConfigured()) {
			return {
				ok: false,
				message: '配置不完备: 请填写 apiEndpoint + apiKey + model 并启用'
			};
		}

		try {
			const reply = await callChatApi({
				apiEndpoint: this.config.apiEndpoint,
				apiKey: this.config.apiKey,
				model: this.config.model,
				userMessage: promptTestConnection(),
				temperature: 0,
				timeoutMs: 10_000
			});
			// 只要能拿到回复就算连接成功(不验证内容)
			return {
				ok: true,
				message: `连接成功(model=${this.config.model},回复 ${reply.length} 字符)`
			};
		} catch (e) {
			const err = e as LlmError;
			return {
				ok: false,
				// 不暴露 apiKey,只暴露 kind + message(llm-fetch 已脱敏)
				message: `连接失败: ${err.message}`
			};
		}
	}

	// ========================================================================
	// 内核 AssistantProvider 三方法实现
	// ========================================================================

	/**
	 * 用途1: 自然语言 → JSON 规则草案。
	 *
	 * 返回 { rule, confidence }:
	 *   - rule: LLM 产出的规则 JSON 对象(未经校验也可能不合法)
	 *   - confidence: 0-1 置信度(LLM 草案 confidence=0.7,校验失败降到 0.3)
	 *
	 * 草案经内核 RuleValidator 校验,失败不抛错(返回低 confidence + 校验错误附在 rule 上)。
	 * 用户审核后才采用,不自动执行。
	 */
	async generateRuleDraft(
		naturalLanguage: string
	): Promise<{ rule: object; confidence: number }> {
		const prompt = promptGenerateRuleDraft(naturalLanguage);
		const reply = await callChatApi({
			apiEndpoint: this.config.apiEndpoint,
			apiKey: this.config.apiKey,
			model: this.config.model,
			userMessage: prompt,
			temperature: 0.2 // 偏确定性
		});

		// LLM 可能返回 markdown 代码块包裹,提取 JSON
		const jsonStr = extractJson(reply);
		let ruleObj: object;
		try {
			ruleObj = JSON.parse(jsonStr) as object;
		} catch (e) {
			// JSON 解析失败,返回低 confidence + 原文(用户可手动改)
			return {
				rule: {
					_error: 'LLM 草案 JSON 解析失败,请人工修改',
					_raw: reply.slice(0, 500),
					_parseError: (e as Error).message
				},
				confidence: 0
			};
		}

		// 用内核 RuleValidator 校验(草案 UX 反馈,非权威)
		const validation = RuleValidator.validate(jsonStr);
		if (validation.valid) {
			return { rule: ruleObj, confidence: 0.7 };
		}
		// 校验失败:返回草案 + 校验错误,confidence 降低,用户可修改后采用
		return {
			rule: {
				...ruleObj,
				_validationErrors: validation.errors
			},
			confidence: 0.3
		};
	}

	/**
	 * 用途2: JSON 规则 → 自然语言说明(只读,不改规则)。
	 *
	 * 注:接受 object 类型(与内核 AssistantProvider 接口一致)。
	 * 内部 JSON.stringify 后传给 LLM,因此无论是字面量对象还是已解析的对象都可。
	 */
	async explainRule(rule: object): Promise<string> {
		const ruleJson = typeof rule === 'string' ? rule : JSON.stringify(rule, null, 2);
		const prompt = promptExplainRule(ruleJson);
		const reply = await callChatApi({
			apiEndpoint: this.config.apiEndpoint,
			apiKey: this.config.apiKey,
			model: this.config.model,
			userMessage: prompt,
			temperature: 0.3 // 稍高,说明更自然
		});
		return reply.trim();
	}

	/**
	 * 用途3: 自然语言 → 测试输入 JSON。
	 */
	async generateInput(description: string): Promise<object> {
		const prompt = promptGenerateInput(description);
		const reply = await callChatApi({
			apiEndpoint: this.config.apiEndpoint,
			apiKey: this.config.apiKey,
			model: this.config.model,
			userMessage: prompt,
			temperature: 0.2
		});

		const jsonStr = extractJson(reply);
		try {
			return JSON.parse(jsonStr) as object;
		} catch (e) {
			// 解析失败,返回带 _error 的对象,用户可手动改
			return {
				_error: 'LLM 测试输入 JSON 解析失败,请人工修改',
				_raw: reply.slice(0, 500),
				_parseError: (e as Error).message
			};
		}
	}
}

// ============================================================================
// 内部工具
// ============================================================================

/**
 * 从 LLM 回复中提取 JSON 字符串。
 *
 * LLM 可能:
 *   - 直接返回纯 JSON
 *   - 用 ```json ... ``` 包裹
 *   - 用 ``` ... ``` 包裹
 *   - 前后混入说明文字
 *
 * 策略:
 *   1. 先尝试找 ```json ... ``` 或 ``` ... ``` 代码块
 *   2. 找不到则尝试直接 JSON.parse(纯 JSON 情况)
 *   3. 都失败则返回原文(交给调用方决定)
 */
function extractJson(text: string): string {
	const trimmed = text.trim();

	// 1. ```json ... ```
	const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		return jsonBlockMatch[1].trim();
	}

	// 2. ``` ... ```(无语言标识)
	const codeBlockMatch = trimmed.match(/```\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return codeBlockMatch[1].trim();
	}

	// 3. 找最外层 { ... } 或 [ ... ]
	const firstBrace = trimmed.indexOf('{');
	const lastBrace = trimmed.lastIndexOf('}');
	const firstBracket = trimmed.indexOf('[');
	const lastBracket = trimmed.lastIndexOf(']');

	const hasBraces = firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace;
	const hasBrackets =
		firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket;

	if (hasBraces && (!hasBrackets || firstBrace < firstBracket)) {
		return trimmed.slice(firstBrace, lastBrace + 1);
	}
	if (hasBrackets) {
		return trimmed.slice(firstBracket, lastBracket + 1);
	}

	// 4. 直接返回(让 JSON.parse 抛错)
	return trimmed;
}
