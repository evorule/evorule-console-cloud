// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// UV-085 ④ — HttpBackend.health() 布尔语义回归锚定
//
// 运行: npx vitest run src/lib/kernel/backend/__tests__/http-backend-health.test.ts
//
// 背景:health 此前无单测;UV-085 ④ 调试期间顺带锚定语义——health 是探测
// 不是命令,失败即"不健康"(false),不抛错、不静默通过。噪音修复本体在
// +layout.svelte(延迟 500ms 错开水合窗口,组件层不在此测)。

import { describe, test, expect, vi, afterEach } from "vitest";
import { HttpBackend } from "../http-backend";

const BASE = "http://127.0.0.1:18080";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("UV-085 ④ HttpBackend.health — 请求形态与布尔语义", () => {
	test("请求形态:GET /api/health + Bearer", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("ok", { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const backend = new HttpBackend(BASE, "tok-1");
		const ok = await backend.health();

		expect(ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			RequestInit | undefined,
		];
		expect(url).toBe(`${BASE}/api/health`);
		expect(init?.method).toBeUndefined(); // 默认 GET,不显式覆写
		expect((init?.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok-1",
		);
	});

	test("signal 透传给 fetch(UV-085 ④:pagehide 主动中止的接线前提)", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("ok", { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const controller = new AbortController();
		const backend = new HttpBackend(BASE);
		await backend.health(controller.signal);

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.signal).toBe(controller.signal);
	});

	test("503 → false(不健康,不抛错)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
		);
		const backend = new HttpBackend(BASE);
		await expect(backend.health()).resolves.toBe(false);
	});

	test("网络异常 → false(探测失败即不健康,不抛错)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
		);
		const backend = new HttpBackend(BASE);
		await expect(backend.health()).resolves.toBe(false);
	});
});
