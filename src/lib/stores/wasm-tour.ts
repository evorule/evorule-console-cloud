// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WASM 在线模式 7 步引导进度 store。
//
// 与 demo 引导任务(guided-task-progress.ts)分开存储:
//   - demo 4 任务走 startTaskFlow 多步向导,GuidedTaskId 联合类型被 task-flow.ts 引用。
//   - WASM 7 步是 ?backend=wasm 下的独立在线体验序列,完成判定来自 WASM backend 返回。
// 分开键 / 分开 store,互不影响 HTTP 默认行为。
//
// 持久化:localStorage(key: evorule-console-cloud:wasm-tour-progress)
//   形状:{ [stepId]: completedAtISO }。

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";
import {
	WASM_TOUR_STEPS,
	type WasmTourStepId,
} from "$lib/data/guided-tasks";

const STORAGE_KEY = "evorule-console-cloud:wasm-tour-progress";

/** stepId → 完成时间(ISO);未完成的步骤不在表里 */
export type WasmTourProgress = Partial<Record<WasmTourStepId, string>>;

function loadProgress(): WasmTourProgress {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as WasmTourProgress) : {};
	} catch {
		return {};
	}
}

export const wasmTourProgressStore = writable<WasmTourProgress>(loadProgress());

if (browser) {
	wasmTourProgressStore.subscribe((progress) => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
		} catch {
			/* 存储不可用(隐私模式)时静默,进度仅存内存 */
		}
	});
}

/** 标记某步完成(幂等) */
export function markWasmTourStepComplete(id: WasmTourStepId): void {
	wasmTourProgressStore.update((p) => {
		if (p[id]) return p; // 已完成不覆盖时间
		return { ...p, [id]: new Date().toISOString() };
	});
}

/** 某步是否已完成 */
export function isWasmTourStepDone(id: WasmTourStepId): boolean {
	return Boolean(get(wasmTourProgressStore)[id]);
}

/** 已完成步数 */
export function completedWasmTourCount(): number {
	const p = get(wasmTourProgressStore);
	return WASM_TOUR_STEPS.filter((s) => p[s.id]).length;
}

/** 7 步是否全部完成 */
export function isWasmTourComplete(): boolean {
	return completedWasmTourCount() === WASM_TOUR_STEPS.length;
}

/** 重置进度(设置 → 新手引导 / 重试用) */
export function resetWasmTourProgress(): void {
	wasmTourProgressStore.set({});
}
