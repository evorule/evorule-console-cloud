// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 首页模式 store。
// - 'auto':根据 sessionStore + dbStore 自动选 A/B/C
// - 'force-demo':强制 A(覆盖自动判断)
// - wizardInProgress:建库向导进行中时,即使 isEmptyDb=false(模板已加载规则)
//   也保持在状态 B(OnboardingWizard),避免 HomeRouter 提前切到状态 C
//
// 持久化:不持久化(刷新后回到 auto,符合"真实优先"原则)

import { writable } from "svelte/store";

export type HomeMode = "auto" | "force-demo";

export const homeModeStore = writable<HomeMode>("auto");

/**
 * 建库向导进行中标志(T2 新增)。
 *
 * 设计动机:
 *   - 模板在 Step 2 调用 loadTemplate 会向内核 rules store 加 builtin 规则,
 *     导致派生 isEmptyDb 变 false
 *   - 若不覆盖,HomeRouter 会立即从状态 B(向导)切到状态 C(工作台),
 *     向导流程被中断
 *   - wizardInProgress=true 时,HomeRouter 忽略 isEmptyDb,保持在状态 B
 *
 * 生命周期:
 *   - OnboardingWizard 挂载时 set true
 *   - 向导完成(Step 5)/ 取消时 set false
 */
export const wizardInProgress = writable<boolean>(false);

// === 便捷更新函数 ===

export function forceDemo(): void {
  homeModeStore.set("force-demo");
}

export function autoMode(): void {
  homeModeStore.set("auto");
}

export function toggleHomeMode(): void {
  homeModeStore.update((m) => (m === "auto" ? "force-demo" : "auto"));
}

export function setWizardInProgress(v: boolean): void {
  wizardInProgress.set(v);
}
