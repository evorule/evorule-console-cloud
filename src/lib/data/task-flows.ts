// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 6 任务流定义(代码内置,对应 §4.3 5 任务类型 + 合规门禁专项)。
// 每个任务流 4 步骤,串起 P03-P09 的视图。
//
// 关联设计:P10_TASKFLOW_DEMO_DESIGN.md §5.4

import type { TaskFlowDef } from "$lib/stores/task-flow-types";

export const taskFlowsDef: TaskFlowDef[] = [
	// ========== 1. 加规则 ==========
	{
		id: "add_rule",
		name: "加规则",
		icon: "➕",
		description: "创建新业务规则并验证生效",
		estimatedMinutes: 5,
		applicableIndustries: [
			"医疗", "财务", "律所", "审批", "合规",
			"电商", "进销存", "办公", "个人", "教育",
		],
		steps: [
			{
				id: "create",
				order: 1,
				name: "创建规则",
				targetRoute: "/view/rules",
				instruction: "在业务规则库中,用业务表单或 LLM 辅助创建一条新规则",
				completionHint: "规则创建成功,获得规则 ID",
				demoParams: { action: "create", ruleId: "R-DEMO-001" },
			},
			{
				id: "test",
				order: 2,
				name: "测试规则",
				targetRoute: "/view/execution",
				instruction: "在业务执行台,提交一个业务事件触发新规则",
				completionHint: "规则被触发,产生 Fact",
				demoParams: { action: "test", eventId: "E-DEMO-042" },
			},
			{
				id: "verify",
				order: 3,
				name: "验证生效",
				targetRoute: "/view/state",
				instruction: "在业务状态视图,确认规则已改变业务对象状态",
				completionHint: "业务对象状态符合预期",
				demoParams: { action: "verify" },
			},
			{
				id: "audit",
				order: 4,
				name: "查看审计",
				targetRoute: "/view/audit",
				instruction: "在业务审计视图,查看规则触发的 Fact 和因果链",
				completionHint: "审计链中有新规则触发的记录",
				demoParams: { action: "audit" },
			},
		],
	},

	// ========== 2. 查问题 ==========
	{
		id: "query_issue",
		name: "查问题",
		icon: "🔍",
		description: "定位异常业务事件的根因",
		estimatedMinutes: 3,
		applicableIndustries: ["律所", "合规", "财务", "审批"],
		steps: [
			{
				id: "find",
				order: 1,
				name: "查找异常",
				targetRoute: "/view/audit",
				instruction: "在业务审计视图,找到异常的 Fact(红色标记)",
				completionHint: "定位到异常 Fact",
				demoParams: { action: "query", eventId: "E-DEMO-042" },
			},
			{
				id: "rewind",
				order: 2,
				name: "回溯时间",
				targetRoute: "/view/timetravel",
				instruction: "在业务时间旅行,回溯到异常发生前的版本",
				completionHint: "回溯到异常发生点",
				demoParams: { action: "rewind", version: "15" },
			},
			{
				id: "causal",
				order: 3,
				name: "分析因果",
				targetRoute: "/view/audit",
				instruction: "查看因果链,定位触发异常的根因规则",
				completionHint: "找到根因规则",
				demoParams: { action: "causal", factId: "42" },
			},
			{
				id: "decision",
				order: 4,
				name: "决策支持",
				targetRoute: "/view/audit",
				instruction: "点击「决策建议」按钮,让 LLM 分析并给出修复建议",
				completionHint: "获得 LLM 决策建议",
				demoParams: { action: "decision" },
			},
		],
	},

	// ========== 3. 改规则 ==========
	{
		id: "edit_rule",
		name: "改规则",
		icon: "✏️",
		description: "修改已有规则并验证影响",
		estimatedMinutes: 5,
		applicableIndustries: [
			"医疗", "财务", "律所", "审批", "合规",
			"电商", "进销存", "办公", "个人", "教育",
		],
		steps: [
			{
				id: "find",
				order: 1,
				name: "找到规则",
				targetRoute: "/view/rules",
				instruction: "在业务规则库中,找到要修改的规则",
				completionHint: "选中要修改的规则",
				demoParams: { action: "edit", ruleId: "R-DEMO-001" },
			},
			{
				id: "impact",
				order: 2,
				name: "影响预览",
				targetRoute: "/view/rules",
				instruction: "修改规则字段,查看影响预览(哪些 Fact 会变)",
				completionHint: "确认影响范围可接受",
				demoParams: { action: "impact", ruleId: "R-DEMO-001" },
			},
			{
				id: "dryrun",
				order: 3,
				name: "Dry-run 验证",
				targetRoute: "/view/execution",
				instruction: "在业务执行台,用 dry-run 模式跑一遍,确认新规则行为正确",
				completionHint: "Dry-run 结果符合预期",
				demoParams: { action: "dryrun", ruleId: "R-DEMO-001" },
			},
			{
				id: "audit",
				order: 4,
				name: "确认效果",
				targetRoute: "/view/audit",
				instruction: "在业务审计视图,确认改动后的规则触发符合预期",
				completionHint: "改动生效,审计链正常",
				demoParams: { action: "audit" },
			},
		],
	},

	// ========== 4. 审规则 ==========
	{
		id: "review_rule",
		name: "审规则",
		icon: "✅",
		description: "审核他人提交的规则草案",
		estimatedMinutes: 4,
		applicableIndustries: ["医疗", "律所", "财务", "合规", "审批"],
		steps: [
			{
				id: "inbox",
				order: 1,
				name: "查看待审",
				targetRoute: "/view/collab",
				instruction: "在协作工作流,查看待我审核的规则列表",
				completionHint: "选中一条待审规则",
				demoParams: { action: "inbox", taskId: "T-DEMO-001" },
			},
			{
				id: "detail",
				order: 2,
				name: "查看详情",
				targetRoute: "/view/rules",
				instruction: "查看规则的业务详情和 JSON 定义",
				completionHint: "理解规则意图",
				demoParams: { action: "detail", ruleId: "R-DEMO-002" },
			},
			{
				id: "verify",
				order: 3,
				name: "验证规则",
				targetRoute: "/view/execution",
				instruction: "在业务执行台,跑测试用例验证规则行为",
				completionHint: "规则行为符合预期",
				demoParams: { action: "verify", ruleId: "R-DEMO-002" },
			},
			{
				id: "approve",
				order: 4,
				name: "批准 / 驳回",
				targetRoute: "/view/collab",
				instruction: "回到协作工作流,批准或驳回规则",
				completionHint: "完成审核决定",
				demoParams: { action: "approve", taskId: "T-DEMO-001" },
			},
		],
	},

	// ========== 5. 看历史 ==========
	{
		id: "view_history",
		name: "看历史",
		icon: "📚",
		description: "回放历史审计并导出合规报告",
		estimatedMinutes: 4,
		applicableIndustries: [
			"医疗", "财务", "律所", "审批", "合规",
			"电商", "进销存", "办公", "个人", "教育",
		],
		steps: [
			{
				id: "select",
				order: 1,
				name: "选时间范围",
				targetRoute: "/view/audit",
				instruction: "在业务审计视图,选择要回放的时间范围",
				completionHint: "选定时间范围",
				demoParams: { action: "select", from: "100", to: "150" },
			},
			{
				id: "replay",
				order: 2,
				name: "回放历史",
				targetRoute: "/view/timetravel",
				instruction: "在业务时间旅行,回放选定的历史段",
				completionHint: "回放完成",
				demoParams: { action: "replay", from: "100", to: "150" },
			},
			{
				id: "export",
				order: 3,
				name: "导出审计",
				targetRoute: "/view/audit",
				instruction: "点击「导出审计」按钮,导出 BLAKE3 审计链",
				completionHint: "审计文件下载完成",
				demoParams: { action: "export" },
			},
			{
				id: "verify",
				order: 4,
				name: "BLAKE3 验证",
				targetRoute: "/view/audit",
				instruction: "点击「验证审计链」按钮,确认审计完整性",
				completionHint: "验证通过(verified: true)",
				demoParams: { action: "verify" },
			},
		],
	},

	// ========== 6. 合规门禁(对应 COMPLIANCE_GATE_DESIGN.md) ==========
	{
		id: "compliance_gate",
		name: "合规门禁",
		icon: "🛡️",
		description:
			"体验等保 2.0 三级 AI Agent 行为门禁:工具调用前合规检查 + BLAKE3 留痕",
		estimatedMinutes: 4,
		applicableIndustries: ["合规", "医疗", "财务", "教育"],
		steps: [
			{
				id: "import_rules",
				order: 1,
				name: "导入门禁规则",
				targetRoute: "/view/rules",
				instruction:
					"从模板市场导入 5 条等保 2.0 三级门禁规则(MFA / 存储加密 / 脱敏 / 高危端口 / 数据溯源)",
				completionHint: "5 条门禁规则导入成功,规则库中出现 djbh.* 前缀规则",
				demoParams: {
					action: "import",
					templateId: "builtin.compliance_starter",
					ruleCount: "5",
				},
			},
			{
				id: "simulate_call",
				order: 2,
				name: "模拟工具调用",
				targetRoute: "/view/execution",
				instruction:
					"模拟 AI Agent 调用 transfer_money(管理类工具),仅密码认证(无 MFA)→ 应被门禁阻断",
				completionHint:
					"门禁触发 block,返回「等保 §8.1.4.1.d: 管理类操作必须双因子认证」",
				demoParams: {
					action: "test",
					eventId: "E-DEMO-CG-001",
				},
			},
			{
				id: "view_gate_result",
				order: 3,
				name: "查看门禁结果",
				targetRoute: "/view/state",
				instruction:
					"在监控大屏查看门禁 Fact:blocked + 告警级别 + 阻断原因 + 等保条款号",
				completionHint: "监控大屏显示 1 条 critical 级门禁阻断事件",
				demoParams: {
					action: "verify",
					factType: "blocked",
					riskLevel: "high",
					clause: "8.1.4.1.d",
				},
			},
			{
				id: "audit_trace",
				order: 4,
				name: "审计追溯",
				targetRoute: "/view/audit",
				instruction:
					"在审计视图查看门禁事件的 BLAKE3 哈希链 + 因果链(谁触发了哪个工具 → 被哪条规则阻断)",
				completionHint: "审计链中有门禁记录,BLAKE3 验证通过,可导出合规报告",
				demoParams: {
					action: "audit",
					exportFormat: "pdf",
					reportType: "compliance_gate",
				},
			},
		],
	},
];

/** 按 ID 查找任务流定义 */
export function findTaskFlow(id: string): TaskFlowDef | undefined {
	return taskFlowsDef.find((f) => f.id === id);
}
