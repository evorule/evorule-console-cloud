// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 工作台连接/刷新状态 store(UV-021 W1)。
//
// 职责:承载 surface 宿主(WorkbenchView)的页面级轮询产物
//   (server/rule 连接状态、刷新中标记、上次刷新时间),
//   供 widget(如 SystemStatusWidget)订阅展示。
//
// 设计:
//   - 轮询调度仍在 surface 宿主(WorkbenchView onMount)——widget 保持自包含展示
//   - refreshNow 由宿主注入;widget 只调用,不感知调度细节
//   - 纯 UI 状态,不持久化

import { writable } from 'svelte/store';

export interface WorkbenchStatus {
	/** server(18080)连接态:null=未探测 */
	serverConnected: boolean | null;
	/** rule(18081)连接态:null=未探测 */
	ruleConnected: boolean | null;
	/** 刷新进行中 */
	refreshing: boolean;
	/** 上次成功刷新时间 */
	lastRefreshAt: Date | null;
}

export const workbenchStatus = writable<WorkbenchStatus>({
	serverConnected: null,
	ruleConnected: null,
	refreshing: false,
	lastRefreshAt: null,
});

/** 宿主注入的刷新动作(widget 触发「立即刷新」用) */
let refreshAction: (() => void) | null = null;

export function setWorkbenchRefreshAction(action: (() => void) | null): void {
	refreshAction = action;
}

export function workbenchRefreshNow(): void {
	refreshAction?.();
}

/** 宿主更新状态(部分 patch) */
export function patchWorkbenchStatus(patch: Partial<WorkbenchStatus>): void {
	workbenchStatus.update((s) => ({ ...s, ...patch }));
}
