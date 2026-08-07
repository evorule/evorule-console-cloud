// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10 demo 引导任务完成进度 store。
// 记录用户在 demo 模式下完成了哪些引导任务。
//
// 持久化:localStorage(key: evorule-console-cloud:guided-task-progress)

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";

const STORAGE_KEY = "evorule-console-cloud:guided-task-progress";

export type GuidedTaskId = "try_add" | "try_query" | "try_edit" | "try_compliance";

export interface GuidedTaskProgress {
	/** 引导任务 ID */
	taskId: GuidedTaskId;
	/** 完成时间(ISO) */
	completedAt: string;
	/** 完成时的步骤数 */
	completedSteps: number;
}

function loadProgress(): GuidedTaskProgress[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as GuidedTaskProgress[]) : [];
	} catch {
		return [];
	}
}

export const guidedTaskProgressStore = writable<GuidedTaskProgress[]>(loadProgress());

guidedTaskProgressStore.subscribe((progress) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
});

/** 标记引导任务完成 */
export function markGuidedTaskComplete(
	taskId: GuidedTaskId,
	completedSteps: number,
): void {
	const now = new Date().toISOString();
	guidedTaskProgressStore.update((list) => {
		const filtered = list.filter((p) => p.taskId !== taskId);
		return [...filtered, { taskId, completedAt: now, completedSteps }];
	});
}

/** 检查引导任务是否已完成 */
export function isGuidedTaskCompleted(taskId: GuidedTaskId): boolean {
	return get(guidedTaskProgressStore).some((p) => p.taskId === taskId);
}

/** 获取已完成的引导任务数 */
export function getCompletedCount(): number {
	return get(guidedTaskProgressStore).length;
}

/** 重置进度(测试用) */
export function resetGuidedTaskProgress(): void {
	guidedTaskProgressStore.set([]);
}
