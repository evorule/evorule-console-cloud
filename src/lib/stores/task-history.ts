// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 任务历史记录 store。
// P10_TASKFLOW_DEMO_DESIGN.md §5.3 定义。
//
// 持久化:localStorage(key: evorule-console-cloud:task-history),最多 100 条。

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import type { TaskHistoryEntry } from "./task-history-types";
import type { TaskFlowInstance, TaskFlowDef } from "./task-flow-types";

const STORAGE_KEY = "evorule-console-cloud:task-history";
const MAX_ENTRIES = 100;

function loadHistory(): TaskHistoryEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as TaskHistoryEntry[]) : [];
	} catch {
		return [];
	}
}

export const taskHistoryStore = writable<TaskHistoryEntry[]>(loadHistory());

taskHistoryStore.subscribe((entries) => {
	if (!browser) return;
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify(entries.slice(0, MAX_ENTRIES)),
	);
});

/** 启动任务流时,新增一条历史 */
export function addHistoryEntry(
	instance: TaskFlowInstance,
	def: TaskFlowDef,
): void {
	const entry: TaskHistoryEntry = {
		instanceId: instance.instanceId,
		flowId: instance.flowId,
		flowName: def.name,
		completedSteps: 0,
		totalSteps: def.steps.length,
		startedAt: instance.startedAt,
		status: "running", // 启动时 running,完成/取消时更新
		isDemo: instance.isDemo,
	};
	taskHistoryStore.update((entries) =>
		[entry, ...entries].slice(0, MAX_ENTRIES),
	);
}

/** 任务流状态变化时,更新对应历史 */
export function updateHistoryEntry(
	instance: TaskFlowInstance,
	def: TaskFlowDef,
): void {
	taskHistoryStore.update((entries) =>
		entries.map((e) =>
			e.instanceId === instance.instanceId
				? {
						...e,
						completedSteps:
							instance.status === "completed"
								? def.steps.length
								: Math.max(e.completedSteps, instance.currentStep - 1),
						endedAt:
							instance.status === "completed" ||
							instance.status === "cancelled"
									? new Date().toISOString()
									: e.endedAt,
						status: instance.status as TaskHistoryEntry["status"],
					}
				: e,
		),
	);
}

/** 清空历史 */
export function clearHistory(): void {
	taskHistoryStore.set([]);
}

/** 重置(测试用) */
export function resetTaskHistory(): void {
	taskHistoryStore.set([]);
}
