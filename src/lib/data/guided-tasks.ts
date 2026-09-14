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

// ============================================================================
// WASM 在线模式 7 步引导序列(对齐体验包 QUICKSTART.md 的 7 步教学)
// ============================================================================
// 与上方 4 个 demo 引导任务并存:
//   - HTTP/mock(默认)模式 → 仍渲染原 4 个任务(startTaskFlow 多步向导)。
//   - ?backend=wasm 在线模式 → 渲染下方 7 步序列(WasmTour.svelte)。
// 两者互不影响,HTTP 默认行为零改动。
//
// 7 步来源 QUICKSTART.md,已按在线 WASM 无文件系统/无热重载的约束适配:
//   Step0/3/4(本地启动、改规则热重载、Bundle 管理)在线不适用 → 替换为
//   「引擎就绪」「浏览规则」;核心业务场景(跑指令)与审计/时间旅行在线直接可用。

/** WASM 7 步引导步骤 ID */
export type WasmTourStepId =
	| "wasm_01_engine"
	| "wasm_02_rules"
	| "wasm_03_allow"
	| "wasm_04_block"
	| "wasm_05_medical"
	| "wasm_06_audit"
	| "wasm_07_timetravel";

/** 步骤完成动作类型(决定 WasmTour 如何判定完成) */
export type WasmTourAction =
	/** 引擎就绪:health() === true 且规则集已加载 */
	| "engine_ready"
	/** 浏览规则:用户点击「查看规则库」跳转 /view/rules */
	| "visit_rules"
	/** 跑一条指令:submitCommand 后读 payload.data.result.decision 与期望值比对 */
	| "run_instruction"
	/** 审计链验证:verifyAudit() 返回 verified === true */
	| "verify_audit"
	/** 时间旅行:getStateAtVersion + getDiff 成功返回历史快照与差异 */
	| "time_travel";

/** WASM 7 步引导单步定义 */
export interface WasmTourStep {
	/** 步骤 ID */
	id: WasmTourStepId;
	/** 步骤序号(从 1 开始) */
	order: number;
	/** 显示名称 */
	name: string;
	/** 引导文案(说明这步要做什么、点哪里) */
	pitch: string;
	/** 图标 */
	icon: string;
	/** 完成动作类型 */
	action: WasmTourAction;
	/** run_instruction 步:预填并执行的指令 JSON(扁平 {type,params}) */
	instruction?: object;
	/** run_instruction 步:期望的决策(payload.data.result.decision) */
	expectedDecision?: string;
	/** 完成后给用户的一句解释(为什么看到这个结果) */
	explain: string;
}

/**
 * WASM 在线 7 步引导序列。
 * 指令 JSON 取自 static/rules/*.json 的 instruction_type 与参数路径,
 * 确保每条都能在 WASM 引擎命中对应规则并产生预期 decision。
 */
export const WASM_TOUR_STEPS: WasmTourStep[] = [
	{
		id: "wasm_01_engine",
		order: 1,
		name: "引擎就绪",
		pitch:
			"打开网页即运行——WASM 规则引擎已在你的浏览器里加载完成,无需安装、无需本地服务。点击下方按钮确认引擎健康并确认 16 条业务规则已就位。",
		icon: "⚙️",
		action: "engine_ready",
		explain:
			"health() 返回 true,规则集已注入浏览器内引擎(等保门禁 / 财务限额 / 医疗用药)。",
	},
	{
		id: "wasm_02_rules",
		order: 2,
		name: "浏览规则",
		pitch:
			"这是引擎加载的 16 条业务规则。点击「查看规则库」,在规则面板里随便点开一条,看看它的条件与决策分支。",
		icon: "📚",
		action: "visit_rules",
		explain:
			"你已经看过规则库——每条规则都是「命中条件 → set result.decision」的确定性映射。",
	},
	{
		id: "wasm_03_allow",
		order: 3,
		name: "跑一条放行指令",
		pitch:
			"提交一笔差旅报销 2000 元(限额 3000 元以内)。点击「运行指令」,预期决策是 allowed(放行)。",
		icon: "✅",
		action: "run_instruction",
		instruction: {
			type: "finance_expense_limit_check",
			params: { expense: { type: "travel", amount: 2000 } },
		},
		expectedDecision: "allowed",
		explain: "差旅 2000 < 3000 限额 → decision = allowed,正常报销通过。",
	},
	{
		id: "wasm_04_block",
		order: 4,
		name: "跑一条阻断指令",
		pitch:
			"把差旅报销提到 5000 元(超过 3000 元限额)。点击「运行指令」,预期决策是 blocked(门禁阻断)。",
		icon: "🛑",
		action: "run_instruction",
		instruction: {
			type: "finance_expense_limit_check",
			params: { expense: { type: "travel", amount: 5000 } },
		},
		expectedDecision: "blocked",
		explain:
			"差旅 5000 ≥ 3000 限额 → decision = blocked,阻断并记录原因「差旅报销超限额3000元」。",
	},
	{
		id: "wasm_05_medical",
		order: 5,
		name: "跑一条医疗场景",
		pitch:
			"换医疗域:给青霉素过敏的病人开青霉素类药物。点击「运行指令」,预期被用药禁忌规则阻断。",
		icon: "🏥",
		action: "run_instruction",
		instruction: {
			type: "medical_drug_allergy_check",
			params: {
				patient: { has_penicillin_allergy: true },
				prescription: { drug_class: "penicillin" },
			},
		},
		expectedDecision: "blocked",
		explain:
			"患者有青霉素过敏史且开了青霉素类 → decision = blocked,命中「青霉素过敏者禁用青霉素类药物」。",
	},
	{
		id: "wasm_06_audit",
		order: 6,
		name: "验证审计链",
		pitch:
			"上面每次决策都被写进 BLAKE3 哈希链。点击「验证审计链」,引擎会逐条重算哈希,确认从第一条到最后一条没有任何被篡改。",
		icon: "🔗",
		action: "verify_audit",
		explain:
			"verifyAudit() 返回 verified = true——每条 fact 的 content_hash 都能对上前一条的 prev_hash。",
	},
	{
		id: "wasm_07_timetravel",
		order: 7,
		name: "时间旅行",
		pitch:
			"最后,回到跑指令之前的历史版本,对比当前版本差了什么。点击「时间旅行回放」,引擎会 rewind 到上一版并给出 diff。",
		icon: "⏪",
		action: "time_travel",
		explain:
			"getStateAtVersion + getDiff:你能看到每一次指令让业务状态发生了哪些字段级变化。",
	},
];

/** 按 ID 查找 WASM 引导步骤 */
export function findWasmTourStep(
	id: WasmTourStepId,
): WasmTourStep | undefined {
	return WASM_TOUR_STEPS.find((s) => s.id === id);
}
