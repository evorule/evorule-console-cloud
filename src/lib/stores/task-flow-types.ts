// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 任务流类型定义。
// P10_TASKFLOW_DEMO_DESIGN.md §4.1 定义。
//
// 6 种任务流:加规则/查问题/改规则/审规则/看历史 + 合规门禁专项。

/** 任务流 ID(6 种) */
export type TaskFlowId =
	| "add_rule"
	| "query_issue"
	| "edit_rule"
	| "review_rule"
	| "view_history"
	| "compliance_gate";

/** 任务流定义(代码内置,不可用户编辑) */
export interface TaskFlowDef {
	/** 任务流 ID */
	id: TaskFlowId;
	/** 显示名称(中文) */
	name: string;
	/** 图标(emoji) */
	icon: string;
	/** 一句话描述 */
	description: string;
	/** 预计时长(分钟) */
	estimatedMinutes: number;
	/** 步骤序列 */
	steps: TaskStepDef[];
	/** 适用的行业(用于 demo 引导任务匹配) */
	applicableIndustries: string[];
}

/** 任务流步骤定义 */
export interface TaskStepDef {
	/** 步骤 ID(任务流内唯一) */
	id: string;
	/** 步骤序号(从 1 开始) */
	order: number;
	/** 显示名称 */
	name: string;
	/** 目标视图路由(跳转 URL) */
	targetRoute: string;
	/** 步骤说明(用户看到的指引) */
	instruction: string;
	/** 完成条件(用户如何判断这步做完) */
	completionHint: string;
	/** 可选:自动填充的 query 参数(demo 模式用) */
	demoParams?: Record<string, string>;
}

/** 任务流运行实例(用户启动一次任务流 = 一个实例) */
export interface TaskFlowInstance {
	/** 实例 ID(UUID) */
	instanceId: string;
	/** 任务流 ID */
	flowId: TaskFlowId;
	/** 当前步骤序号(从 1 开始) */
	currentStep: number;
	/** 启动时间(ISO) */
	startedAt: string;
	/** 上下文(跨步骤传递的数据) */
	context: TaskContext;
	/** 是否 demo 模式(只读) */
	isDemo: boolean;
	/** 状态:running / completed / cancelled */
	status: "running" | "completed" | "cancelled";
}

/** 任务上下文(跨步骤传递) */
export interface TaskContext {
	/** 规则 ID(加规则/改规则/审规则) */
	ruleId?: string;
	/** 业务事件 ID(加规则测试 / 查问题) */
	eventId?: string;
	/** 审计范围(查问题/看历史) */
	auditRange?: { from: number; to: number };
	/** 选中的业务对象(如病人 ID / 案件 ID) */
	businessObject?: { type: string; id: string };
	/** 数据集 ID(加规则可选加入数据集) */
	datasetId?: string;
	/** 协作任务 ID(审规则) */
	reviewTaskId?: string;
	/** 自由扩展字段 */
	extra?: Record<string, unknown>;
}
