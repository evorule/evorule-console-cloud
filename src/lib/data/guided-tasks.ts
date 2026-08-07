// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 demo 模式引导任务定义(4 个,对应 HOME_DESIGN §5.8.4)。
// P10_TASKFLOW_DEMO_DESIGN.md §4.2 定义。

import type { TaskFlowId, TaskContext } from "$lib/stores/task-flow-types";

/** demo 模式引导任务(4 个) */
export interface GuidedTask {
	/** 引导任务 ID */
	id: "try_add" | "try_query" | "try_edit" | "try_compliance";
	/** 显示名称 */
	name: string;
	/** 预计时长 */
	estimatedMinutes: number;
	/** 对应的 TaskFlowId */
	flowId: TaskFlowId;
	/** 预填上下文(医疗/财务两套) */
	presetContext: {
		medical: TaskContext;
		finance: TaskContext;
	};
	/** 引导文案(显示在 DemoHome 卡片上) */
	pitch: string;
	/** 图标 */
	icon: string;
}

export const GUIDED_TASKS: GuidedTask[] = [
	{
		id: "try_add",
		name: "试试加规则",
		estimatedMinutes: 2,
		flowId: "add_rule",
		presetContext: {
			medical: {
				ruleId: "R-DEMO-001",
				businessObject: { type: "patient", id: "P-1283" },
			},
			finance: {
				ruleId: "R-DEMO-F-001",
				businessObject: { type: "invoice", id: "INV-2024-0183" },
			},
		},
		pitch: "给医院加一条「65 岁以上发烧必须先 CT」规则",
		icon: "➕",
	},
	{
		id: "try_query",
		name: "试试查问题",
		estimatedMinutes: 1,
		flowId: "query_issue",
		presetContext: {
			medical: {
				eventId: "E-DEMO-042",
				businessObject: { type: "patient", id: "P-1283" },
				auditRange: { from: 100, to: 150 },
			},
			finance: {
				eventId: "E-DEMO-F-042",
				businessObject: { type: "invoice", id: "INV-2024-0183" },
				auditRange: { from: 80, to: 120 },
			},
		},
		pitch: "定位病人 P-1283 为何触发异常告警",
		icon: "🔍",
	},
	{
		id: "try_edit",
		name: "试试改规则",
		estimatedMinutes: 3,
		flowId: "edit_rule",
		presetContext: {
			medical: {
				ruleId: "R-DEMO-001",
				extra: {
					editField: "temperature_threshold",
					oldValue: 38,
					newValue: 37.5,
				},
			},
			finance: {
				ruleId: "R-DEMO-F-001",
				extra: {
					editField: "reimbursement_limit",
					oldValue: 5000,
					newValue: 6000,
				},
			},
		},
		pitch: "把发烧阈值从 38°C 改为 37.5°C",
		icon: "✏️",
	},
	{
		id: "try_compliance",
		name: "试试合规门禁",
		estimatedMinutes: 2,
		flowId: "compliance_gate",
		presetContext: {
			medical: {
				ruleId: "djbh.identity.mfa_required",
				extra: {
					toolCall: {
						name: "transfer_money",
						category: "finance",
						amount: 50000,
					},
					userAuth: { factors: ["password"], count: 1 },
					expectBlocked: true,
					clause: "8.1.4.1.d",
				},
			},
			finance: {
				ruleId: "djbh.confidentiality.storage_encryption",
				extra: {
					toolCall: {
						name: "db_write",
						fields: { id_card: "310101199001011234" },
					},
					encryption: "none",
					expectBlocked: true,
					clause: "8.1.4.7.b",
				},
			},
		},
		pitch: "AI Agent 调用转账工具但未双因子认证 → 看门禁如何阻断 + BLAKE3 留痕",
		icon: "🛡️",
	},
];

/** 按 ID 查找引导任务 */
export function findGuidedTask(
	id: string,
): GuidedTask | undefined {
	return GUIDED_TASKS.find((t) => t.id === id);
}
