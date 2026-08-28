// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 帮助中心 · LLM 只读问答(PR10-重2)。
// 复用 llm-fetch.callChatApi 直接向已配置的 LLM 提问,仅做"问答",
// 不调用 generateRuleDraft / explainRule / generateInput,不生成规则 JSON、
// 不执行任何动作 —— 严格的只读联动。
//
// 与 LlmChatSidebar 的区别:
//   - LlmChatSidebar 是通用多轮对话(面向规则编写/解释/测试);
//   - 本模块是帮助场景的单轮问答,上下文限定为 evorule 产品使用问题。

import { callChatApi } from './llm-fetch';
import type { CloudLlmConfig } from './types';

const SYSTEM_PROMPT = `你是 evorule-console-cloud 的产品帮助助手。

你的职责:用中文、简洁、准确地回答用户关于 evorule-console-cloud 的使用问题(例如:这是什么、怎么登录、怎么建规则库、审计链是什么、怎么用工作台/治理/导出/审计等)。

硬性约束(只读):
- 只回答、解释、引导,绝不生成规则 JSON、绝不调用任何工具、绝不执行任何写操作。
- 如果问题超出产品使用范畴或你不确定,直接说明"这超出了我能回答的范围",不要编造。
- 回答尽量结合 evorule 的核心概念:规则、规则集、审计链(BLAKE3)、沙盒、治理(5 态生命周期)、工作空间、等保 2.0 等。`;

/**
 * 向已配置的 LLM 提出一个帮助问题,返回纯文本回答。
 *
 * @param question 用户问题(来自帮助中心搜索框)
 * @param cfg 当前 LLM 配置(由调用方从 llmConfig store 读取后传入)
 * @throws LlmError 子类(网络/鉴权/限流/解析等),由调用方 catch 后展示
 */
export async function askHelp(
	question: string,
	cfg: CloudLlmConfig
): Promise<string> {
	const q = question.trim();
	const userMessage = q.length > 0 ? q : '请简要介绍 evorule-console-cloud 是什么,以及它能做什么。';

	return callChatApi({
		apiEndpoint: cfg.apiEndpoint,
		apiKey: cfg.apiKey,
		model: cfg.model,
		userMessage,
		systemMessage: SYSTEM_PROMPT,
		temperature: 0.3,
		timeoutMs: 30_000
	});
}
