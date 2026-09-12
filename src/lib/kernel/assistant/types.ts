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
 * LLM 辅助接口(单方法多轮转译;不做 agent 编排)。
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
 *   - 不做多轮 agent 编排(那是 evo-agent 仓的事)。transpileFlow 的可选
 *     history 是**用户驱动的对话式修订**(每轮由人点击触发生成,LLM 不自主
 *     决策继续/重试),非 agent 自主编排——红线不破
 *   - 不做工具调用(tool calling)。转译期的只读工具消费发生在 ai-plugin
 *     服务端回路内(部署方配置白名单),本接口层不发起任何工具调用
 *   - 不做自动执行(LLM 决定跑规则)— 执行必须用户确认
 *   - 不让 LLM 改 fact log — fact log 是 evorule 机制层,不可篡改
 */

/**
 * 多轮转译历史中的一轮(纯文本对;实现方负责把它映射为通道的消息形态)。
 *
 * - user: 该轮用户输入**原文**(非组装后的 prompt——组装是实现方职责)
 * - assistant: 该轮 LLM 回复原文(转译场景即 flow JSON 文本)
 */
export interface FlowTranspileTurn {
  role: "user" | "assistant";
  content: string;
}

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
  /**
   * 存量规则投影(可选;UV-178 批次D)。页面从执行域规则集预取(id+描述),
   * 供 LLM 参考既有规则的结构模式与路径约定;仅注入不引用——flow 草稿
   * 是独立资产,不引用规则 id。缺省/为空 = 无此视野(旧实现兼容)。
   */
  existingRules?: Array<{ rule_id: string; description?: string }>;
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
   *
   * history(UV-178 批次D,可选):此前轮次的纯文本对,按时间顺序——
   * 修订轮实现方据此拼接对话上下文并改用修订 prompt;缺省=单轮(既有
   * 调用方零破坏)。
   */
  transpileFlow(
    naturalLanguage: string,
    context: FlowTranspileContext,
    history?: FlowTranspileTurn[],
  ): Promise<object>;
}
