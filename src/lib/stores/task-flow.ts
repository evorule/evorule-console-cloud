// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 当前任务流实例 store。
// P10_TASKFLOW_DEMO_DESIGN.md §5.2 定义。
//
// 设计:
//   - 同一时刻只允许 1 个任务流运行(避免用户混淆)
//   - 启动新任务流时,若已有运行中的,先静默取消
//   - demo 模式下,任务流只读(不允许修改预填上下文)
//   - 不持久化(刷新即取消)。P1 可加恢复功能。

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { taskFlowsDef, findTaskFlow } from "$lib/data/task-flows";
import {
	taskHistoryStore,
	addHistoryEntry,
	updateHistoryEntry,
} from "./task-history";
import {
	markGuidedTaskComplete,
	type GuidedTaskId,
} from "./guided-task-progress";
import type {
	TaskFlowInstance,
	TaskFlowId,
	TaskContext,
	TaskStepDef,
} from "./task-flow-types";

export const taskFlowStore = writable<TaskFlowInstance | null>(null);

/**
 * 生成实例 ID(crypto.randomUUID 不可用时降级)
 */
function genInstanceId(): string {
	if (typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `tf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 启动任务流
 * @param flowId 任务流 ID
 * @param isDemo 是否 demo 模式(只读)
 * @param presetContext 预填上下文(demo 引导任务用)
 */
export function startTaskFlow(
	flowId: TaskFlowId,
	isDemo = false,
	presetContext?: Partial<TaskContext>,
): void {
	// 若已有运行中的任务流,先静默取消
	const current = get(taskFlowStore);
	if (current && current.status === "running") {
		cancelTaskFlow(false);
	}

	const def = findTaskFlow(flowId);
	if (!def) throw new Error(`Unknown task flow: ${flowId}`);

	const instance: TaskFlowInstance = {
		instanceId: genInstanceId(),
		flowId,
		currentStep: 1,
		startedAt: new Date().toISOString(),
		context: presetContext ?? {},
		isDemo,
		status: "running",
	};

	taskFlowStore.set(instance);
	addHistoryEntry(instance, def);

	// 跳转到第一步
	navigateToStep(instance, 1);
}

/**
 * 推进到下一步
 * @param contextUpdate 可选:更新上下文(如本步选中的 ruleId)
 * @param guidedTaskId 可选:demo 引导任务 ID(完成时记录进度)
 */
export function nextStep(
	contextUpdate?: Partial<TaskContext>,
	guidedTaskId?: GuidedTaskId,
): void {
	const current = get(taskFlowStore);
	if (!current || current.status !== "running") return;

	const def = findTaskFlow(current.flowId);
	if (!def) return;

	const next = current.currentStep + 1;
	if (next > def.steps.length) {
		completeTaskFlow(guidedTaskId);
		return;
	}

	const updated: TaskFlowInstance = {
		...current,
		currentStep: next,
		context: { ...current.context, ...contextUpdate },
	};
	taskFlowStore.set(updated);
	updateHistoryEntry(updated, def);
	navigateToStep(updated, next);
}

/**
 * 回到上一步(不修改上下文)
 */
export function prevStep(): void {
	const current = get(taskFlowStore);
	if (!current || current.status !== "running") return;

	const prev = Math.max(1, current.currentStep - 1);
	if (prev === current.currentStep) return;

	const updated: TaskFlowInstance = { ...current, currentStep: prev };
	taskFlowStore.set(updated);
	navigateToStep(updated, prev);
}

/**
 * 跳转到指定步骤(允许跳步,用于用户点进度条)
 */
export function jumpToStep(step: number): void {
	const current = get(taskFlowStore);
	if (!current || current.status !== "running") return;

	const def = findTaskFlow(current.flowId);
	if (!def || step < 1 || step > def.steps.length) return;

	const updated: TaskFlowInstance = { ...current, currentStep: step };
	taskFlowStore.set(updated);
	navigateToStep(updated, step);
}

/**
 * 完成任务流
 * @param guidedTaskId 可选:demo 引导任务 ID(记录完成进度)
 */
export function completeTaskFlow(guidedTaskId?: GuidedTaskId): void {
	const current = get(taskFlowStore);
	if (!current) return;

	const def = findTaskFlow(current.flowId);
	if (!def) return;

	const completed: TaskFlowInstance = {
		...current,
		status: "completed",
	};
	taskFlowStore.set(completed);
	updateHistoryEntry(completed, def);

	// demo 引导任务记录进度
	if (guidedTaskId) {
		markGuidedTaskComplete(guidedTaskId, def.steps.length);
	}

	// 3 秒后清空实例
	setTimeout(() => {
		const cur = get(taskFlowStore);
		if (cur && cur.instanceId === completed.instanceId) {
			taskFlowStore.set(null);
		}
	}, 3000);
}

/**
 * 取消任务流
 * @param navigate 是否跳转回首页(默认 true)
 */
export function cancelTaskFlow(navigate = true): void {
	const current = get(taskFlowStore);
	if (!current) return;

	const def = findTaskFlow(current.flowId);
	if (!def) return;

	const cancelled: TaskFlowInstance = {
		...current,
		status: "cancelled",
	};
	taskFlowStore.set(cancelled);
	updateHistoryEntry(cancelled, def);

	setTimeout(() => taskFlowStore.set(null), 100);

	if (navigate && browser) {
		import("$app/navigation").then(({ goto }) => goto("/"));
	}
}

/**
 * 更新上下文(不推进步骤)
 */
export function updateContext(patch: Partial<TaskContext>): void {
	const current = get(taskFlowStore);
	if (!current || current.status !== "running") return;
	if (current.isDemo) return; // demo 模式只读

	taskFlowStore.set({
		...current,
		context: { ...current.context, ...patch },
	});
}

/**
 * 跳转到指定步骤的路由(内部函数)
 */
function navigateToStep(instance: TaskFlowInstance, step: number): void {
	if (!browser) return;

	const def = findTaskFlow(instance.flowId);
	if (!def) return;

	const stepDef = def.steps[step - 1];
	if (!stepDef) return;

	// 拼 URL:基础路由 + demo 参数 + 上下文参数
	const params = new URLSearchParams();
	if (instance.isDemo) params.set("demo", "true");
	params.set("task", instance.instanceId);
	params.set("step", String(step));

	// demo 模式叠加预填参数
	if (instance.isDemo && stepDef.demoParams) {
		for (const [k, v] of Object.entries(stepDef.demoParams)) {
			params.set(k, v);
		}
	}

	const url = `${stepDef.targetRoute}?${params.toString()}`;
	import("$app/navigation").then(({ goto }) => goto(url));
}

/**
 * 获取当前步骤定义(非响应式,命令式调用用)
 */
export function getCurrentStepDef(): TaskStepDef | null {
	const current = get(taskFlowStore);
	if (!current) return null;
	const def = findTaskFlow(current.flowId);
	if (!def) return null;
	return def.steps[current.currentStep - 1] ?? null;
}

/**
 * 获取当前任务流定义
 */
export function getCurrentFlowDef() {
	const current = get(taskFlowStore);
	if (!current) return null;
	return findTaskFlow(current.flowId) ?? null;
}

// 导出 taskHistoryStore 供组件使用
export { taskHistoryStore } from "./task-history";
