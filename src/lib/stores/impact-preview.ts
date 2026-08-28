// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 影响预览 store(派生计算)。
// P0 用前端简单匹配:遍历规则库,检查 instruction.payload 字段是否命中规则条件。
// P1+ 替换为 server dry-run API(设计 §3.3 决策 3)。
//
// 关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §4.3 + §5.4 + §7.3(影响预览流)

import { derived, get } from "svelte/store";
import { getAllRules } from "$lib/kernel";
import type { Rule } from "$lib/kernel";
import { businessEventStore, currentEventId } from "./business-event";

/** 单条规则匹配结果 */
export interface RuleMatchResult {
  /** 规则 ID */
  ruleId: string;
  /** 规则描述(可能为 null) */
  ruleDescription: string | null;
  /** 是否匹配 */
  matched: boolean;
  /** 匹配的字段名列表 */
  matchedFields: string[];
  /** 预计触发的 Fact 类型 */
  expectedFactType: string;
}

/** 影响预览结果 */
export interface ImpactPreview {
  /** 匹配的规则列表(含匹配/不匹配) */
  matches: RuleMatchResult[];
  /** 匹配的规则数 */
  matchedCount: number;
  /** 不匹配的规则数 */
  unmatchedCount: number;
  /** 预览生成时间 */
  generatedAt: string;
  /** 预览置信度(简单匹配=low,完整模拟=high) */
  confidence: "low" | "medium" | "high";
}

/**
 * 影响预览:当前事件的 instruction 与规则库的匹配结果(派生)。
 *
 * 当 businessEventStore 或 currentEventId 变化时自动重算。
 * event.instruction 为 null 时返回 null(未翻译,无可预览)。
 */
export const impactPreview = derived(
  [businessEventStore, currentEventId],
  ([$events, $currentId]) => {
    const event = $events.find((e) => e.id === $currentId);
    if (!event || !event.instruction) {
      return null;
    }
    return computeImpactPreview(event.instruction);
  },
);

/**
 * 计算影响预览(非响应式,命令式调用 + 测试用)。
 * 遍历内核 getAllRules(),对每条规则做简单匹配。
 */
export function computeImpactPreview(instruction: object): ImpactPreview {
  const allRules = getAllRules();
  const matches = allRules.map((rule) => matchRule(rule, instruction));

  return {
    matches,
    matchedCount: matches.filter((m) => m.matched).length,
    unmatchedCount: matches.filter((m) => !m.matched).length,
    generatedAt: new Date().toISOString(),
    confidence: "low", // P0 前端简单匹配,低置信度
  };
}

/**
 * 简单规则匹配(P0):
 * 检查 instruction.payload 的字段名是否出现在规则 content 的条件字段中。
 *
 * 匹配逻辑(设计 §5.4 matchRule):
 * 1. 解析 rule.content JSON
 * 2. 取 instruction.payload 的字段名列表
 * 3. 取规则 content 的顶层字段名(排除 id)
 * 4. 交集 = matchedFields;非空 → matched=true
 *
 * 局限(P0 不处理,P1+ server dry-run 解决):
 * - 不递归嵌套条件(branch[0].condition.value)
 * - 不求值(不比较 threshold/value),只看字段名重叠
 * - io_request / 因果链无法预览
 */
export function matchRule(rule: Rule, instruction: object): RuleMatchResult {
  try {
    // content 未加载视为解析失败(catch 分支返回不匹配)
    if (rule.content === undefined) throw new Error("rule content not loaded");
    const ruleContent = JSON.parse(rule.content) as Record<string, unknown>;
    const payload = (instruction as { payload?: Record<string, unknown> }).payload ?? {};

    const payloadKeys = Object.keys(payload);
    const ruleKeys = Object.keys(ruleContent).filter((k) => k !== "id");
    const matchedFields = payloadKeys.filter((k) => ruleKeys.includes(k));

    return {
      ruleId: rule.id,
      ruleDescription: rule.description,
      matched: matchedFields.length > 0,
      matchedFields,
      expectedFactType:
        typeof ruleContent.action === "string" ? ruleContent.action : "unknown",
    };
  } catch {
    // 规则 content 解析失败,视为不匹配
    return {
      ruleId: rule.id,
      ruleDescription: rule.description,
      matched: false,
      matchedFields: [],
      expectedFactType: "unknown",
    };
  }
}

/**
 * 对指定数据集做影响预览(只匹配数据集包含的规则,而非全库)。
 * 用于"数据集执行预览"场景(P03 DatasetPreview + P04 联动)。
 */
export function computeImpactPreviewForRules(
  instruction: object,
  rules: Rule[],
): ImpactPreview {
  const matches = rules.map((rule) => matchRule(rule, instruction));
  return {
    matches,
    matchedCount: matches.filter((m) => m.matched).length,
    unmatchedCount: matches.filter((m) => !m.matched).length,
    generatedAt: new Date().toISOString(),
    confidence: "low",
  };
}
