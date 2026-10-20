// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 后端形态单一判定源。
//
// 解析优先级(与根布局注入时序一致,自 +layout.svelte 收敛至此):
//   ① ?backend=wasm|http|mock  ② ?mock=1(兼容旧参,等价 mock)
//   ③ 构建默认 VITE_DEFAULT_BACKEND(CI 在线 demo 置 wasm;本地 dev 不设 → http)
//
// 消费方:
//   - 根布局 backend 注入(原内联解析改引本模块,单一来源)
//   - 连接状态显示面(顶栏徽标/工作台状态条/决策者空态):
//     mock 态不声称「evorule-server 已连接」,如实标「演示数据」,
//     消除同屏「已连接 vs 未连接」的双语义矛盾(o10)。

import { browser } from "$app/environment";

export type BackendKind = "http" | "wasm" | "mock";

function resolve(): BackendKind {
	// 构建期默认值:CI 通过 VITE_DEFAULT_BACKEND=wasm 让在线 demo 打开 URL 即进
	// WASM 模式;本地 dev 不设该变量 → 回落 http。仅 Vite 的 VITE_ 前缀变量入 bundle。
	const buildDefault =
		(import.meta.env.VITE_DEFAULT_BACKEND as string | undefined) ?? "http";
	const kind =
		buildDefault === "wasm" || buildDefault === "http" || buildDefault === "mock"
			? buildDefault
			: "http";
	if (!browser) return kind;
	const sp = new URLSearchParams(window.location.search);
	const q = sp.get("backend");
	if (q === "wasm" || q === "http" || q === "mock") return q;
	if (sp.get("mock") === "1") return "mock";
	return kind;
}

/** 本次会话的后端形态(模块加载时解析一次,与布局注入同源同时机) */
export const BACKEND_KIND: BackendKind = resolve();

export const IS_MOCK = BACKEND_KIND === "mock";
export const IS_WASM = BACKEND_KIND === "wasm";
