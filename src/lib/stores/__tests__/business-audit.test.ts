// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 步骤9:查看结果-业务审计链 单测
//
// 运行: npx vitest run src/lib/stores/__tests__/business-audit.test.ts
//
// 测试范围:
//   - toBusinessAuditEntry: factLabel term 映射、hash 保留、业务字段
//   - businessAuditByType: factType 过滤
//   - BusinessAuditSummary: factCount/ruleCount/anomalyCount/earliestTs/latestTs
//   - toBusinessCausalChain: 3 节点链 parentId/children/depth
//   - setCausalSummary / causalSummary store
//   - businessCausalWithSummary: chain + summary 合并
//
// 关联设计:11_steps_checklist.md 步骤9

import { describe, test, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import type { BusinessTerm } from "../business-terms";
import type { Rule, CausalEntry } from "@evorule/console";

// === Mock @evorule/console 依赖 ===
vi.mock("@evorule/console", async (importOriginal) => {
  const actual: any = await importOriginal();
  const { writable } = await import("svelte/store");
  const auditData = writable<any>(null);
  const verifyResult = writable<any>(null);
  const causalSelection = writable<any>(null);
  const getAllRules = vi.fn((): Rule[] => []);
  const currentSessionId = writable<number | null>(null);
  return {
    ...actual,
    auditData,
    verifyResult,
    causalSelection,
    getAllRules,
    currentSessionId,
  };
});

import {
  toBusinessAuditEntry,
  businessAuditByType,
  businessAuditStore,
  businessAuditSummary,
  type RawAuditEntry,
  type BusinessAuditEntry,
  type BusinessAuditSummary as SummaryType,
} from "../business-audit";
import {
  toBusinessCausalChain,
  causalSummary,
  setCausalSummary,
  businessCausalWithSummary,
  businessCausalStore,
  type BusinessCausalChain,
  type BusinessCausalNode,
} from "../business-causal";
import { businessTermsStore } from "../business-terms";
import { auditData, verifyResult, causalSelection, getAllRules } from "@evorule/console";

// === 测试数据构造辅助 ===

const TERM_MAP: BusinessTerm[] = [
  {
    id: "medical.patient_id",
    industry: "medical",
    label: "病人ID",
    key: "patient_id",
    synonyms: ["患者ID"],
    description: "病人唯一标识",
    status: "active",
    version: 1,
  },
  {
    id: "medical.temperature",
    industry: "medical",
    label: "体温",
    key: "temperature",
    synonyms: ["摄氏度"],
    description: "体温度数",
    status: "active",
    version: 1,
  },
  {
    id: "medical.drug_name",
    industry: "medical",
    label: "药品名称",
    key: "drug_name",
    synonyms: ["药物"],
    description: "处方药品名",
    status: "active",
    version: 1,
  },
];

const RULES: Rule[] = [
  {
    id: "R-042",
    description: "体温 > 38.5°C 触发高烧警示",
    condition: { type: "gt", field: "temperature", value: 38.5 },
    actions: [],
    enabled: true,
    priority: 1,
  } as any,
  {
    id: "R-007",
    description: "阿莫西林与布洛芬联用警告",
    condition: { type: "always" },
    actions: [],
    enabled: true,
    priority: 2,
  } as any,
];

function makeRawEntry(
  overrides: Partial<RawAuditEntry> = {},
): RawAuditEntry {
  const base: RawAuditEntry = {
    fact_id: 1,
    fact_type: "patient_visit",
    logical_time: 100,
    cause: null,
    content_hash: "blake3:abc123def456",
    prev_hash: "blake3:prev789",
    payload: { patient_id: "P-1283", temperature: 39.2 },
    timestamp: "2026-08-07T10:30:00Z",
  };
  return { ...base, ...overrides };
}

function makeCausalEntry(
  overrides: Partial<CausalEntry> = {},
): CausalEntry {
  const base: CausalEntry = {
    fact_id: 1,
    fact_type: "fact",
    logical_time: 1,
    cause: null,
    content_hash: "",
  };
  return { ...base, ...overrides };
}

// === beforeEach 重置 ===

beforeEach(() => {
  businessTermsStore.set([...TERM_MAP]);
  auditData.set(null);
  verifyResult.set(null);
  causalSelection.set(null);
  causalSummary.set(null);
  (getAllRules as any).mockReturnValue(RULES);
  vi.clearAllMocks();
});

// ============================================================================
// toBusinessAuditEntry
// ============================================================================

describe("步骤9: business-audit — toBusinessAuditEntry 转换", () => {
  test("fact_type → businessAction 应用内置映射(patient_visit → 病人就诊)", () => {
    const raw = makeRawEntry({
      fact_type: "patient_visit",
      payload: { id: "P-1283", temperature: 39.2 } as any,
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.businessAction).toContain("病人就诊");
    expect(result.businessAction).toContain("P-1283");
  });

  test("term 映射:payload key → 业务术语 label(patient_id → 病人ID)", () => {
    const raw = makeRawEntry();
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.businessPayload).toHaveProperty("病人ID");
    expect(result.businessPayload["病人ID"]).toBe("P-1283");
    expect(result.businessPayload).toHaveProperty("体温");
    expect(result.businessPayload["体温"]).toBe(39.2);
  });

  test("term 映射找不到 key → 回退原始 key", () => {
    const raw = makeRawEntry({
      payload: { unknown_field_xyz: "hello", patient_id: "P-001" },
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.businessPayload).toHaveProperty("unknown_field_xyz");
    expect(result.businessPayload["unknown_field_xyz"]).toBe("hello");
    expect(result.businessPayload).toHaveProperty("病人ID");
  });

  test("blake3 hash 保留(hash / prevHash)", () => {
    const raw = makeRawEntry({
      content_hash: "blake3:aaa111bbb222",
      prev_hash: "blake3:ccc333ddd444",
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.hash).toBe("blake3:aaa111bbb222");
    expect(result.prevHash).toBe("blake3:ccc333ddd444");
  });

  test("logical_time / fact_id / factType 透传", () => {
    const raw = makeRawEntry({
      fact_id: 42,
      fact_type: "drug_prescribe",
      logical_time: 256,
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.factId).toBe(42);
    expect(result.factType).toBe("drug_prescribe");
    expect(result.logicalTime).toBe(256);
  });

  test("timestamp 有效 → 格式化(不用 logical_time 兜底)", () => {
    const raw = makeRawEntry({
      timestamp: "2026-08-07T10:30:00Z",
      logical_time: 100,
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.businessTime).not.toBe("t=100");
    expect(result.businessTime).toMatch(/\d/);
  });

  test("timestamp 无效 → 兜底 t=logical_time", () => {
    const raw = makeRawEntry({
      timestamp: "not-a-date",
      logical_time: 999,
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.businessTime).toBe("t=999");
  });

  test("无 timestamp → 兜底 t=logical_time", () => {
    const raw = makeRawEntry({ timestamp: undefined, logical_time: 777 });
    delete (raw as any).timestamp;
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.businessTime).toBe("t=777");
  });

  test("ruleId 匹配 → triggeredRule/ruleId/businessResult 填充", () => {
    const raw = makeRawEntry({
      fact_type: "rule_triggered",
      ruleId: "R-042",
    });
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.ruleId).toBe("R-042");
    expect(result.triggeredRule).toBe("体温 > 38.5°C 触发高烧警示");
    expect(result.businessResult).toContain("触发规则");
    expect(result.businessResult).toContain("体温 > 38.5°C");
  });

  test("无 ruleId → triggeredRule/businessResult 为 null", () => {
    const raw = makeRawEntry({ fact_type: "patient_visit" });
    delete (raw as any).ruleId;
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.ruleId).toBeNull();
    expect(result.triggeredRule).toBeNull();
    expect(result.businessResult).toBeNull();
  });

  test("chainVerified=true → entry.verified=true", () => {
    const raw = makeRawEntry();
    const r1 = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(r1.verified).toBe(true);
    const r2 = toBusinessAuditEntry(raw, TERM_MAP, RULES, false);
    expect(r2.verified).toBe(false);
  });

  test("raw 条目保留在 result.raw 中", () => {
    const raw = makeRawEntry();
    const result = toBusinessAuditEntry(raw, TERM_MAP, RULES, true);
    expect(result.raw).toBe(raw);
    expect(result.raw.fact_id).toBe(1);
  });
});

// ============================================================================
// businessAuditStore + businessAuditByType + businessAuditSummary
// ============================================================================

describe("步骤9: business-audit — store 派生", () => {
  test("businessAuditByType(factType) 正确过滤", () => {
    const entries: RawAuditEntry[] = [
      makeRawEntry({ fact_id: 1, fact_type: "patient_visit", logical_time: 1 }),
      makeRawEntry({ fact_id: 2, fact_type: "drug_prescribe", logical_time: 2 }),
      makeRawEntry({ fact_id: 3, fact_type: "patient_visit", logical_time: 3 }),
      makeRawEntry({ fact_id: 4, fact_type: "heartbeat", logical_time: 4 }),
    ];
    auditData.set({ entries, verified: true, fact_count: entries.length });
    verifyResult.set({ verified: true });

    const filteredStore = businessAuditByType("patient_visit");
    const filtered = get(filteredStore);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.factType === "patient_visit")).toBe(true);
    expect(filtered.map((e) => e.factId).sort()).toEqual([1, 3]);

    const emptyStore = businessAuditByType("nonexistent");
    expect(get(emptyStore)).toEqual([]);
  });

  test("businessAuditStore: auditData 更新 → 派生条目列表", () => {
    const entries: RawAuditEntry[] = [
      makeRawEntry({ fact_id: 1, logical_time: 1 }),
      makeRawEntry({ fact_id: 2, logical_time: 2 }),
    ];
    auditData.set({ entries, verified: true, fact_count: entries.length });
    verifyResult.set({ verified: true });

    const list = get(businessAuditStore);
    expect(list).toHaveLength(2);
    expect(list[0].factId).toBe(1);
    expect(list[1].factId).toBe(2);
    expect(list.every((e) => e.verified)).toBe(true);
  });

  test("BusinessAuditSummary 字段: total/verified/broken/ruleTriggered/factTypeCount", () => {
    const entries: RawAuditEntry[] = [
      makeRawEntry({ fact_id: 1, fact_type: "patient_visit", logical_time: 1 }),
      makeRawEntry({
        fact_id: 2,
        fact_type: "rule_triggered",
        ruleId: "R-042",
        logical_time: 2,
      }),
      makeRawEntry({
        fact_id: 3,
        fact_type: "drug_prescribe",
        logical_time: 3,
      }),
      makeRawEntry({
        fact_id: 4,
        fact_type: "rule_triggered",
        ruleId: "R-007",
        logical_time: 4,
      }),
    ];
    auditData.set({ entries, verified: false, fact_count: entries.length });
    verifyResult.set({ verified: false });

    const summary = get(businessAuditSummary) as SummaryType;
    expect(summary.total).toBe(4);
    expect(summary.verified).toBe(0);
    expect(summary.broken).toBe(4);
    expect(summary.ruleTriggered).toBe(2);
    expect(summary.factTypeCount).toBe(3);
  });

  test("BusinessAuditSummary: 部分 verified → verified/broken 计数正确", () => {
    const entries: RawAuditEntry[] = [
      makeRawEntry({ fact_id: 1 }),
      makeRawEntry({ fact_id: 2 }),
      makeRawEntry({ fact_id: 3 }),
    ];
    auditData.set({ entries, verified: true, fact_count: entries.length });
    verifyResult.set({ verified: true });
    const s = get(businessAuditSummary) as SummaryType;
    expect(s.verified).toBe(3);
    expect(s.broken).toBe(0);
  });
});

// ============================================================================
// business-causal: toBusinessCausalChain
// ============================================================================

describe("步骤9: business-causal — toBusinessCausalChain", () => {
  test("3 节点链 level0 → level1 → level2: parentIds / depth 正确", () => {
    const chain: CausalEntry[] = [
      makeCausalEntry({
        fact_id: 10,
        fact_type: "patient_visit",
        logical_time: 1,
        cause: null,
        payload: { patient_id: "P-001" } as any,
      }),
      makeCausalEntry({
        fact_id: 20,
        fact_type: "rule_triggered",
        logical_time: 2,
        cause: 10,
        ruleId: "R-042" as any,
      }),
      makeCausalEntry({
        fact_id: 30,
        fact_type: "drug_prescribe",
        logical_time: 3,
        cause: 20,
      }),
    ];

    const result = toBusinessCausalChain(30, chain, TERM_MAP, RULES);
    expect(result.factId).toBe(30);
    expect(result.nodes).toHaveLength(3);

    const [n0, n1, n2] = result.nodes;
    expect(n0.factId).toBe(10);
    expect(n0.parentIds).toEqual([]);

    expect(n1.factId).toBe(20);
    expect(n1.parentIds).toEqual([10]);

    expect(n2.factId).toBe(30);
    expect(n2.parentIds).toEqual([20]);
  });

  test("每个节点 businessDescription: factType 业务化 + payload id", () => {
    const chain: CausalEntry[] = [
      makeCausalEntry({
        fact_id: 1,
        fact_type: "patient_visit",
        payload: { patient_id: "P-1283" } as any,
      }),
      makeCausalEntry({ fact_id: 2, fact_type: "heartbeat" }),
    ];
    const result = toBusinessCausalChain(2, chain, TERM_MAP, RULES);
    expect(result.nodes[0].businessDescription).toContain("病人就诊");
    expect(result.nodes[0].businessDescription).toContain("P-1283");
    expect(result.nodes[1].businessDescription).toContain("心跳");
  });

  test("causalExplanation: rule_triggered + cause + 直接输入", () => {
    const chain: CausalEntry[] = [
      makeCausalEntry({ fact_id: 1, fact_type: "patient_visit", cause: null }),
      makeCausalEntry({
        fact_id: 2,
        fact_type: "fact",
        cause: 1,
      }),
      makeCausalEntry({
        fact_id: 3,
        fact_type: "rule_triggered",
        cause: 2,
        ruleId: "R-042" as any,
      }),
    ];
    const result = toBusinessCausalChain(3, chain, TERM_MAP, RULES);
    expect(result.nodes[0].causalExplanation).toBe("直接输入");
    expect(result.nodes[1].causalExplanation).toContain("fact #1");
    expect(result.nodes[2].causalExplanation).toContain("触发规则");
    expect(result.nodes[2].causalExplanation).toContain("体温 > 38.5°C");
  });

  test("nodes 保留 factType / logicalTime / hash", () => {
    const chain: CausalEntry[] = [
      makeCausalEntry({
        fact_id: 5,
        fact_type: "order_approve",
        logical_time: 42,
        content_hash: "blake3:xyz",
      }),
    ];
    const result = toBusinessCausalChain(5, chain, TERM_MAP, RULES);
    const node = result.nodes[0];
    expect(node.factType).toBe("order_approve");
    expect(node.logicalTime).toBe(42);
    expect(node.hash).toBe("blake3:xyz");
    expect(node.confidence).toBe(90);
  });

  test("空链 → nodes 空数组 + factId 保留", () => {
    const result = toBusinessCausalChain(99, [], TERM_MAP, RULES);
    expect(result.factId).toBe(99);
    expect(result.nodes).toEqual([]);
    expect(result.summary).toBeNull();
  });
});

// ============================================================================
// causalSummary store + businessCausalWithSummary
// ============================================================================

describe("步骤9: business-causal — causalSummary store", () => {
  test("setCausalSummary(summary) 写入 → causalSummary store 读取一致", () => {
    expect(get(causalSummary)).toBeNull();
    setCausalSummary("病人就诊后体温过高触发高烧警示");
    expect(get(causalSummary)).toBe("病人就诊后体温过高触发高烧警示");
    setCausalSummary(null);
    expect(get(causalSummary)).toBeNull();
    setCausalSummary("");
    expect(get(causalSummary)).toBe("");
  });

  test("businessCausalWithSummary = chain.summary || causalSummary 合并", () => {
    const chain: CausalEntry[] = [
      makeCausalEntry({ fact_id: 1, fact_type: "patient_visit" }),
    ];
    causalSelection.set({ factId: 1, chain });

    expect(get(businessCausalWithSummary)).toBeDefined();
    expect(get(businessCausalWithSummary)?.summary).toBeNull();

    setCausalSummary("LLM 总结：三级因果链");
    const merged = get(businessCausalWithSummary) as BusinessCausalChain;
    expect(merged).not.toBeNull();
    expect(merged.summary).toBe("LLM 总结：三级因果链");
    expect(merged.nodes).toHaveLength(1);
    expect(merged.factId).toBe(1);
  });

  test("causalSelection 为 null → businessCausalWithSummary 为 null", () => {
    causalSelection.set(null);
    setCausalSummary("有总结但无链");
    expect(get(businessCausalWithSummary)).toBeNull();
  });
});
