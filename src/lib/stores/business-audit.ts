// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 业务化审计 store(派生自内核 audit store + businessTermsStore + rules store)。
//
// 设计(P06_BUSINESS_AUDIT_TT_DESIGN.md §5.2):
//   - 不重新拉取审计数据:派生自内核 auditData store(getAudit 已在 AuditView 调用)
//   - 不重算 BLAKE3:hash 直接透传 raw.content_hash(TCB 纯净)
//   - 术语高亮:复用 P02 businessTermsStore 做 payload key → 业务术语映射
//   - 规则解释:复用内核 rules store 查找 ruleId → rule.description
//
// 与内核边界(对齐 GATE_ALIGNMENT.md):
//   - 内核 audit store 负责"获取 + 验证"审计链
//   - 本 store 只做"展示转换":raw entries → 业务化条目
//   - 不改 fact log,不重写哈希链

import { derived, get } from "svelte/store";
import {
  auditData,
  verifyResult,
  getAllRules,
  type Rule,
  type CausalEntry,
  type SessionAudit,
} from "@evorule/console";
import { businessTermsStore, type BusinessTerm } from "./business-terms";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 内核审计条目(对齐 CausalEntry,带可选 ruleId / payload)。
 *
 * 注意:evorule-server audit 端点返回的 entries 是 CausalEntry 格式
 * (fact_id / fact_type / logical_time / cause / content_hash / prev_hash)。
 * 部分 fact 类型可能携带 payload 字段(如 rule_triggered 类型)。
 */
export interface RawAuditEntry extends CausalEntry {
  /** 规则触发类 Fact 携带的规则 ID(可选) */
  ruleId?: string;
  /** Fact payload(可选,部分 fact 类型有) */
  payload?: unknown;
  /** 服务端时间戳(可选,ISO 8601) */
  timestamp?: string;
}

/**
 * 业务化审计条目(术语高亮 + 字段映射后)。
 * P06 §4.1 定义。
 */
export interface BusinessAuditEntry {
  /** 原始条目(保留,开发者模式用) */
  raw: RawAuditEntry;
  /** fact_id(便于因果查询) */
  factId: number;
  /** fact_type(便于按类型筛选) */
  factType: string;
  /** logical_time(版本号) */
  logicalTime: number;
  /** 业务时间(可读格式,无 timestamp 时用 logical_time) */
  businessTime: string;
  /** 业务动作(如"病人 P-1283 就诊") */
  businessAction: string;
  /** 触发的规则(业务描述,无规则触发为 null) */
  triggeredRule: string | null;
  /** 规则 ID(若有) */
  ruleId: string | null;
  /** 业务结果(如"触发高烧 CT 检查") */
  businessResult: string | null;
  /** 术语高亮后的 payload(业务字段名) */
  businessPayload: Record<string, unknown>;
  /** BLAKE3 hash(保留,合规展示) */
  hash: string;
  /** 前一条 hash(链验证用) */
  prevHash: string | null;
  /** 链验证状态(由 verifyResult 派生) */
  verified: boolean;
}

// ============================================================================
// 业务化转换管道
// ============================================================================

/**
 * 术语高亮:payload JSON key → 业务术语 label。
 * 递归处理嵌套对象(深度 ≤ 3,防循环)。
 */
function applyTerms(
  payload: unknown,
  terms: BusinessTerm[],
  depth = 0,
): Record<string, unknown> {
  if (depth > 3) return { value: payload };
  if (payload === null || payload === undefined) return { value: payload };
  if (typeof payload !== "object") return { value: payload };
  if (Array.isArray(payload)) {
    return {
      value: payload.map((item) =>
        typeof item === "object" && item !== null
          ? applyTerms(item, terms, depth + 1)
          : item,
      ),
    };
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const term = terms.find((t) => t.key === key || t.id.endsWith(`.${key}`));
    const businessKey = term?.label ?? key;
    if (typeof value === "object" && value !== null && depth < 3) {
      result[businessKey] = applyTerms(value, terms, depth + 1);
    } else {
      result[businessKey] = value;
    }
  }
  return result;
}

/**
 * 生成业务动作描述。
 * P0 简化策略:factType → 业务化 + payload 主键字段。
 */
function describeBusinessAction(
  factType: string,
  payload: Record<string, unknown>,
): string {
  // 常见主键字段名(中文化优先)
  const idKeys = [
    "病人 ID",
    "订单 ID",
    "客户 ID",
    "规则 ID",
    "id",
    "ID",
    "patient_id",
    "order_id",
  ];
  const id = idKeys
    .map((k) => payload[k])
    .find((v) => v !== undefined && v !== null && v !== "");

  // fact_type 业务化:snake_case → 中文(简化映射,真实场景用术语库)
  const typeMap: Record<string, string> = {
    patient_visit: "病人就诊",
    drug_prescribe: "药品开具",
    order_approve: "订单审批",
    rule_triggered: "规则触发",
    heartbeat: "心跳",
    fact: "事件",
  };
  const businessType = typeMap[factType] ?? factType;

  return id !== undefined ? `${businessType}: ${id}` : businessType;
}

/**
 * 生成业务结果描述。
 * 触发规则时显示规则描述;否则为 null。
 */
function describeBusinessResult(
  raw: RawAuditEntry,
  rule: Rule | null,
): string | null {
  if (!rule) return null;
  return `触发规则: ${rule.description ?? rule.id}`;
}

/**
 * 格式化业务时间(无 timestamp 时用 logical_time 兜底)。
 */
function formatBusinessTime(timestamp: string | undefined, logicalTime: number): string {
  if (timestamp) {
    try {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
    } catch {
      // fallthrough 到 logical_time 兜底
    }
  }
  return `t=${logicalTime}`;
}

/**
 * 原始审计条目 → 业务化审计条目。
 * P06 §5.2 toBusinessAuditEntry。
 */
export function toBusinessAuditEntry(
  raw: RawAuditEntry,
  terms: BusinessTerm[],
  rules: Rule[],
  chainVerified: boolean,
): BusinessAuditEntry {
  // 1. 术语高亮:payload 字段名 → 业务术语
  const businessPayload = applyTerms(raw.payload, terms);

  // 2. 业务动作描述
  const businessAction = describeBusinessAction(raw.fact_type, businessPayload);

  // 3. 触发的规则(从 rules store 查找)
  const rule = raw.ruleId
    ? rules.find((r) => r.id === raw.ruleId)
    : null;
  const triggeredRule = rule?.description ?? null;
  const ruleId = raw.ruleId ?? rule?.id ?? null;

  // 4. 业务结果
  const businessResult = describeBusinessResult(raw, rule ?? null);

  return {
    raw,
    factId: raw.fact_id,
    factType: raw.fact_type,
    logicalTime: raw.logical_time,
    businessTime: formatBusinessTime(raw.timestamp, raw.logical_time),
    businessAction,
    triggeredRule,
    ruleId,
    businessResult,
    businessPayload,
    hash: raw.content_hash ?? "",
    prevHash: raw.prev_hash ?? null,
    verified: chainVerified,
  };
}

// ============================================================================
// 派生 store
// ============================================================================

/**
 * 业务化审计条目列表(派生自内核 auditData + businessTermsStore + rules store)。
 *
 * 内核 auditData 更新时,自动转换为业务化条目列表。
 * verifyResult 更新时,verified 字段同步刷新。
 */
export const businessAuditStore = derived(
  [auditData, businessTermsStore, verifyResult],
  ([$audit, $terms, $verify]) => {
    if (!$audit) return [] as BusinessAuditEntry[];
    const entries = ($audit as SessionAudit).entries ?? [];
    const rules = getAllRules();
    const chainVerified = $verify?.verified ?? ($audit as SessionAudit).verified ?? false;
    return (entries as RawAuditEntry[]).map((entry) =>
      toBusinessAuditEntry(entry, $terms, rules, chainVerified),
    );
  },
);

/** 业务化审计统计(供 BusinessAuditView 顶部摘要区显示) */
export interface BusinessAuditSummary {
  total: number;
  verified: number;
  broken: number;
  ruleTriggered: number;
  factTypeCount: number;
}

/**
 * 业务化审计统计(派生)。
 */
export const businessAuditSummary = derived(
  businessAuditStore,
  ($entries): BusinessAuditSummary => {
    const total = $entries.length;
    const verified = $entries.filter((e) => e.verified).length;
    const broken = total - verified;
    const ruleTriggered = $entries.filter((e) => e.ruleId !== null).length;
    const factTypes = new Set($entries.map((e) => e.factType));
    return {
      total,
      verified,
      broken,
      ruleTriggered,
      factTypeCount: factTypes.size,
    };
  },
);

/**
 * 按 fact_type 分组(派生,用于审计时间线筛选)。
 */
export function businessAuditByType(factType: string) {
  return derived(businessAuditStore, ($entries) =>
    $entries.filter((e) => e.factType === factType),
  );
}

// ============================================================================
// 工具函数(供组件直接调用,不走 store)
// ============================================================================

/**
 * 同步转换接口(测试 / 组件直接调用)。
 * 提供 backend + sessionId 时,从 backend 实时拉取后转换。
 */
export async function fetchBusinessAudit(
  backend: {
    getAudit: (id: number) => Promise<SessionAudit>;
    verifyAudit?: (id: number) => Promise<{ verified: boolean; detail?: string }>;
  },
  sessionId: number,
): Promise<BusinessAuditEntry[]> {
  const [audit, verify] = await Promise.all([
    backend.getAudit(sessionId),
    backend.verifyAudit?.(sessionId).catch(() => null) ?? null,
  ]);
  const terms = get(businessTermsStore);
  const rules = getAllRules();
  const chainVerified = verify?.verified ?? audit.verified ?? false;
  return (audit.entries as RawAuditEntry[]).map((entry) =>
    toBusinessAuditEntry(entry, terms, rules, chainVerified),
  );
}
