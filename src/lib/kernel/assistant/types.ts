// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console AssistantProvider 扩展槽 — LLM 辅助接口
//
// 依据: docs/MASS_EDITION.md §2.2.1
// 设计:
//   - evorule-console 自身不引入任何 LLM 依赖(无 openai/无 fetch LLM 代码)
//   - AssistantProvider 是空的扩展槽(默认 null),如同 ExecutionBackend 接口
//     只定义不实现网络版
//   - 大众版注入 CloudLlmAssistant 实现后,视图的 LLM 按钮才渲染
//   - LLM 只生成草案,最终规则是用户审核的 JSON(规则即数据),不破坏
//     "无智能只有执行"基调

/**
 * LLM 辅助接口(单轮,不做多轮编排)。
 *
 * evorule-console 只定义此接口,不实现。
 * - 默认 null(不注入):视图 LLM 按钮不渲染,与"无智能"基调一致
 * - 大众版注入实现:视图 LLM 按钮渲染,调用注入的实现
 *
 * 三用途(对应大众版三场景):
 *   - generateRuleDraft: 自然语言 → JSON 规则草案(用户审核修改)
 *   - explainRule: JSON 规则 → 自然语言说明(只读,不改规则)
 *   - generateInput: 自然语言 → 测试输入 JSON(辅助填表)
 *
 * 硬约束(MASS_EDITION §2.4):
 *   - 不做多轮 agent 编排(那是 evo-agent 仓的事)
 *   - 不做工具调用(tool calling)
 *   - 不做自动执行(LLM 决定跑规则)— 执行必须用户确认
 *   - 不让 LLM 改 fact log — fact log 是 evorule 机制层,不可篡改
 */
export interface AssistantProvider {
  /** 自然语言 → JSON 规则草案(用户审核修改后才生效) */
  generateRuleDraft(
    naturalLanguage: string,
  ): Promise<{ rule: object; confidence: number }>;

  /** JSON 规则 → 自然语言说明(只读,不改规则) */
  explainRule(rule: object): Promise<string>;

  /** 自然语言 → 测试输入 JSON(辅助填表) */
  generateInput(description: string): Promise<object>;
}
