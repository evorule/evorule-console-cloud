// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P07 导出矩阵测试 — 医疗场景 mock 数据 + mock backend 工厂
//
// 场景:呼吸科就诊 → 检验 → 规则触发 → 开药 → 药物检查 → 决策
// 6 条 Fact 形成完整因果链,覆盖 6 种导出内容类型。
//
// 关联设计:P07_RESULT_EXPORT_DESIGN.md §4 + §5

import { vi } from "vitest";
import type {
  ExecutionBackend,
  SessionId,
  Fact,
  SessionAudit,
  VerifyResult,
  CausalChain,
  CausalEntry,
  SessionState,
} from "$lib/kernel";

// ============================================================================
// 1. Fact 流(6 条,呼吸科就诊完整链路)
// ============================================================================

export const MOCK_FACTS: Fact[] = [
  {
    type: "patient_visit",
    id: 1,
    logical_time: 1,
    timestamp: "2026-08-07T09:00:00Z",
    payload: {
      patient_id: "P001",
      patient_name: "张三",
      department: "呼吸科",
      symptoms: ["发热", "咳嗽", "乏力"],
      temperature: 38.6,
      blood_pressure: "128/82",
    },
  },
  {
    type: "lab_result",
    id: 2,
    logical_time: 2,
    timestamp: "2026-08-07T09:15:00Z",
    payload: {
      patient_id: "P001",
      test_type: "血常规",
      white_blood_cell: 12.5,
      neutrophil_ratio: 0.82,
      crp: 45.0,
      result_flag: "abnormal",
    },
  },
  {
    type: "rule_triggered",
    id: 3,
    logical_time: 3,
    timestamp: "2026-08-07T09:16:00Z",
    rule_id: "r_fever_alert",
    rule_name: "发热+感染指标告警",
    trigger: { temperature: 38.6, white_blood_cell: 12.5, crp: 45.0 },
    result: "warning",
    message: "体温≥38.5℃ 且白细胞>10 且 CRP>40,疑似细菌感染,建议抗生素治疗",
  },
  {
    type: "drug_prescribe",
    id: 4,
    logical_time: 4,
    timestamp: "2026-08-07T09:20:00Z",
    payload: {
      patient_id: "P001",
      drug_name: "头孢克洛",
      dosage: "0.25g",
      frequency: "每日 3 次",
      duration: "7 天",
      prescribed_by: "李医生",
    },
  },
  {
    type: "rule_triggered",
    id: 5,
    logical_time: 5,
    timestamp: "2026-08-07T09:21:00Z",
    rule_id: "r_drug_interaction",
    rule_name: "药物相互作用检查",
    trigger: { drug_name: "头孢克洛", patient_allergies: ["青霉素"] },
    result: "allowed",
    message: "头孢克洛与患者无禁忌,青霉素过敏非交叉禁忌,可开具",
  },
  {
    type: "decision",
    id: 6,
    logical_time: 6,
    timestamp: "2026-08-07T09:22:00Z",
    payload: {
      patient_id: "P001",
      final_decision: "allowed",
      summary: "允许开具头孢克洛,3 天后复查血常规",
      precautions: "用药期间禁酒,出现皮疹立即停药",
      decided_by: "李医生",
    },
  },
];

// ============================================================================
// 2. 审计链(BLAKE3 哈希链)
// ============================================================================

export const MOCK_AUDIT_ENTRIES: CausalEntry[] = MOCK_FACTS.map((f, i) => ({
  fact_id: f.id,
  fact_type: f.type,
  // Fact 是 index signature,f.logical_time 推断为 unknown;
  // CausalEntry.logical_time 要求 number,故显式 Number() 转换。
  logical_time: Number(f.logical_time),
  timestamp: (f as { timestamp?: string }).timestamp,
  content_hash: `blake3_${f.type}_${f.id}_${"a".repeat(8)}`,
  // CausalEntry.prev_hash?: string(即 string | undefined,非 string | null);
  // cause?: number | null 允许 null。故 prev_hash 首条用 undefined,cause 首条用 null。
  prev_hash: i === 0 ? undefined : `blake3_${MOCK_FACTS[i - 1].type}_${MOCK_FACTS[i - 1].id}_${"a".repeat(8)}`,
  cause: i === 0 ? null : MOCK_FACTS[i - 1].id,
}));

export const MOCK_AUDIT: SessionAudit = {
  entries: MOCK_AUDIT_ENTRIES,
  fact_count: MOCK_FACTS.length,
  verified: true,
  last_hash: `blake3_${MOCK_FACTS[MOCK_FACTS.length - 1].type}_${MOCK_FACTS[MOCK_FACTS.length - 1].id}_${"a".repeat(8)}`,
};

export const MOCK_VERIFY: VerifyResult = {
  verified: true,
  detail: "BLAKE3 链完整,6 条 Fact 哈希连续不可篡改",
};

// ============================================================================
// 3. 因果链(fact 3 的因果:就诊+检验 → 规则触发)
// ============================================================================

export const MOCK_CAUSAL_CHAIN: CausalChain = {
  chain: [
    {
      fact_id: 1,
      fact_type: "patient_visit",
      logical_time: 1,
      cause: null,
      content_hash: MOCK_AUDIT_ENTRIES[0].content_hash,
      description: "病人就诊,体温 38.6℃",
    },
    {
      fact_id: 2,
      fact_type: "lab_result",
      logical_time: 2,
      cause: 1,
      content_hash: MOCK_AUDIT_ENTRIES[1].content_hash,
      description: "血常规:白细胞 12.5 偏高,CRP 45",
    },
    {
      fact_id: 3,
      fact_type: "rule_triggered",
      logical_time: 3,
      cause: 2,
      content_hash: MOCK_AUDIT_ENTRIES[2].content_hash,
      description: "发热+感染指标告警规则触发,结果 warning",
    },
  ],
};

// ============================================================================
// 4. Session 状态快照
// ============================================================================

export const MOCK_SESSION_STATE: SessionState = {
  payload: {
    patient_registry: { P001: { name: "张三", department: "呼吸科" } },
    active_rules: ["r_fever_alert", "r_drug_interaction"],
    prescription_queue: [{ drug: "头孢克洛", status: "dispensed" }],
  },
  queue: [],
  // reactor 字段对齐 $lib/kernel 的 ReactorState 契约
  //   phase / causal_depth / current_step / pending_io_count /
  //   structural_invariant_violations
  // 6 条 Fact 已处理完毕 → phase='stable'(级联收敛);
  // 因果链就诊→检验→规则触发 = 3 层 → causal_depth=3。
  reactor: {
    phase: "stable",
    causal_depth: 3,
    current_step: 6,
    pending_io_count: 0,
    structural_invariant_violations: 0,
  },
  version: 6,
};

// ============================================================================
// 5. Mock Backend 工厂
// ============================================================================

/**
 * 创建 mock backend,返回医疗场景数据。
 * 所有方法均为 vi.fn,可断言调用次数和参数。
 *
 * 实现要点(C2 修复):
 *   1. 每个方法用 vi.fn(impl) 包装 —— 既有默认实现,又暴露 .mock.calls 供断言。
 *   2. 返回 { ...spies, _spies: spies } —— 把 spy 方法摊平为 backend 方法,
 *      同时保留 _spies 引用,使 backend._spies.getReplay.mock.calls 可用。
 *      (旧实现直接 return spies,运行时并无 _spies 字段,导致断言 NPE。)
 */
export function makeMedicalMockBackend(): ExecutionBackend & {
  _spies: Record<string, ReturnType<typeof vi.fn>>;
} {
  const spies = {
    health: vi.fn(() => Promise.resolve(true)),
    createSession: vi.fn(() => Promise.resolve(1 as SessionId)),
    listSessions: vi.fn(() => Promise.resolve([1] as SessionId[])),
    closeSession: vi.fn(() => Promise.resolve()),
    getSessionState: vi.fn(() => Promise.resolve(MOCK_SESSION_STATE)),
    submitCommand: vi.fn(() =>
      Promise.resolve({ accepted: true, version: 7 }),
    ),
    getHistory: vi.fn(() => Promise.resolve(MOCK_FACTS)),
    getReplay: vi.fn((_id: SessionId, _from?: number, _to?: number | null) =>
      Promise.resolve(MOCK_FACTS),
    ),
    getFacts: vi.fn(() => Promise.resolve([])),
    getAudit: vi.fn(() => Promise.resolve(MOCK_AUDIT)),
    verifyAudit: vi.fn(() => Promise.resolve(MOCK_VERIFY)),
    getCausalChain: vi.fn((_id: SessionId, factId: number) => {
      // fact 3 返回完整因果链;其他 fact 返回单节点
      if (factId === 3) return Promise.resolve(MOCK_CAUSAL_CHAIN);
      const entry = MOCK_AUDIT_ENTRIES.find((e) => e.fact_id === factId);
      return Promise.resolve({
        chain: entry ? [entry] : [],
      } as CausalChain);
    }),
    getStateAtVersion: vi.fn(() =>
      Promise.resolve({ payload: {}, queue: [], version: 6 }),
    ),
    getDiff: vi.fn(() => Promise.resolve({ items: [], removed: [] })),
    forkSession: vi.fn(() => Promise.resolve(2 as SessionId)),
  };
  return { ...spies, _spies: spies } as unknown as ExecutionBackend & {
    _spies: typeof spies;
  };
}
