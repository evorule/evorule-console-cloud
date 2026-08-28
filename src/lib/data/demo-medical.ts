// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 demo 模式 — 医疗场景预填数据。
// P10_TASKFLOW_DEMO_DESIGN.md §3.3 + §4.2 定义。
//
// 场景:呼吸科就诊 → 检验 → 规则触发 → 开药 → 药物检查 → 决策
// 覆盖 4 个引导任务(try_add / try_query / try_edit / try_compliance)所需的所有 API 响应。
//
// 关联设计:P10_TASKFLOW_DEMO_DESIGN.md §3.4(MockBackend 设计)

import type {
	Fact,
	SessionAudit,
	VerifyResult,
	CausalChain,
	CausalEntry,
	SessionState,
	HistoricalState,
	DiffResult,
	FactRecord,
} from "$lib/kernel";

// ============================================================================
// 1. Fact 流(6 条,呼吸科就诊完整链路)
// ============================================================================

export const MEDICAL_FACTS: Fact[] = [
	{
		type: "patient_visit",
		id: 1,
		logical_time: 1,
		timestamp: "2026-08-07T09:00:00Z",
		payload: {
			patient_id: "P-1283",
			patient_name: "张三",
			age: 68,
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
			patient_id: "P-1283",
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
		rule_id: "R-DEMO-001",
		rule_name: "发热+感染指标告警",
		trigger: { temperature: 38.6, white_blood_cell: 12.5, crp: 45.0 },
		result: "warning",
		message:
			"体温≥38.5℃ 且白细胞>10 且 CRP>40,疑似细菌感染,建议抗生素治疗",
	},
	{
		type: "drug_prescribe",
		id: 4,
		logical_time: 4,
		timestamp: "2026-08-07T09:20:00Z",
		payload: {
			patient_id: "P-1283",
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
			patient_id: "P-1283",
			final_decision: "allowed",
			summary: "允许开具头孢克洛,3 天后复查血常规",
			precautions: "用药期间禁酒,出现皮疹立即停药",
		},
	},
];

// ============================================================================
// 2. 审计链(BLAKE3 哈希链)
// ============================================================================

// 预计算的 BLAKE3 哈希链(演示用固定值,真实环境由 evorule-server 计算)
export const MEDICAL_AUDIT_HASHES: string[] = [
	"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
	"b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
	"c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
	"d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
	"e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
	"f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1",
];

export const MEDICAL_AUDIT: SessionAudit = {
	entries: MEDICAL_FACTS.map((f, i) => ({
		fact_id: f.id,
		fact_type: f.type,
		logical_time: f.logical_time,
		prev_hash:
			i === 0
				? "0000000000000000000000000000000000000000000000000000000000000000"
				: MEDICAL_AUDIT_HASHES[i - 1],
		content_hash: MEDICAL_AUDIT_HASHES[i],
	})),
	fact_count: 6,
	verified: true,
	last_hash: MEDICAL_AUDIT_HASHES[5],
};

export const MEDICAL_VERIFY: VerifyResult = {
	verified: true,
	detail: "BLAKE3 哈希链验证通过:6 条 Fact,链完整无篡改",
};

// ============================================================================
// 3. 因果链
// ============================================================================

export const MEDICAL_CAUSAL_CHAIN: CausalChain = {
	chain: [
		{
			fact_id: 3,
			fact_type: "rule_triggered",
			logical_time: 3,
			cause: 2,
			content_hash: MEDICAL_AUDIT_HASHES[2],
			prev_hash: MEDICAL_AUDIT_HASHES[1],
		},
		{
			fact_id: 2,
			fact_type: "lab_result",
			logical_time: 2,
			cause: 1,
			content_hash: MEDICAL_AUDIT_HASHES[1],
			prev_hash: MEDICAL_AUDIT_HASHES[0],
		},
		{
			fact_id: 1,
			fact_type: "patient_visit",
			logical_time: 1,
			cause: null,
			content_hash: MEDICAL_AUDIT_HASHES[0],
			prev_hash:
				"0000000000000000000000000000000000000000000000000000000000000000",
		},
	] as CausalEntry[],
};

// ============================================================================
// 4. Session 状态(reactor 运行态)
// ============================================================================

export const MEDICAL_SESSION_STATE: SessionState = {
	payload: {
		patient_id: "P-1283",
		current_status: "用药观察中",
		temperature: 38.6,
		prescribed_drug: "头孢克洛",
	},
	queue: [],
	reactor: {
		phase: "stable",
		causal_depth: 6,
		current_step: 6,
		pending_io_count: 0,
		structural_invariant_violations: 0,
	},
	version: 6,
};

// ============================================================================
// 5. 历史快照(版本 3 — 异常发生点)
// ============================================================================

export const MEDICAL_HISTORICAL_STATE: HistoricalState = {
	payload: {
		patient_id: "P-1283",
		current_status: "等待检验结果",
		temperature: 38.6,
	},
	queue: [],
	version: 3,
};

// ============================================================================
// 6. Diff(版本 3 → 版本 6)
// ============================================================================

export const MEDICAL_DIFF: DiffResult = {
	items: [
		["current_status", "等待检验结果", "用药观察中"],
		["prescribed_drug", undefined, "头孢克洛"],
		["white_blood_cell", undefined, 12.5],
	],
	removed: [],
};

// ============================================================================
// 7. FactRecord(facts 端点返回的 payload 更新索引)
// ============================================================================

export const MEDICAL_FACT_RECORDS: FactRecord[] = MEDICAL_FACTS.map((f) => {
	const payload = (f.payload ?? {}) as { patient_id?: string };
	return {
		fact_id: f.id,
		version: Number(f.logical_time),
		path: `patient.${payload.patient_id ?? "unknown"}.${f.type}`,
		value: f.payload ?? f,
	};
});

// ============================================================================
// 8. 合规门禁 Fact(try_compliance 用)
// ============================================================================

export const MEDICAL_COMPLIANCE_FACTS: Fact[] = [
	{
		type: "tool_call",
		id: 101,
		logical_time: 1,
		timestamp: "2026-08-07T10:00:00Z",
		payload: {
			tool_name: "transfer_money",
			category: "finance",
			amount: 50000,
			caller: "ai_agent_v2",
			auth_factors: ["password"],
			auth_count: 1,
		},
	},
	{
		type: "gate_blocked",
		id: 102,
		logical_time: 2,
		timestamp: "2026-08-07T10:00:01Z",
		rule_id: "djbh.identity.mfa_required",
		rule_name: "管理类工具双因子认证门禁",
		trigger: { tool_category: "finance", auth_count: 1 },
		result: "blocked",
		message:
			"等保 §8.1.4.1.d:管理类操作必须双因子认证(当前仅 1 因子:password)",
		clause: "8.1.4.1.d",
		risk_level: "high",
	},
];
