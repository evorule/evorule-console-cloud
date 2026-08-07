// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 任务历史记录类型定义。
// P10_TASKFLOW_DEMO_DESIGN.md §4.3 定义。

import type { TaskFlowId } from "./task-flow-types";

/** 任务历史记录(用户可回看) */
export interface TaskHistoryEntry {
	/** 实例 ID */
	instanceId: string;
	/** 任务流 ID */
	flowId: TaskFlowId;
	/** 任务流名称(快照,防止定义变更后历史失配) */
	flowName: string;
	/** 完成的步骤数 */
	completedSteps: number;
	/** 总步骤数 */
	totalSteps: number;
	/** 启动时间 */
	startedAt: string;
	/** 结束时间(completed/cancelled 时填充) */
	endedAt?: string;
	/** 状态:running(进行中)/ completed(完成)/ cancelled(取消) */
	status: "running" | "completed" | "cancelled";
	/** 是否 demo 模式 */
	isDemo: boolean;
}
