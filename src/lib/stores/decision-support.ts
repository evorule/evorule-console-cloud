// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 决策支持 store(LLM 分析审计段 + 生成决策建议)。
// P06_BUSINESS_AUDIT_TT_DESIGN.md §4.3 + §5.3 定义。
//
// 设计:
//   - 用户手动触发(点[💡 决策建议]按钮),非实时
//   - 选中审计段(from-to)后,调 CloudLlmAssistant.explainRule 分析
//   - LLM 输出 JSON: { suggestions, risks, recommendedActions }
//   - 解析失败时降级为"分析失败,请稍后重试"
//   - 缓存策略:同 auditRange 不重复分析(避免 LLM 调用浪费)

import { writable, get } from "svelte/store";
import type { AssistantProvider } from "@evorule/console";
import type { LlmAssistant } from "$lib/assistant/types";
import { businessAuditStore, type BusinessAuditEntry } from "./business-audit";

// ============================================================================
// 类型定义(P06 §4.3)
// ============================================================================

/** 推荐操作(可选附回滚版本) */
export interface RecommendedAction {
  /** 操作描述(如"建议回滚到 v15") */
  action: string;
  /** 目标版本(若有,用户可点[↩ 回滚到 vN]) */
  targetVersion?: number;
}

/** 决策建议(LLM 分析结果) */
export interface DecisionSuggestion {
  /** 审计段 ID(被分析的条目范围,索引 0-based) */
  auditRange: { from: number; to: number };
  /** 决策建议(2-3 条) */
  suggestions: string[];
  /** 风险提示(1-2 条) */
  risks: string[];
  /** 推荐操作(含回滚建议) */
  recommendedActions: RecommendedAction[];
  /** 生成时间(ISO 8601) */
  generatedAt: string;
  /** LLM 模型标识 */
  model: string;
}

// ============================================================================
// Stores
// ============================================================================

export const decisionSupportStore = writable<DecisionSuggestion | null>(null);
export const isAnalyzing = writable(false);
export const decisionSupportError = writable<string | null>(null);

// 缓存:上一次分析的 auditRange + 入参摘要,避免重复分析
let lastRange: { from: number; to: number } | null = null;
let lastInputHash = "";

// ============================================================================
// Actions
// ============================================================================

/**
 * 请求 LLM 分析审计段 + 生成决策建议。
 *
 * @param assistant  LLM Assistant 实例(可为 null,UI 不渲染按钮)
 * @param auditRange 审计段索引范围(from/to 为 businessAuditStore 数组下标)
 */
export async function requestDecisionSupport(
  assistant: LlmAssistant | AssistantProvider | null,
  auditRange: { from: number; to: number },
): Promise<void> {
  if (!assistant) {
    decisionSupportError.set("LLM 未配置,无法生成决策建议");
    return;
  }

  // 缓存命中:同范围不重复分析
  const inputHash = `${auditRange.from}-${auditRange.to}`;
  if (
    lastRange &&
    lastRange.from === auditRange.from &&
    lastRange.to === auditRange.to &&
    lastInputHash === inputHash &&
    get(decisionSupportStore)
  ) {
    return;
  }

  isAnalyzing.set(true);
  decisionSupportError.set(null);

  try {
    const audit = get(businessAuditStore);
    const segment: BusinessAuditEntry[] = audit.slice(
      auditRange.from,
      auditRange.to + 1,
    );

    if (segment.length === 0) {
      decisionSupportError.set("选中的审计段为空,请重新选择");
      return;
    }

    // 组装 prompt(只传业务化字段,不含 raw hash / payload)
    const prompt = buildPrompt(segment);

    // 调 LLM(explainRule 接受任意 JSON 对象,这里传 prompt 字符串包装对象)
    const result = await assistant.explainRule({ prompt } as object);
    const parsed = parseDecisionResult(result);

    decisionSupportStore.set({
      auditRange,
      suggestions: parsed.suggestions,
      risks: parsed.risks,
      recommendedActions: parsed.recommendedActions,
      generatedAt: new Date().toISOString(),
      model: getAssistantModel(assistant),
    });

    lastRange = { ...auditRange };
    lastInputHash = inputHash;
  } catch (e) {
    decisionSupportError.set(
      `决策支持分析失败: ${(e as Error).message || "未知错误"}`,
    );
    decisionSupportStore.set(null);
  } finally {
    isAnalyzing.set(false);
  }
}

/**
 * 清除决策支持(切换 session / 关闭面板时调用)。
 */
export function clearDecisionSupport(): void {
  decisionSupportStore.set(null);
  decisionSupportError.set(null);
  lastRange = null;
  lastInputHash = "";
}

// ============================================================================
// 内部工具
// ============================================================================

function buildPrompt(segment: BusinessAuditEntry[]): string {
  const lines = segment.map((e, i) => {
    const parts = [
      `[${i}] ${e.businessTime} ${e.businessAction}`,
      e.triggeredRule ? `规则: ${e.triggeredRule}` : null,
      e.businessResult ? `结果: ${e.businessResult}` : null,
      `hash: ${e.hash.slice(0, 12)}`,
    ].filter((p): p is string => p !== null);
    return parts.join(" | ");
  });

  return `分析以下 evorule 审计日志,生成决策建议:

${lines.join("\n")}

请输出 JSON(只输出 JSON,不要 markdown 代码块):
{
  "suggestions": ["决策建议 1", "决策建议 2"],
  "risks": ["风险提示 1"],
  "recommendedActions": [{"action": "建议回滚到 v15", "targetVersion": 15}]
}`;
}

/**
 * 解析 LLM 输出为 DecisionSuggestion 子集。
 * 容错:LLM 可能返回 markdown 代码块 / 额外文本,提取 JSON 段。
 */
function parseDecisionResult(raw: string): {
  suggestions: string[];
  risks: string[];
  recommendedActions: RecommendedAction[];
} {
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    return { suggestions: [], risks: [], recommendedActions: [] };
  }

  try {
    const obj = JSON.parse(jsonStr) as {
      suggestions?: unknown;
      risks?: unknown;
      recommendedActions?: unknown;
    };

    return {
      suggestions: toStringArray(obj.suggestions),
      risks: toStringArray(obj.risks),
      recommendedActions: toRecommendedActions(obj.recommendedActions),
    };
  } catch {
    return { suggestions: [], risks: [], recommendedActions: [] };
  }
}

function extractJson(text: string): string | null {
  // 优先匹配 ```json ... ``` 代码块
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) return codeBlockMatch[1].trim();

  // 兜底:找第一个 { 到最后一个 }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function toRecommendedActions(v: unknown): RecommendedAction[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item): RecommendedAction | null => {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as { action?: unknown; targetVersion?: unknown };
      if (typeof obj.action !== "string") return null;
      const action: RecommendedAction = { action: obj.action };
      if (typeof obj.targetVersion === "number") {
        action.targetVersion = obj.targetVersion;
      }
      return action;
    })
    .filter((x): x is RecommendedAction => x !== null);
}

function getAssistantModel(
  assistant: LlmAssistant | AssistantProvider,
): string {
  // LlmAssistant 接口未含 getConfig,但 CloudLlmAssistant 实现中有 model 字段
  // 这里通过 instanceof 检查 + 类型断言访问
  const any = assistant as unknown as { getConfig?: () => { model?: string } };
  if (typeof any.getConfig === "function") {
    try {
      return any.getConfig()?.model ?? "unknown";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}
