// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P10/P11 视图模式 store — 专家 ↔ 决策者视图切换。
// P10_TASKFLOW_DEMO_DESIGN.md §3.4 + P11_UX_GAPS_FIX_DESIGN.md §3.4 定义。
//
// 决策者视图:简化 UI,只显示关键指标 + 合规状态 + 事件摘要。
// 专家视图:完整 UI,所有功能可见。
//
// 持久化:localStorage(key: evorule-console-cloud:view-mode)

import { writable } from "svelte/store";
import { browser } from "$app/environment";

export type ViewMode = "expert" | "decision_maker";

const STORAGE_KEY = "evorule-console-cloud:view-mode";

function loadViewMode(): ViewMode {
	if (!browser) return "expert";
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw === "decision_maker" ? "decision_maker" : "expert";
	} catch {
		return "expert";
	}
}

export const viewModeStore = writable<ViewMode>(loadViewMode());

viewModeStore.subscribe((mode) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, mode);
});

/** 切换视图模式 */
export function toggleViewMode(): void {
	viewModeStore.update((m) => (m === "expert" ? "decision_maker" : "expert"));
}

/** 设置视图模式 */
export function setViewMode(mode: ViewMode): void {
	viewModeStore.set(mode);
}
