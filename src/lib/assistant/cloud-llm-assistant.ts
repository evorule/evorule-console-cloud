// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — CloudLlmAssistant: 云 LLM 实现(OpenAI 兼容协议)
//
// 设计:
//   - 实现 LlmAssistant 接口(继承内核 AssistantProvider 四方法 + 大众版独有方法)
//   - 内核四方法:generateRuleDraft / explainRule / generateInput / transpileFlow
//   - 大众版独有:isConfigured(配置完备性) + testConnection(测试连接)
//     + transpileCommand(L2 P2 第 4+1 操作,NL→命令草稿,内核不感知)
//   - 草案校验:LLM 产出后用内核 RuleValidator 校验,失败也不抛错,返回 confidence=0 + 校验错误
//   - apiKey 安全:不进 prompt / 不进日志 / 不进 error.message(由 llm-fetch.ts 保证)
//   - 审计桥(2026-08-30):各方法经 callChatApiAudited 走 evorule 侧车协议,
//     prompt 全文与 LLM 结果入审计链;testConnection 保持直连(连通性探针)
//
// 与内核边界:
//   - 注入到内核扩展槽后,内核视图只调四方法,不感知 CloudLlmConfig
//   - LLM 只生成草案,最终规则是用户审核后的 JSON(规则即数据),不破坏执行确定性

import { get } from 'svelte/store';
import { RuleValidator, type ValidationResult } from '$lib/kernel';
import type { LlmAssistant, CloudLlmConfig } from './types';
import { llmConfig } from '$lib/config/llm-config';
import { callChatApi, type ChatApiParams, LlmError } from './llm-fetch';
import {
	callChatApiAudited,
	callChatApiServerChannel,
	AuditedBridgeError,
	type AuditPurpose
} from './audited-llm';
import {
	promptGenerateRuleDraft,
	promptExplainRule,
	promptGenerateInput,
	promptTestConnection,
	promptTranspileCommand,
	promptTranspileFlow
} from './prompts';
import type { FlowTranspileContext } from '$lib/kernel';

/**
 * CloudLlmAssistant — 云 LLM 实现(OpenAI 兼容协议)。
 *
 * 用法:
 *   // 注入场景(推荐):无参构造,方法内部每次现取 llmConfig store 最新配置,
 *   // 设置面板改动即时生效,无需刷新页面:
 *   const assistant = new CloudLlmAssistant();
 *   provideLlm(assistant);
 *
 *   // 显式快照场景:LlmSettings.testConnection 现取 $llmConfig 后传入,
 *   // 实例持快照不变(连通性探针与注入实例隔离):
 *   const probe = new CloudLlmAssistant(config);
 *   probe.testConnection();
 *
 * 三方法:
 *   - generateRuleDraft(naturalLanguage) → { rule, confidence, validation? }
 *   - explainRule(rule) → 自然语言说明
 *   - generateInput(description) → 测试输入 JSON
 *
 * 错误处理:三方法均抛 LlmError 子类,UI 层 catch 后显示错误。
 */
export class CloudLlmAssistant implements LlmAssistant {
	/** 显式快照(构造传入时持有);注入场景不持快照,走 store 现取 */
	private readonly snapshot?: CloudLlmConfig;

	constructor(config?: CloudLlmConfig) {
		// 防御性拷贝(避免外部修改后影响本实例)
		if (config) this.snapshot = { ...config };
	}

	/**
	 * 当前生效配置:显式快照优先;否则每次现取 store 最新值。
	 * 现取语义保证设置面板改动(端点/Key/模型/启停)对已注入实例即时生效,
	 * 消除"页面加载时快照旧配置、改配置不生效直至整页刷新"的注入时效缺陷。
	 */
	private get config(): CloudLlmConfig {
		return this.snapshot ?? get(llmConfig);
	}

	/** 当前配置是否完备(通道感知:server 通道凭据在服务端,只看 enabled) */
	isConfigured(): boolean {
		const cfg = this.config;
		if (cfg.channel === 'server') {
			return cfg.enabled;
		}
		return (
			cfg.enabled &&
			cfg.apiEndpoint.trim().length > 0 &&
			cfg.apiKey.trim().length > 0 &&
			cfg.model.trim().length > 0
		);
	}

	/** 测试连接(返回成功/失败 + 信息;不产生草案;serverUnreachable=UV-177 诊断位) */
	async testConnection(): Promise<{
		ok: boolean;
		message: string;
		serverUnreachable?: boolean;
	}> {
		if (!this.isConfigured()) {
			const cfg = this.config;
			return {
				ok: false,
				message:
					cfg.channel === 'server'
						? '配置不完备: 请启用 LLM(server 通道凭据由 ai-plugin 服务端配置)'
						: '配置不完备: 请填写 apiEndpoint + apiKey + model 并启用'
			};
		}

		const cfg = this.config;
		// server 通道:探针=真实执行路径(经 ai-plugin 服务端点,审计链内),
		// 连通即证明 server+插件+托管凭据整链可用
		if (cfg.channel === 'server') {
			try {
				const reply = await callChatApiServerChannel({
					userMessage: 'ping',
					temperature: 0,
					auditPurpose: 'chat',
					apiEndpoint: '',
					apiKey: '',
					model: cfg.model
				});
				return {
					ok: true,
					message: `连接成功(server 通道经 ai-plugin,回复 ${reply.length} 字符)`
				};
			} catch (e) {
				// UV-177:server_unreachable=审计桥连不上 server/插件(server 未起或
				// ai-plugin 未启用/未达),UI 据此指向激活引导卡;其余错误如实透出
				const serverUnreachable =
					e instanceof AuditedBridgeError && e.kind === 'server_unreachable';
				return {
					ok: false,
					message: `连接失败: ${(e as Error).message}`,
					serverUnreachable
				};
			}
		}

		try {
			const reply = await callChatApi({
				apiEndpoint: cfg.apiEndpoint,
				apiKey: cfg.apiKey,
				model: cfg.model,
				userMessage: promptTestConnection(),
				temperature: 0,
				timeoutMs: 10_000
			});
			// 只要能拿到回复就算连接成功(不验证内容)
			return {
				ok: true,
				message: `连接成功(model=${cfg.model},回复 ${reply.length} 字符)`
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
	 * 经审计链执行一次 LLM 对话(业务 LLM 调用统一入口,按 channel 路由)。
	 *
	 * 三个定向任务(草案/解释/输入)不走直连,prompt 全文与 LLM 结果都进
	 * evorule 审计链(与 evo-agent AuditedLlm 同契约)。testConnection 除外
	 * —— browser 通道它是配置连通性探针,可在 server 未启动时独立验证 LLM
	 * 端点;server 通道探针即真实执行路径。
	 *
	 * 通道(UV-172 P2 双通道并存):
	 *   - browser:审计桥侧车协议,浏览器本地执行 LLM(用户自有 key)——现状
	 *   - server:ai-plugin 服务端点,服务端托管凭据自编排审计回路
	 *
	 * @throws LlmError 子类(browser 通道 LLM 执行失败) /
	 *         AuditedBridgeError(server 不可达 / 协议失败)
	 */
	private auditedChat(params: Omit<ChatApiParams, 'apiEndpoint' | 'apiKey' | 'model'> & { auditPurpose: AuditPurpose }): Promise<string> {
		const cfg = this.config;
		// 现取语义下配置可能在实例注入后被用户改动/停用:调用时点再校验,
		// 未配置即显式报错(fail-fast),不发无凭据请求
		if (!cfg.enabled) {
			return Promise.reject(
				new LlmError('LLM 未配置或已停用:请到 设置 → LLM 配置 完成配置后再试', 'api')
			);
		}
		if (cfg.channel === 'server') {
			// server 通道:凭据在 ai-plugin 服务端,apiEndpoint/apiKey 不使用;
			// model 可选覆盖(空 = 插件缺省模型)
			return callChatApiServerChannel({
				apiEndpoint: '',
				apiKey: '',
				model: cfg.model.trim(),
				...params
			});
		}
		if (!cfg.apiEndpoint.trim() || !cfg.apiKey.trim() || !cfg.model.trim()) {
			return Promise.reject(
				new LlmError('LLM 未配置或已停用:请到 设置 → LLM 配置 完成配置后再试', 'api')
			);
		}
		return callChatApiAudited({
			apiEndpoint: cfg.apiEndpoint,
			apiKey: cfg.apiKey,
			model: cfg.model,
			...params
		});
	}

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
		const reply = await this.auditedChat({
			userMessage: prompt,
			temperature: 0.2, // 偏确定性
			auditPurpose: 'draft_rule'
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
		const reply = await this.auditedChat({
			userMessage: prompt,
			temperature: 0.3, // 稍高,说明更自然
			auditPurpose: 'explain_rule'
		});
		return reply.trim();
	}

	/**
	 * 用途3: 自然语言 → 测试输入 JSON。
	 */
	async generateInput(description: string): Promise<object> {
		const prompt = promptGenerateInput(description);
		const reply = await this.auditedChat({
			userMessage: prompt,
			temperature: 0.2,
			auditPurpose: 'gen_tests'
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

	/**
	 * 用途5(07 立项 §2.2 L2 P2): 自然语言 → 命令指令 JSON 草稿。
	 *
	 * 产物是**草稿**:调用方(TranspileCommandDialog)填入执行台 textarea,
	 * 用户可见可改,人点击提交才走既有命令链——LLM 永远不直接提交命令。
	 * 经 auditedChat 双通道入审计链(purpose=transpile_command)。
	 */
	async transpileCommand(nl: string): Promise<object> {
		const prompt = promptTranspileCommand(nl);
		const reply = await this.auditedChat({
			userMessage: prompt,
			temperature: 0.1, // 命令转译偏确定性
			auditPurpose: 'transpile_command'
		});

		const jsonStr = extractJson(reply);
		try {
			return JSON.parse(jsonStr) as object;
		} catch (e) {
			// 解析失败,返回带 _error 的对象,用户可手动改
			return {
				_error: 'LLM 命令草稿 JSON 解析失败,请人工修改',
				_raw: reply.slice(0, 500),
				_parseError: (e as Error).message
			};
		}
	}

	/**
	 * 用途6(UV-176,P3 激活): 自然语言 → flow JSON 草稿(流程画布转译器)。
	 *
	 * 产物是**草稿**:调用方(TranspileFlowDialog)展示并经 loadFlowAsset 投影
	 * 到画布,用户可见可改,人点击编译才走既有 compileFlow→Draft→Publish 链
	 * ——LLM 永不直接 compile/publish(R3 draft-only)。ctx 由画布页从已加载
	 * pack 资产投影(R4),经 promptTranspileFlow(few-shot 调优版,console
	 * 公开仓 SSOT 镜像)组装;走 auditedChat 双通道入审计链
	 * (purpose=transpile_flow)。
	 */
	async transpileFlow(naturalLanguage: string, context: FlowTranspileContext): Promise<object> {
		const prompt = promptTranspileFlow(naturalLanguage, context);
		const reply = await this.auditedChat({
			userMessage: prompt,
			temperature: 0.1, // 结构转译偏确定性
			auditPurpose: 'transpile_flow'
		});

		const jsonStr = extractJson(reply);
		try {
			return JSON.parse(jsonStr) as object;
		} catch (e) {
			// 解析失败,返回带 _error 的对象,用户可手动改(dialog 展示层校验会提示非合法 JSON)
			return {
				_error: 'LLM 流程草稿 JSON 解析失败,请人工修改',
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
