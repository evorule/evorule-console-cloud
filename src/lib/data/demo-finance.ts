// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 demo 模式 — 财务场景预填数据。
// P10_TASKFLOW_DEMO_DESIGN.md §3.3 + §4.2 定义。
//
// 场景:报销提交 → 规则校验 → 超额拦截 → 修改 → 重新提交 → 审批
// 覆盖 4 个引导任务(try_add / try_query / try_edit / try_compliance)所需的所有 API 响应。

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
// 1. Fact 流(6 条,报销审批完整链路)
// ============================================================================

export const FINANCE_FACTS: Fact[] = [
	{
		type: "expense_submit",
		id: 1,
		logical_time: 1,
		timestamp: "2026-08-07T09:00:00Z",
		payload: {
			invoice_id: "INV-2024-0183",
			submitter: "王五",
			department: "市场部",
			category: "差旅费",
			amount: 6800,
			currency: "CNY",
			description: "客户拜访差旅",
		},
	},
	{
		type: "rule_triggered",
		id: 2,
		logical_time: 2,
		timestamp: "2026-08-07T09:00:05Z",
		rule_id: "R-DEMO-F-001",
		rule_name: "报销上限校验",
		trigger: { category: "差旅费", amount: 6800 },
		result: "blocked",
		message: "差旅费报销上限 5000 元,当前 6800 元超标,需总监审批",
	},
	{
		type: "approval_request",
		id: 3,
		logical_time: 3,
		timestamp: "2026-08-07T09:00:10Z",
		payload: {
			invoice_id: "INV-2024-0183",
			approver: "赵总监",
			reason: "超额报销需总监审批",
			amount: 6800,
			over_limit: 1800,
		},
	},
	{
		type: "rule_triggered",
		id: 4,
		logical_time: 4,
		timestamp: "2026-08-07T09:30:00Z",
		rule_id: "r_expense_split",
		rule_name: "超额拆分检测",
		trigger: { submitter: "王五", category: "差旅费", month: "2024-08" },
		result: "warning",
		message: "本月王五已有 2 笔差旅费报销,累计 9200 元,注意拆分报销风险",
	},
	{
		type: "approval_decision",
		id: 5,
		logical_time: 5,
		timestamp: "2026-08-07T10:00:00Z",
		payload: {
			invoice_id: "INV-2024-0183",
			approver: "赵总监",
			decision: "approved",
			condition: "附客户拜访证明后报销",
		},
	},
	{
		type: "decision",
		id: 6,
		logical_time: 6,
		timestamp: "2026-08-07T10:01:00Z",
		payload: {
			invoice_id: "INV-2024-0183",
			final_decision: "approved_with_condition",
			summary: "批准报销 6800 元,需附客户拜访证明",
			precautions: "下月差旅费预算已用 85%",
		},
	},
];

// ============================================================================
// 2. 审计链(BLAKE3 哈希链)
// ============================================================================

export const FINANCE_AUDIT_HASHES: string[] = [
	"1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b",
	"2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c",
	"3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d",
	"4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e",
	"5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f",
	"6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a",
];

export const FINANCE_AUDIT: SessionAudit = {
	entries: FINANCE_FACTS.map((f, i) => ({
		fact_id: f.id,
		fact_type: f.type,
		logical_time: f.logical_time,
		prev_hash:
			i === 0
				? "0000000000000000000000000000000000000000000000000000000000000000"
				: FINANCE_AUDIT_HASHES[i - 1],
		content_hash: FINANCE_AUDIT_HASHES[i],
	})),
	fact_count: 6,
	verified: true,
	last_hash: FINANCE_AUDIT_HASHES[5],
};

export const FINANCE_VERIFY: VerifyResult = {
	verified: true,
	detail: "BLAKE3 哈希链验证通过:6 条 Fact,链完整无篡改",
};

// ============================================================================
// 3. 因果链
// ============================================================================

export const FINANCE_CAUSAL_CHAIN: CausalChain = {
	chain: [
		{
			fact_id: 2,
			fact_type: "rule_triggered",
			logical_time: 2,
			cause: 1,
			content_hash: FINANCE_AUDIT_HASHES[1],
			prev_hash: FINANCE_AUDIT_HASHES[0],
		},
		{
			fact_id: 1,
			fact_type: "expense_submit",
			logical_time: 1,
			cause: null,
			content_hash: FINANCE_AUDIT_HASHES[0],
			prev_hash:
				"0000000000000000000000000000000000000000000000000000000000000000",
		},
	] as CausalEntry[],
};

// ============================================================================
// 4. Session 状态(reactor 运行态)
// ============================================================================

export const FINANCE_SESSION_STATE: SessionState = {
	payload: {
		invoice_id: "INV-2024-0183",
		current_status: "已批准(附条件)",
		amount: 6800,
		approver: "赵总监",
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
// 5. 历史快照(版本 2 — 拦截发生点)
// ============================================================================

export const FINANCE_HISTORICAL_STATE: HistoricalState = {
	payload: {
		invoice_id: "INV-2024-0183",
		current_status: "已拦截(超额)",
		amount: 6800,
	},
	queue: [],
	version: 2,
};

// ============================================================================
// 6. Diff(版本 2 → 版本 6)
// ============================================================================

export const FINANCE_DIFF: DiffResult = {
	items: [
		["current_status", "已拦截(超额)", "已批准(附条件)"],
		["approver", undefined, "赵总监"],
		["final_decision", undefined, "approved_with_condition"],
	],
	removed: [],
};

// ============================================================================
// 7. FactRecord(facts 端点返回的 payload 更新索引)
// ============================================================================

export const FINANCE_FACT_RECORDS: FactRecord[] = FINANCE_FACTS.map((f) => {
	const payload = (f.payload ?? {}) as { invoice_id?: string };
	return {
		fact_id: f.id,
		version: Number(f.logical_time),
		path: `invoice.${payload.invoice_id ?? "unknown"}.${f.type}`,
		value: f.payload ?? f,
	};
});

// ============================================================================
// 8. 合规门禁 Fact(try_compliance 用)
// ============================================================================

export const FINANCE_COMPLIANCE_FACTS: Fact[] = [
	{
		type: "tool_call",
		id: 201,
		logical_time: 1,
		timestamp: "2026-08-07T10:00:00Z",
		payload: {
			tool_name: "db_write",
			fields: { id_card: "310101199001011234" },
			caller: "ai_agent_v3",
			encryption: "none",
		},
	},
	{
		type: "gate_blocked",
		id: 202,
		logical_time: 2,
		timestamp: "2026-08-07T10:00:01Z",
		rule_id: "djbh.confidentiality.storage_encryption",
		rule_name: "敏感数据存储加密门禁",
		trigger: { field: "id_card", encryption: "none" },
		result: "blocked",
		message:
			"等保 §8.1.4.7.b:身份信息存储必须加密(当前 encryption=none)",
		clause: "8.1.4.7.b",
		risk_level: "high",
	},
];
