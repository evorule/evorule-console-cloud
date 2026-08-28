// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务化因果链 store。
// P06_BUSINESS_AUDIT_TT_DESIGN.md §4.2 + §5.2 定义。
//
// 设计:
//   - 内核 causal store( causalSelection )保存 raw CausalEntry[]
//   - 本 store 派生为 BusinessCausalChain(业务描述 + 因果解释 + LLM 总结)
//   - 不重新拉取:用户在 AuditTimeline 点击 fact 时,
//     内核 fetchCausalChain() 已填充 causalSelection,本 store 派生即可
//   - LLM 因果总结按需触发(调 decisionSupportStore 或 CloudLlmAssistant)

import { derived, writable, get } from "svelte/store";
import { causalSelection, getAllRules, type Rule, type CausalEntry } from "$lib/kernel";
import { businessTermsStore, type BusinessTerm } from "./business-terms";

// ============================================================================
// 类型定义(P06 §4.2)
// ============================================================================

/** 业务化因果链节点 */
export interface BusinessCausalNode {
  /** 原始 causal entry fact_id */
  factId: number;
  /** 原始 fact_type */
  factType: string;
  /** 逻辑时间(版本号) */
  logicalTime: number;
  /** 业务描述(如"病人 P-1283 体温 39.2°C") */
  businessDescription: string;
  /** 因果关系描述(如"因为体温 > 38°C,触发规则 R-042") */
  causalExplanation: string;
  /** 父节点 fact_id 列表(因果链上游) */
  parentIds: number[];
  /** 信心评分(P0 固定 90,后续可接 LLM 评分) */
  confidence: number;
  /** BLAKE3 hash(保留,合规展示) */
  hash: string;
}

export interface BusinessCausalChain {
  /** 触发查询的 fact id */
  factId: number;
  /** 节点列表(按 causal 链顺序) */
  nodes: BusinessCausalNode[];
  /** LLM 生成的因果链总结(可选,用户点[LLM 总结]时填充) */
  summary: string | null;
}

// ============================================================================
// 业务化转换
// ============================================================================

/**
 * 描述单条 fact 的业务含义。
 * P0 简化:factType 业务化 + payload 关键字段。
 */
function describeFact(
  entry: CausalEntry,
  terms: BusinessTerm[],
): string {
  const typeMap: Record<string, string> = {
    patient_visit: "病人就诊",
    drug_prescribe: "药品开具",
    order_approve: "订单审批",
    rule_triggered: "规则触发",
    heartbeat: "心跳",
    fact: "事件",
  };
  const businessType = typeMap[entry.fact_type] ?? entry.fact_type;

  // 从 entry 中尝试提取关键 payload 字段(部分 causal entry 可能携带 payload)
  const payload = (entry as CausalEntry & { payload?: Record<string, unknown> }).payload;
  if (payload && typeof payload === "object") {
    const idKeys = ["patient_id", "order_id", "id", "ID"];
    const id = idKeys
      .map((k) => payload[k])
      .find((v) => v !== undefined && v !== null && v !== "");
    if (id !== undefined) {
      return `${businessType} #${id}`;
    }
  }
  return `${businessType} (fact ${entry.fact_id})`;
}

/**
 * 生成因果关系描述。
 * cause 字段为父 fact_id;若 entry 自身是 rule_triggered,
 * 关联 rules store 中的规则描述。
 */
function explainCausal(
  entry: CausalEntry,
  rules: Rule[],
): string {
  // 如果是 rule_triggered 类型,关联规则
  if (entry.fact_type === "rule_triggered") {
    const ruleId = (entry as CausalEntry & { ruleId?: string }).ruleId;
    const rule = ruleId ? rules.find((r) => r.id === ruleId) : null;
    if (rule) {
      return `触发规则: ${rule.description ?? rule.id}`;
    }
    return "规则触发";
  }

  // 有 cause 字段:存在上游 fact
  if (entry.cause !== null && entry.cause !== undefined) {
    return `由 fact #${entry.cause} 引发`;
  }

  // 无 cause:用户直接输入
  return "直接输入";
}

/**
 * 原始 CausalEntry[] → BusinessCausalChain。
 */
export function toBusinessCausalChain(
  factId: number,
  chain: CausalEntry[],
  terms: BusinessTerm[] = get(businessTermsStore),
  rules: Rule[] = getAllRules(),
): BusinessCausalChain {
  const nodes: BusinessCausalNode[] = chain.map((entry) => ({
    factId: entry.fact_id,
    factType: entry.fact_type,
    logicalTime: entry.logical_time,
    businessDescription: describeFact(entry, terms),
    causalExplanation: explainCausal(entry, rules),
    parentIds: entry.cause !== null && entry.cause !== undefined ? [entry.cause] : [],
    confidence: 90,
    hash: entry.content_hash ?? "",
  }));

  return {
    factId,
    nodes,
    summary: null,
  };
}

// ============================================================================
// 派生 store
// ============================================================================

/**
 * 当前业务化因果链(派生自内核 causalSelection)。
 * null 表示未选中任何 fact。
 */
export const businessCausalStore = derived(
  causalSelection,
  ($selection) => {
    if (!$selection) return null;
    const terms = get(businessTermsStore);
    const rules = getAllRules();
    return toBusinessCausalChain(
      $selection.factId,
      $selection.chain,
      terms,
      rules,
    );
  },
);

/**
 * LLM 因果链总结(独立 store,用户点[LLM 总结]时填充)。
 */
export const causalSummary = writable<string | null>(null);

/**
 * 设置因果链 LLM 总结(由组件调 CloudLlmAssistant.explainRule 后回填)。
 */
export function setCausalSummary(summary: string | null): void {
  causalSummary.set(summary);
}

/**
 * 带总结的业务化因果链(派生)。
 */
export const businessCausalWithSummary = derived(
  [businessCausalStore, causalSummary],
  ([$chain, $summary]) => {
    if (!$chain) return null;
    return { ...$chain, summary: $summary };
  },
);
