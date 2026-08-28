// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P2-mock 零依赖演示场景 — 杀手 agent 故事线。
// 对应 evorule-agent-demo 的 killer_demo.py 叙事(确定性回放 + 可控自进化)。
//
// 场景:代码审查 agent 自动放行了高危命令 `rm -rf /tmp/build`
//   → 确定性审计链逐 bit 记录(可篡改检测)
//   → rewind 到 step3_BAD(危险决策)→ fork 出修复分支 → diff 证明修复
//   → 长出护栏规则 guard_shell_risky(零代码 JSON)→ 人工审批 → 快照包激活 → 零停机热加载
//
// 本文件为 MockBackend 的预填数据集,不依赖真实 evorule-server,
// 浏览器内 `?mock=1` 打开即见完整故事线(GitHub Pages / 本地均可)。

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
// 1. Fact 流(6 条,代码审查 agent 完整链路)
// ============================================================================

export const AGENT_FACTS: Fact[] = [
	{
		type: "task_received",
		id: 1,
		logical_time: 1,
		timestamp: "2026-08-25T10:00:00Z",
		payload: {
			agent: "code-review",
			task: "审查并批准部署脚本 deploy.sh",
			requester: "ci-pipeline",
		},
	},
	{
		type: "analysis",
		id: 2,
		logical_time: 2,
		timestamp: "2026-08-25T10:00:01Z",
		payload: {
			script: "deploy.sh",
			line: 14,
			detected_command: "rm -rf /tmp/build",
			risk_class: "destructive",
		},
	},
	{
		type: "rule_triggered",
		id: 3,
		logical_time: 3,
		timestamp: "2026-08-25T10:00:02Z",
		rule_id: "agent.auto_approve",
		rule_name: "AI 自动批准(无人工)",
		trigger: { command: "rm -rf /tmp/build" },
		result: "allowed", // ← 危险步骤(step3_BAD):agent 直接放行,未触发人工确认
		message: "agent 直接放行 rm -rf /tmp/build,未触发人工确认",
	},
	{
		type: "rule_triggered",
		id: 4,
		logical_time: 4,
		timestamp: "2026-08-25T10:00:03Z",
		rule_id: "guardrail.destructive_cmd",
		rule_name: "破坏性命令护栏",
		trigger: { command: "rm -rf /tmp/build" },
		result: "blocked",
		message: "确定性审计拦截:检测到破坏性命令,需人工审批",
	},
	{
		type: "decision",
		id: 5,
		logical_time: 5,
		timestamp: "2026-08-25T10:00:04Z",
		payload: {
			action: "rewind_and_fork",
			from_version: 3,
			fix: "将自动放行改为转人工审批",
			mode: "human-approval-required",
		},
	},
	{
		type: "guardrail_activated",
		id: 6,
		logical_time: 6,
		timestamp: "2026-08-25T10:00:05Z",
		payload: {
			rule_id: "guard_shell_risky",
			status: "active",
			effect: "任何 rm -rf 开头命令 → 转人工审批",
			loaded_via: "bundle import + rules/reload (零停机热加载)",
		},
	},
];

// ============================================================================
// 2. 审计链(BLAKE3 哈希链,预计算固定值,演示用)
// ============================================================================

export const AGENT_AUDIT_HASHES: string[] = [
	"k1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
	"k2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3",
	"k3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4",
	"k4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
	"k5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
	"k6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7",
];

export const AGENT_AUDIT: SessionAudit = {
	entries: AGENT_FACTS.map((f, i) => ({
		fact_id: f.id,
		fact_type: f.type,
		logical_time: f.logical_time,
		prev_hash:
			i === 0
				? "0000000000000000000000000000000000000000000000000000000000000000"
				: AGENT_AUDIT_HASHES[i - 1],
		content_hash: AGENT_AUDIT_HASHES[i],
	})),
	fact_count: 6,
	verified: true,
	last_hash: AGENT_AUDIT_HASHES[5],
};

export const AGENT_VERIFY: VerifyResult = {
	verified: true,
	detail: "BLAKE3 哈希链验证通过:6 条 Fact,链完整无篡改;ed25519 签名锚点已校验",
};

// ============================================================================
// 3. 因果链
// ============================================================================

export const AGENT_CAUSAL_CHAIN: CausalChain = {
	chain: [
		{
			fact_id: 6,
			fact_type: "guardrail_activated",
			logical_time: 6,
			cause: 5,
			content_hash: AGENT_AUDIT_HASHES[5],
			prev_hash: AGENT_AUDIT_HASHES[4],
		},
		{
			fact_id: 5,
			fact_type: "decision",
			logical_time: 5,
			cause: 4,
			content_hash: AGENT_AUDIT_HASHES[4],
			prev_hash: AGENT_AUDIT_HASHES[3],
		},
		{
			fact_id: 4,
			fact_type: "rule_triggered",
			logical_time: 4,
			cause: 3,
			content_hash: AGENT_AUDIT_HASHES[3],
			prev_hash: AGENT_AUDIT_HASHES[2],
		},
		{
			fact_id: 3,
			fact_type: "rule_triggered",
			logical_time: 3,
			cause: 2,
			content_hash: AGENT_AUDIT_HASHES[2],
			prev_hash: AGENT_AUDIT_HASHES[1],
		},
		{
			fact_id: 2,
			fact_type: "analysis",
			logical_time: 2,
			cause: 1,
			content_hash: AGENT_AUDIT_HASHES[1],
			prev_hash: AGENT_AUDIT_HASHES[0],
		},
		{
			fact_id: 1,
			fact_type: "task_received",
			logical_time: 1,
			cause: null,
			content_hash: AGENT_AUDIT_HASHES[0],
			prev_hash:
				"0000000000000000000000000000000000000000000000000000000000000000",
		},
	] as CausalEntry[],
};

// ============================================================================
// 4. Session 状态(reactor 运行态,版本 6 = 已护栏化稳态)
// ============================================================================

export const AGENT_SESSION_STATE: SessionState = {
	payload: {
		agent: "code-review",
		status: "已护栏化(稳定)",
		enforced_guardrail: "guard_shell_risky",
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
// 5. 历史快照(版本 3 — 危险发生点,rewind 目标)
// ============================================================================

export const AGENT_HISTORICAL_STATE: HistoricalState = {
	payload: {
		agent: "code-review",
		status: "AI 自动放行(危险步骤)",
		command: "rm -rf /tmp/build",
		risk: "high",
	},
	queue: [],
	version: 3,
};

// ============================================================================
// 6. Diff(版本 3 危险决策 → 版本 6 修复后)
// ============================================================================

export const AGENT_DIFF: DiffResult = {
	items: [
		// 改动:决策模式从"自动放行"变为"转人工审批"
		["decision.mode", "auto-approved (no human)", "human-approval-required"],
		// 改动:命令处置从"直接放行"变为"转审批"
		[
			"decision.command",
			"rm -rf /tmp/build",
			"rm -rf /tmp/build (routed to approval)",
		],
		// 新增:护栏规则生效
		["guardrail.active", "guard_shell_risky"],
	],
	removed: [],
};

// ============================================================================
// 7. FactRecord(facts 端点返回的 payload 更新索引)
// ============================================================================

export const AGENT_FACT_RECORDS: FactRecord[] = AGENT_FACTS.map((f) => {
	const payload = (f.payload ?? {}) as { agent?: string };
	return {
		fact_id: f.id,
		version: Number(f.logical_time),
		path: `agent.${payload.agent ?? "unknown"}.${f.type}`,
		value: f.payload ?? f,
	};
});

// ============================================================================
// 8. 合规门禁 Fact(mock 模式下 agent 不作为合规 session,留空占位保证类型完备)
// ============================================================================

export const AGENT_COMPLIANCE_FACTS: Fact[] = [];
