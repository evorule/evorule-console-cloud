// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 后端模式检测:判定收敛至 backend-kind 单一来源(原各自解析 URL 参数,
// 与根布局注入逻辑三处同构易漂移)。本模块仅保留视图层消费的便捷谓词。

import { IS_WASM } from "./backend-kind";

/** 当前是否以 WASM 后端模式运行(视图层渲染分派用,不参与 backend 构造) */
export function isWasmBackendMode(): boolean {
	return IS_WASM;
}
