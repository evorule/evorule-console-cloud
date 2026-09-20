// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// $app/navigation 测试替身(仅 vitest 生效,见 vite.config.ts)。
// browser condition 下 kit 的 navigation 解析到 client 运行时,import 期即触碰
// window(无头 node 单测必崩);本替身提供 no-op 面,行为断言由组件/e2e 层覆盖。

export async function goto(): Promise<unknown> {
	return null;
}
export async function invalidate(): Promise<unknown> {
	return null;
}
export async function invalidateAll(): Promise<unknown> {
	return null;
}
export async function preloadData(): Promise<unknown> {
	return null;
}
export async function preloadCode(): Promise<unknown> {
	return null;
}
export function beforeNavigate(): void {}
export function afterNavigate(): void {}
export function onNavigate(): void {}
export function disableScrollHandling(): void {}
