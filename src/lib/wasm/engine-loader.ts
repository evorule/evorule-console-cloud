// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// WASM 引擎加载器 —— 封装 wasm-pack 产物的初始化与引擎实例创建。
//
// 设计要点:
//   - 浏览器端 only(adapter-static 无 SSR,但仍做防御性 typeof window 检查)。
//   - 单例初始化:整个应用只 init 一次 wasm 模块;EvoRuleEngine 实例按会话创建。
//   - 子路径 base:用 `?url` 导入 .wasm,Vite 会产出带 base 前缀的资源 URL,
//     显式传给 init(),避免 GitHub Pages `/evorule-console-cloud/` 下相对定位 404。
//   - 本模块仅在 ?backend=wasm 时由 +layout.svelte 动态 import,
//     不污染 http/mock 首屏(见 73 文档 §4.2)。

import wasmUrl from "./evorule_wasm_demo_bg.wasm?url";
import type { EvoRuleEngine as EvoRuleEngineT } from "./evorule_wasm_demo";

type WasmModule = typeof import("./evorule_wasm_demo.js");

let initPromise: Promise<WasmModule> | null = null;

/**
 * 初始化 wasm 模块(幂等单例)。重复调用返回同一个 promise。
 * 浏览器外调用抛错(防御性;adapter-static 构建时此模块不被触达)。
 */
export function loadWasm(): Promise<WasmModule> {
	if (initPromise) return initPromise;

	initPromise = (async () => {
		if (typeof window === "undefined") {
			throw new Error("EvoRule WASM 仅在浏览器端可用");
		}
		const mod = await import("./evorule_wasm_demo.js");
		// 显式传入带 base 前缀的 .wasm URL(子路径部署关键)
		await mod.default(wasmUrl);
		return mod;
	})().catch((e) => {
		// 失败时重置单例,允许重试
		initPromise = null;
		throw e;
	});

	return initPromise;
}

/**
 * 创建一个全新的 EvoRuleEngine 实例(空 ruleset、空 payload/audit)。
 * 每个会话持有独立实例,会话间状态完全隔离。
 */
export async function createEngine(): Promise<EvoRuleEngineT> {
	const mod = await loadWasm();
	return new mod.EvoRuleEngine();
}

export type { EvoRuleEngineT as EvoRuleEngine };
