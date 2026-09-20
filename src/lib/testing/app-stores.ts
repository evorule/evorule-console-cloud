// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// $app/stores 测试替身(仅 vitest 生效,见 vite.config.ts)。
// node 单测链路(official-assets/task-flow 等经 stores 引入 $app/*)在 browser
// condition 下会解析到 kit client 运行时(import 期触碰 window);本替身提供
// node/jsdom 皆安全的同形最小组件。page 组件级语义断言交由 e2e 层。
import { writable, type Readable } from 'svelte/store';

export const page: Readable<{
	url: URL;
	params: Record<string, string>;
	routeId: string | null;
	data: Record<string, unknown>;
	status: number;
	error: unknown;
	form: unknown;
	state: Record<string, unknown>;
}> = writable({
	url: new URL('http://localhost/'),
	params: {},
	routeId: null,
	data: {},
	status: 200,
	error: null,
	form: undefined,
	state: {}
});

export const navigating = writable<unknown>(null);

export const updated: Readable<boolean> & { check(): boolean } = {
	subscribe: writable(false).subscribe,
	check: () => false
};
