// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 后端模式检测:与 +layout.svelte 中 `?backend=wasm|http|mock` 的解析保持一致。
// 仅用于前端视图决定渲染哪套引导(WASM 7 步 vs demo 4 任务),不参与 backend 构造。

import { browser } from "$app/environment";

/** 当前是否以 ?backend=wasm 在线 WASM 模式运行 */
export function isWasmBackendMode(): boolean {
	if (!browser) return false;
	try {
		return new URLSearchParams(window.location.search).get("backend") === "wasm";
	} catch {
		return false;
	}
}
