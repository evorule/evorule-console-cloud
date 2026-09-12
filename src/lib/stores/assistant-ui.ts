// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — Assistant UI 状态 store(Dialog 开关 + 转译草稿桥)
//
// 设计:
//   - 单一 store 管理 LLM Dialog 的开关状态
//   - 视图通过 onaiGenerateDraft / onaiExplainRule / onaiGenerateInput /
//     onaiTranspileCommand 回调打开
//   - Dialog 内部通过 closeAssistantDialog() 关闭
//   - 转译草稿桥(L2 P2):TranspileCommandDialog 产物 → pendingInstructionDraft
//     → 执行台页面透传 aiDraft prop → ExecutionPad 填入 textarea 后回调清空。
//     内核只见 string prop + callback,不感知大众版 store(边界不破)
//
// 与内核边界:
//   - 本 store 是大众版独有,内核不感知
//   - 内核只调 callback,大众版在 callback 里 openAssistantDialog('draft' | 'explain' | 'input' | 'transpile')

import { writable } from 'svelte/store';

/** Dialog 类型(对应各用途;transpile = L2 P2 命令转译器) */
export type AssistantDialogType = 'draft' | 'explain' | 'input' | 'transpile';

/** 当前打开的 Dialog(只允许同时开一个;null 表示全关) */
export const activeAssistantDialog = writable<AssistantDialogType | null>(null);

/**
 * 待填入执行台 textarea 的命令草稿(L2 P2 转译桥)。
 * null = 无待填草稿;TranspileCommandDialog「填入执行台」时写入,
 * ExecutionPad 消费后由页面回调清空(一次性信箱语义)。
 */
export const pendingInstructionDraft = writable<string | null>(null);

/** 打开指定 Dialog(若已打开其他 Dialog,先关闭) */
export function openAssistantDialog(type: AssistantDialogType): void {
	activeAssistantDialog.set(type);
}

/** 关闭当前 Dialog(无论哪个) */
export function closeAssistantDialog(): void {
	activeAssistantDialog.set(null);
}

/** 执行台消费草稿后清空信箱(由页面经 onaiDraftConsumed 回调触发) */
export function clearPendingInstructionDraft(): void {
	pendingInstructionDraft.set(null);
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
