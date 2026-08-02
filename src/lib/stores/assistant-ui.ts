// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — Assistant UI 状态 store(三 Dialog 开关)
//
// 设计:
//   - 单一 store 管理三个 LLM Dialog 的开关状态
//   - 视图通过 onaiGenerateDraft / onaiExplainRule / onaiGenerateInput 回调打开
//   - Dialog 内部通过 closeAssistantDialog() 关闭
//
// 与内核边界:
//   - 本 store 是大众版独有,内核不感知
//   - 内核只调 callback,大众版在 callback 里 openAssistantDialog('draft' | 'explain' | 'input')

import { writable } from 'svelte/store';

/** 三种 Dialog 类型(对应三用途) */
export type AssistantDialogType = 'draft' | 'explain' | 'input';

/** 当前打开的 Dialog(只允许同时开一个;null 表示全关) */
export const activeAssistantDialog = writable<AssistantDialogType | null>(null);

/** 打开指定 Dialog(若已打开其他 Dialog,先关闭) */
export function openAssistantDialog(type: AssistantDialogType): void {
	activeAssistantDialog.set(type);
}

/** 关闭当前 Dialog(无论哪个) */
export function closeAssistantDialog(): void {
	activeAssistantDialog.set(null);
}

/** 检查指定 Dialog 是否打开 */
export function isAssistantDialogOpen(type: AssistantDialogType): boolean {
	// 用 get 同步读取(非响应式,用于命令式代码)
	// 响应式场景用 $activeAssistantDialog === type
	let current: AssistantDialogType | null = null;
	const unsub = activeAssistantDialog.subscribe((v) => {
		current = v;
	});
	unsub();
	return current === type;
}
