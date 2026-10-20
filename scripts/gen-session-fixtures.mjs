// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Agent 会话查看器 fixture 生成器 — 产出真实 BLAKE3 链的静态演示文件。
//
// 用法:node scripts/gen-session-fixtures.mjs
// 产物:src/lib/session-audit/fixtures/*.json(两个 fixture)
//   1. agent-killer.json   — 代码审查 agent 放行高危命令→护栏拦截→修复(安全护栏主张)
//   2. numeric-compute.json— 确定性计算会话:双路径互验 59.97=5997/100(确定性计算主张)
//
// 契约与 src/lib/session-audit/{types,verify}.ts 同源:
//   fact_hash = blake3(canonical_json({fact_id, fact})),prev 链接,root=末条

import { blake3 } from "@noble/hashes/blake3.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "src", "lib", "session-audit", "fixtures");
mkdirSync(outDir, { recursive: true });

function canonicalJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function toHex(bytes) {
	let hex = "";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return hex;
}

function hashFact(factId, fact) {
	return `blake3:${toHex(blake3(new TextEncoder().encode(canonicalJson({ fact_id: factId, fact }))))}`;
}

function buildSession(manifest, facts, toolCalls) {
	const entries = [];
	let prev = null;
	for (const fact of facts) {
		const h = hashFact(fact.id, fact);
		entries.push({ fact_id: fact.id, fact_hash: h, prev_hash: prev });
		prev = h;
	}
	return {
		format: "evorule-agent-session",
		version: 1,
		manifest,
		facts,
		chain: { algorithm: "blake3-linked", entries, root: prev },
		tool_calls: toolCalls,
	};
}

// ── fixture 1:安全护栏线(代码审查 agent) ──────────────────────────
const killer = buildSession(
	{
		session_id: "evo-agent-demo-killer-001",
		producer: "evo-agent",
		producer_version: "0.2.0",
		created_at: "2026-10-20T10:00:00Z",
		task_summary: "代码审查 agent 审查部署脚本 deploy.sh,放行高危命令被确定性护栏拦截",
		verdict: "guarded",
		tool_call_count: 3,
	},
	[
		{
			type: "task_received",
			id: 1,
			logical_time: 1,
			timestamp: "2026-10-20T10:00:00Z",
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
			timestamp: "2026-10-20T10:00:01Z",
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
			timestamp: "2026-10-20T10:00:02Z",
			rule_id: "agent.auto_approve",
			rule_name: "AI 自动批准(无人工)",
			trigger: { command: "rm -rf /tmp/build" },
			result: "allowed",
			message: "agent 直接放行 rm -rf /tmp/build,未触发人工确认",
		},
		{
			type: "rule_triggered",
			id: 4,
			logical_time: 4,
			timestamp: "2026-10-20T10:00:03Z",
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
			timestamp: "2026-10-20T10:00:04Z",
			payload: {
				decision: "require_human_approval",
				reason: "等保 2.0 三级 §8.1.4:破坏性操作须人工确认",
				trace_id: "trace-kill-001",
			},
		},
		{
			type: "guardrail_evolved",
			id: 6,
			logical_time: 6,
			timestamp: "2026-10-20T10:05:00Z",
			payload: {
				rule_id: "guard_shell_risky",
				format: "json-zero-code",
				approved_by: "human-operator",
				activation: "hot-reload",
				notes: "复盘后零代码长出通用 shell 高危命令护栏并热加载",
			},
		},
	],
	[
		{
			seq: 1,
			name: "read_file",
			args_summary: "deploy.sh",
			result_summary: "142 行 shell 脚本",
			linked_fact_id: 1,
		},
		{
			seq: 2,
			name: "scan_commands",
			args_summary: "静态扫描高危命令模式",
			result_summary: "命中 1 条:rm -rf /tmp/build(L14)",
			linked_fact_id: 2,
		},
		{
			seq: 3,
			name: "approve_release",
			args_summary: "自动批准发布",
			result_summary: "被护栏拦截(blocked),转人工审批",
			linked_fact_id: 4,
		},
	],
);

// ── fixture 2:确定性计算线(双路径互验 59.97=5997/100) ─────────────
const compute = buildSession(
	{
		session_id: "evo-agent-demo-compute-001",
		producer: "evo-agent",
		producer_version: "0.2.0",
		created_at: "2026-10-20T11:30:00Z",
		task_summary: "agent 计算订单折后价 59.97,双路径互验:十进制与有理数两条通路结果一致",
		verdict: "determined|bitwise_replayable",
		tool_call_count: 3,
	},
	[
		{
			type: "task_received",
			id: 1,
			logical_time: 1,
			timestamp: "2026-10-20T11:30:00Z",
			payload: {
				agent: "order-settlement",
				task: "计算订单折后价(单价 19.99 × 数量 3)",
				requester: "billing",
			},
		},
		{
			type: "tool_call",
			id: 2,
			logical_time: 2,
			timestamp: "2026-10-20T11:30:01Z",
			payload: {
				skill: "evorule-deterministic-compute",
				tool: "numeric_decimal_eval",
				input: "19.99 * 3",
				output: "59.97",
				service: "numeric/decimal_eval",
			},
		},
		{
			type: "tool_call",
			id: 3,
			logical_time: 3,
			timestamp: "2026-10-20T11:30:02Z",
			payload: {
				skill: "evorule-deterministic-compute",
				tool: "numeric_rational_eval",
				input: "1999/100 * 3",
				output: "5997/100",
				service: "numeric/rational_eval",
			},
		},
		{
			type: "decision",
			id: 4,
			logical_time: 4,
			timestamp: "2026-10-20T11:30:03Z",
			payload: {
				decision: "amount=59.97",
				verification: "5997/100 == 59.97(双路径一致)",
				verdict: "determined",
			},
		},
		{
			type: "session_complete",
			id: 5,
			logical_time: 5,
			timestamp: "2026-10-20T11:30:04Z",
			payload: {
				replayable: "bitwise_replayable",
				llm_arithmetic_used: false,
				notes: "数值结论全部来自确定性计算服务,模型未参与算数",
			},
		},
	],
	[
		{
			seq: 1,
			name: "read_skill",
			args_summary: "evorule-deterministic-compute",
			result_summary: "技能说明与可用服务清单",
			linked_fact_id: 1,
		},
		{
			seq: 2,
			name: "numeric_decimal_eval",
			args_summary: "19.99 * 3",
			result_summary: "59.97",
			linked_fact_id: 2,
		},
		{
			seq: 3,
			name: "numeric_rational_eval",
			args_summary: "1999/100 * 3",
			result_summary: "5997/100",
			linked_fact_id: 3,
		},
	],
);

writeFileSync(join(outDir, "agent-killer.json"), JSON.stringify(killer, null, 2) + "\n");
writeFileSync(join(outDir, "numeric-compute.json"), JSON.stringify(compute, null, 2) + "\n");
console.log(`fixtures written to ${outDir}`);
console.log(`  killer  : ${killer.facts.length} facts, root=${killer.chain.root.slice(0, 23)}…`);
console.log(`  compute : ${compute.facts.length} facts, root=${compute.chain.root.slice(0, 23)}…`);
