// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Agent 审计业务模板(首跑建库向导 Step 1 的 Agent 入口)。
// 完整度:P0 浅模板(规则 + 业务术语;表单 schema 空)
// 业务场景:Agent 护栏三件套——破坏性命令拦截 / AI 自动批准转人工 / 敏感操作 MFA 门禁
//
// 规则内容与 assets/evorule-rules/agent-audit-starter/ 三件同源同语义
// (此处为向导写入形态:instruction 域分流 + eq 显式 on_missing=error fail-closed;
//  可装载实体经真机装载门禁与执行黄金验证,详见仓内 starter 目录)。
//
// 关联设计:plan/DESIGN-agent-audit-starter.md(市场侧内容件)

import type { BusinessTerm } from "$lib/stores/business-terms";
import type { BusinessFormSchema } from "$lib/stores/business-form-schema";
import type { RuleBusinessMeta } from "$lib/stores/rule-business-meta";
import type { Industry } from "$lib/stores/db";
import type { TemplateRule, BusinessTemplate } from "./template-finance";

/** 护栏规则 1:破坏性命令拦截(检测归生产者,规则只裁决风险等级) */
const AGENT_RULE_GUARD_SHELL: TemplateRule = {
	name: "agent.guard_shell_risky",
	description: "破坏性命令护栏:risk_class=destructive 阻断转人工审批",
	content: JSON.stringify({
		id: "agent.guard_shell_risky",
		version: 1,
		description: "破坏性命令护栏:risk_class=destructive 阻断转人工审批",
		transform: [
			{
				type: "branch",
				params: {
					domain: { type: "instruction", instruction_type: "shell_exec_check" },
					on_true: [
						{
							type: "set",
							params: {
								attr: "data",
								operation: "set",
								value: "__exec__.instruction.params",
							},
						},
						{
							type: "branch",
							params: {
								domain: {
									type: "eq",
									path: "__exec__.payload.data.risk_class",
									value: "destructive",
									on_missing: "error",
								},
								on_true: [
									{
										type: "set",
										params: {
											attr: "__exec__.payload.data.gate_decision",
											operation: "set",
											value: "blocked",
										},
									},
								],
								on_false: [
									{
										type: "set",
										params: {
											attr: "__exec__.payload.data.gate_decision",
											operation: "set",
											value: "allowed",
										},
									},
								],
							},
						},
					],
				},
			},
			{
				type: "branch",
				params: {
					domain: { type: "all", inner: [] },
					on_true: [],
				},
			},
		],
	}),
};

/** 护栏规则 2:AI 自动批准不允许直接生效,转人工确认 */
const AGENT_RULE_AUTO_APPROVE: TemplateRule = {
	name: "agent.auto_approve_gate",
	description: "AI 自动批准门禁:auto_approved=true 转人工确认",
	content: JSON.stringify({
		id: "agent.auto_approve_gate",
		version: 1,
		description: "AI 自动批准门禁:auto_approved=true 转人工确认",
		transform: [
			{
				type: "branch",
				params: {
					domain: { type: "instruction", instruction_type: "agent_release_check" },
					on_true: [
						{
							type: "set",
							params: {
								attr: "data",
								operation: "set",
								value: "__exec__.instruction.params",
							},
						},
						{
							type: "branch",
							params: {
								domain: {
									type: "eq",
									path: "__exec__.payload.data.auto_approved",
									value: true,
									on_missing: "error",
								},
								on_true: [
									{
										type: "set",
										params: {
											attr: "__exec__.payload.data.gate_decision",
											operation: "set",
											value: "require_human_approval",
										},
									},
								],
								on_false: [
									{
										type: "set",
										params: {
											attr: "__exec__.payload.data.gate_decision",
											operation: "set",
											value: "allowed",
										},
									},
								],
							},
						},
					],
				},
			},
			{
				type: "branch",
				params: {
					domain: { type: "all", inner: [] },
					on_true: [],
				},
			},
		],
	}),
};

/** 护栏规则 3:敏感操作 MFA 门禁(等保 2.0 §8.1.4.1.d) */
const AGENT_RULE_MFA_GATE: TemplateRule = {
	name: "agent.mfa_gate",
	description: "敏感操作 MFA 门禁:未过 MFA 阻断留痕",
	content: JSON.stringify({
		id: "agent.mfa_gate",
		version: 1,
		description: "敏感操作 MFA 门禁:未过 MFA 阻断留痕",
		transform: [
			{
				type: "branch",
				params: {
					domain: { type: "instruction", instruction_type: "ai_mfa_gate_check" },
					on_true: [
						{
							type: "set",
							params: {
								attr: "data",
								operation: "set",
								value: "__exec__.instruction.params",
							},
						},
						{
							type: "branch",
							params: {
								domain: {
									type: "eq",
									path: "__exec__.payload.data.request.mfa_verified",
									value: false,
									on_missing: "error",
								},
								on_true: [
									{
										type: "set",
										params: {
											attr: "__exec__.payload.data.request.gate_decision",
											operation: "set",
											value: "blocked",
										},
									},
								],
								on_false: [
									{
										type: "set",
										params: {
											attr: "__exec__.payload.data.request.gate_decision",
											operation: "set",
											value: "allowed",
										},
									},
								],
							},
						},
					],
				},
			},
			{
				type: "branch",
				params: {
					domain: { type: "all", inner: [] },
					on_true: [],
				},
			},
		],
	}),
};

const AGENT_BUSINESS_TERMS: BusinessTerm[] = [
	{
		id: "command.risk_class",
		industry: "agent",
		label: "命令风险等级",
		key: "command.risk_class",
		synonyms: ["危险等级", "风险分类"],
		description: "指令生产者对命令的静态风险定级(destructive=破坏性);规则按此裁决是否放行",
		status: "active",
		version: 1,
	},
	{
		id: "release.auto_approved",
		industry: "agent",
		label: "AI 自动批准",
		key: "release.auto_approved",
		synonyms: ["自动放行", "AI 批准"],
		description: "AI 是否未经人工直接批准了发布/执行;为真时护栏将转人工确认",
		status: "active",
		version: 1,
	},
	{
		id: "request.mfa_verified",
		industry: "agent",
		label: "MFA 已验证",
		key: "request.mfa_verified",
		synonyms: ["多因子已验证", "双因子"],
		description: "敏感操作前是否通过 MFA 验证(等保 2.0 三级 §8.1.4.1.d)",
		status: "active",
		version: 1,
	},
];

export const AGENT_TEMPLATE: BusinessTemplate & { id: "agent"; industry: Industry } = {
	id: "agent",
	industry: "agent",
	displayName: "Agent 审计",
	description: "Agent 护栏三件套:破坏性命令拦截 + AI 自动批准转人工 + MFA 门禁",
	builtinRules: [AGENT_RULE_GUARD_SHELL, AGENT_RULE_AUTO_APPROVE, AGENT_RULE_MFA_GATE],
	businessTerms: AGENT_BUSINESS_TERMS,
	formSchemas: [] as BusinessFormSchema[],
	defaultBusinessObjects: ["Agent 指令", "护栏决策"],
	ruleMetaTemplate: [
		{
			industry: "agent",
			businessObject: "Agent 指令",
			businessTermIds: ["command.risk_class", "release.auto_approved", "request.mfa_verified"],
			scenarioContext: "Agent 编程审计:AI 工具调用/发布前的确定性护栏门禁",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
	],
};
