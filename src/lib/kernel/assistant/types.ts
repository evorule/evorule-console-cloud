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
//
// kernel 镜像说明: 本文件是 evorule-console src/lib/assistant/types.ts 的
// 上游镜像(画布转译第 4 方法同步);大众版独有操作(isConfigured/testConnection/
// transpileCommand/transpileFlow 实现)在 $lib/assistant/types.ts 超集,不进本镜像。

/**
 * LLM 辅助接口(单轮,不做多轮编排)。
 *
 * evorule-console 只定义此接口,不实现。
 * - 默认 null(不注入):视图 LLM 按钮不渲染,与"无智能"基调一致
 * - 大众版注入实现:视图 LLM 按钮渲染,调用注入的实现
 *
 * 四用途(对应大众版四场景):
 *   - generateRuleDraft: 自然语言 → JSON 规则草案(用户审核修改)
 *   - explainRule: JSON 规则 → 自然语言说明(只读,不改规则)
 *   - generateInput: 自然语言 → 测试输入 JSON(辅助填表)
 *   - transpileFlow: 自然语言 → flow JSON 草稿(填入画布,人确认编译)
 *
 * 硬约束(MASS_EDITION §2.4):
 *   - 不做多轮 agent 编排(那是 evo-agent 仓的事)
 *   - 不做工具调用(tool calling)
 *   - 不做自动执行(LLM 决定跑规则)— 执行必须用户确认
 *   - 不让 LLM 改 fact log — fact log 是 evorule 机制层,不可篡改
 */

/**
 * 流程转译上下文:画布页已加载的 pack 资产投影。
 *
 * 由页面从 node_types/scenes 资产映射而来(R4:零领域硬编码,语义全来自
 * 资产声明);实现方用它组装 prompt,不在本仓发起任何网络请求。
 */
export interface FlowTranspileContext {
  /** 可用节点类型清单(node_types 资产投影) */
  nodeTypes: Array<{
    node_type: string;
    display_name: string;
    description?: string;
    /** params_form 字段投影(field_id/type/scene_ref;R4:不含展示文案细节) */
    params_form?: Array<{ field_id: string; type: string; scene_ref?: string }>;
  }>;
  /** 场景已注册 path 的字段取值域(R2:form_ref.field 只能取这里) */
  sceneFields: Array<{ scene_id: string; field_id: string; path: string }>;
}

export interface AssistantProvider {
  /** 自然语言 → JSON 规则草案(用户审核修改后才生效) */
  generateRuleDraft(
    naturalLanguage: string,
  ): Promise<{ rule: object; confidence: number }>;

  /** JSON 规则 → 自然语言说明(只读,不改规则) */
  explainRule(rule: object): Promise<string>;

  /** 自然语言 → 测试输入 JSON(辅助填表) */
  generateInput(description: string): Promise<object>;

  /**
   * 自然语言 → flow JSON 草稿。
   *
   * 产物是**草稿**:填入画布由用户可见可改,人点击编译才走既有链
   * (draft-only,R3)——LLM 永不直接 compile/publish。实现方经
   * promptTranspileFlow 组装 prompt;本镜像只定义不实现(扩展槽)。
   */
  transpileFlow(
    naturalLanguage: string,
    context: FlowTranspileContext,
  ): Promise<object>;
}
