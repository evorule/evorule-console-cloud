// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
/**
 * 插件类目 store 契约测试（stub fetch 验证请求形态/降级纪律/下载计数乐观同步；
 * 惯例对齐 __tests__/marketplace.test.ts）
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	marketplacePlugins,
	pluginsError,
	loadPlugins,
	downloadPluginPart,
} from "../marketplace-plugins";

vi.mock("$lib/config/net-config", () => ({
	netConfig: {
		subscribe: (fn: (v: unknown) => void) => {
			fn({ mode: "offline", authToken: "" });
			return () => {};
		},
	},
}));
vi.mock("$lib/backend/types", () => ({
	DEFAULT_LOCAL_BASE_URL: "http://localhost:18080",
}));
vi.mock("$lib/stores/toast", () => ({
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

function okResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
	marketplacePlugins.set([]);
	pluginsError.set(null);
});

describe("loadPlugins", () => {
	it("正常响应填充列表", async () => {
		const stub = vi.fn().mockResolvedValue(
			okResponse({
				success: true,
				count: 1,
				plugins: [
					{
						id: "demo",
						name: "demo",
						has_signature: true,
						integrity_mismatch: false,
						content_hash: "abc",
						purity: "zero-import",
					},
				],
			}),
		);
		vi.stubGlobal("fetch", stub);
		await loadPlugins();
		const list = $marketplacePluginsSnapshot();
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe("demo");
		// 请求打在正确端点
		expect(stub.mock.calls[0][0]).toBe("http://localhost:18080/api/marketplace/plugins");
	});

	it("非 2xx 显式降级（错误原文上屏，不静默）", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ message: "存储扫描失败" }), { status: 500 }),
			),
		);
		await loadPlugins();
		expect(pluginsErrorStoreSnapshot()).toContain("存储扫描失败");
	});

	it("plugins 非数组判形态异常", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ plugins: "bad" })));
		await loadPlugins();
		expect(pluginsErrorStoreSnapshot()).toContain("形态异常");
	});
});

describe("downloadPluginPart", () => {
	it("按 part 拼下载端点并乐观计数", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
		);
		marketplacePlugins.set([
			{
				id: "demo",
				name: "demo",
				has_signature: true,
				integrity_mismatch: false,
				content_hash: "abc",
				download_count: 4,
			},
		]);
		const blob = await downloadPluginPart("demo", "manifest");
		expect(blob.size).toBe(3);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
			"http://localhost:18080/api/marketplace/plugins/demo/download?part=manifest",
		);
		expect(
			marketplacePluginsSnapshot().find((p) => p.id === "demo")?.download_count,
		).toBe(5);
	});
});

// writable 读取辅助（测试内解构 store 快照）
import { get } from "svelte/store";
function marketplacePluginsSnapshot() {
	return get(marketplacePlugins);
}
function pluginsErrorStoreSnapshot() {
	return get(pluginsError);
}
function $marketplacePluginsSnapshot() {
	return get(marketplacePlugins);
}
