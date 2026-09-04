// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P09 marketplace 单测 — 搜索/筛选/上传/下载/删除
//
// 运行: npx vitest run src/lib/stores/__tests__\marketplace.test.ts
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";
import {
	marketplaceTemplates,
	marketplaceError,
	marketplaceLoading,
	filteredTemplates,
	searchQuery,
	filterType,
	filterCategory,
	filterSource,
	loadMarketplace,
	uploadTemplate,
	downloadTemplate,
	deleteTemplate,
	getTemplateById,
	getTemplatesByType,
	getTemplatesByCategory,
	getOfficialTemplates,
	resetMarketplace,
} from "../marketplace";
import type { MarketTemplate } from "../import-export-types";

// ============================================================================
// 准备:每次测试前重置 + fetch mock
// ============================================================================

// W4 接线后 user 模板 CRUD 走 server `/api/marketplace/templates` 端点族,
// node 测试环境无 server → 统一 stub fetch 验证契约(请求形状 + 响应处理)
const fetchMock = vi.fn();

beforeEach(() => {
	resetMarketplace();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

/** server 上传响应用完整模板(id/source/计数/时间戳由 server 生成) */
function serverTemplate(overrides: Partial<MarketTemplate> = {}): MarketTemplate {
	return {
		id: "srv-tpl-1",
		type: "rule",
		name: "server 模板",
		description: "server 生成",
		category: "general",
		tags: [],
		author: { id: "server", displayName: "server" },
		version: "1.0.0",
		format: "json",
		content_hash: "srv-hash",
		source: "user",
		download_url: "/api/marketplace/templates/srv-tpl-1/download",
		download_count: 0,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** 上传用客户端入参(Omit server 生成字段) */
function uploadPayload(name = "我的规则") {
	return {
		type: "rule" as const,
		name,
		description: "测试上传",
		category: "general" as const,
		tags: ["test"],
		author: { id: "self", displayName: "我" },
		version: "1.0.0",
		format: "json" as const,
		content_hash: "test-hash",
		download_url: "user://ignored",
	};
}

// ============================================================================
// 1. builtin 模板加载
// ============================================================================

describe("P09 marketplace builtin 模板", () => {
	test("初始化加载 10 个 builtin + official 模板", () => {
		const list = get(marketplaceTemplates);
		// 9 builtin + 1 official = 10
		expect(list.length).toBeGreaterThanOrEqual(10);
	});

	test("含 1 个 official 模板(DJBH 2.0)", () => {
		const official = getOfficialTemplates();
		expect(official).toHaveLength(1);
		expect(official[0].source).toBe("official");
		expect(official[0].id).toContain("djbh");
	});

	test("含 4 种对象类型", () => {
		const types = new Set(get(marketplaceTemplates).map((t) => t.type));
		expect(types.has("rule")).toBe(true);
		expect(types.has("dataset")).toBe(true);
		expect(types.has("form")).toBe(true);
		expect(types.has("library_schema")).toBe(true);
	});

	test("含 3 种分类(medical/finance/compliance)", () => {
		const cats = new Set(get(marketplaceTemplates).map((t) => t.category));
		expect(cats.has("medical")).toBe(true);
		expect(cats.has("finance")).toBe(true);
		expect(cats.has("compliance")).toBe(true);
	});
});

// ============================================================================
// 2. 搜索
// ============================================================================

describe("P09 marketplace 搜索", () => {
	test("按名称搜索", () => {
		searchQuery.set("医院");
		const list = get(filteredTemplates);
		expect(list.length).toBeGreaterThan(0);
		for (const t of list) {
			expect(t.name.includes("医院") || t.description.includes("医院")).toBe(true);
		}
	});

	test("按描述搜索", () => {
		searchQuery.set("等保");
		const list = get(filteredTemplates);
		expect(list.length).toBeGreaterThan(0);
	});

	test("按标签搜索", () => {
		searchQuery.set("djbh");
		const list = get(filteredTemplates);
		expect(list.length).toBeGreaterThan(0);
	});

	test("无匹配返回空", () => {
		searchQuery.set("不存在的关键字xyz123");
		const list = get(filteredTemplates);
		expect(list).toHaveLength(0);
	});

	test("搜索不区分大小写", () => {
		searchQuery.set("DJbh");
		const list = get(filteredTemplates);
		expect(list.length).toBeGreaterThan(0);
	});
});

// ============================================================================
// 3. 筛选
// ============================================================================

describe("P09 marketplace 筛选", () => {
	test("按类型筛选(rule)", () => {
		filterType.set("rule");
		const list = get(filteredTemplates);
		for (const t of list) {
			expect(t.type).toBe("rule");
		}
	});

	test("按类型筛选(dataset)", () => {
		filterType.set("dataset");
		const list = get(filteredTemplates);
		for (const t of list) {
			expect(t.type).toBe("dataset");
		}
	});

	test("按分类筛选(medical)", () => {
		filterCategory.set("medical");
		const list = get(filteredTemplates);
		for (const t of list) {
			expect(t.category).toBe("medical");
		}
	});

	test("按来源筛选(official)", () => {
		filterSource.set("official");
		const list = get(filteredTemplates);
		expect(list).toHaveLength(1);
		expect(list[0].source).toBe("official");
	});

	test("组合筛选(type + category)", () => {
		filterType.set("rule");
		filterCategory.set("compliance");
		const list = get(filteredTemplates);
		for (const t of list) {
			expect(t.type).toBe("rule");
			expect(t.category).toBe("compliance");
		}
	});

	test("all 不过滤", () => {
		filterType.set("all");
		filterCategory.set("all");
		filterSource.set("all");
		const list = get(filteredTemplates);
		expect(list.length).toBeGreaterThanOrEqual(10);
	});
});

// ============================================================================
// 4. 上传 + 删除
// ============================================================================

describe("P09 marketplace 上传 + 删除", () => {
	test("上传 user 模板,出现在 store 中(multipart POST,server 生成 id/source)", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, template: serverTemplate({ name: "我的规则" }) }),
		);
		const result = await uploadTemplate(uploadPayload(), new Blob(["test content"]));

		expect(result.success).toBe(true);
		// 请求形状:multipart POST 到 /api/marketplace/templates
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/marketplace/templates");
		expect(init.method).toBe("POST");
		expect(init.body).toBeInstanceOf(FormData);

		const list = get(marketplaceTemplates);
		const userTemplates = list.filter((t) => t.source === "user");
		expect(userTemplates).toHaveLength(1);
		expect(userTemplates[0].name).toBe("我的规则");
		expect(userTemplates[0].id).toBe("srv-tpl-1");
	});

	test("上传失败显式暴露 server 指引(拒绝静默成功)", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ message: "缺少 content 字段" }, 400));
		const result = await uploadTemplate(uploadPayload("bad"), new Blob([""]));

		expect(result.success).toBe(false);
		expect(result.error).toContain("缺少 content 字段");
		expect(get(marketplaceTemplates).filter((t) => t.source === "user")).toHaveLength(0);
	});

	test("上传后 source = user", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, template: serverTemplate({ name: "test" }) }),
		);
		await uploadTemplate(uploadPayload("test"), new Blob([""]));

		const userTpl = get(marketplaceTemplates).find((t) => t.name === "test");
		expect(userTpl?.source).toBe("user");
	});

	test("deleteTemplate 删除 user 模板(DELETE :id)", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ success: true, template: serverTemplate({ name: "待删除" }) }),
		);
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
		const result = await uploadTemplate(uploadPayload("待删除"), new Blob([""]));
		expect(result.success).toBe(true);

		const userTpl = get(marketplaceTemplates).find((t) => t.name === "待删除");
		expect(userTpl).toBeDefined();

		await deleteTemplate(userTpl!.id);

		expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/marketplace/templates/srv-tpl-1");
		expect(get(marketplaceTemplates).find((t) => t.id === userTpl!.id)).toBeUndefined();
	});

	test("deleteTemplate 拒绝删 builtin 模板(显式报错,不静默)", async () => {
		const builtin = get(marketplaceTemplates).find((t) => t.source !== "user");
		expect(builtin).toBeDefined();
		await expect(deleteTemplate(builtin!.id)).rejects.toThrow("不可删除");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

// ============================================================================
// 5. 下载
// ============================================================================

describe("P09 marketplace 下载", () => {
	test("builtin 模板本地下载 + 计数 +1(不经 server)", async () => {
		const tpl = get(marketplaceTemplates).find((t) => t.source !== "user")!;
		const beforeCount = tpl.download_count;

		const blob = await downloadTemplate(tpl.id);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.size).toBeGreaterThan(0);
		const updated = get(marketplaceTemplates).find((t) => t.id === tpl.id);
		expect(updated?.download_count).toBe(beforeCount + 1);
	});

	test("user 模板走 server 下载 + 本地镜像计数 +1", async () => {
		// 先上传使模板进入 store(下载只对 store 中存在的模板发起)
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ success: true, template: serverTemplate({ download_count: 5 }) }),
		);
		const up = await uploadTemplate(uploadPayload(), new Blob([""]));
		expect(up.success).toBe(true);

		fetchMock.mockResolvedValueOnce(new Response(new Blob(["tpl content"]), { status: 200 }));
		const blob = await downloadTemplate("srv-tpl-1");

		expect(await blob.text()).toBe("tpl content");
		expect(fetchMock.mock.calls[1]?.[0]).toContain("/api/marketplace/templates/srv-tpl-1/download");
		const updated = get(marketplaceTemplates).find((t) => t.id === "srv-tpl-1");
		expect(updated?.download_count).toBe(6);
	});

	test("user 模板下载失败 throw(拒绝静默空 Blob)", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ message: "模板不存在" }, 404));
		await expect(downloadTemplate("srv-missing")).rejects.toThrow("模板不存在");
	});

	test("downloadTemplate 不存在 ID 显式报错(拒绝静默空 Blob)", async () => {
		await expect(downloadTemplate("nonexistent")).rejects.toThrow("模板不存在");
	});
});

// ============================================================================
// 6. 查询辅助函数
// ============================================================================

describe("P09 marketplace 查询", () => {
	test("getTemplateById 找到 builtin", () => {
		const list = get(marketplaceTemplates);
		const first = list[0];
		const found = getTemplateById(first.id);
		expect(found).toBeDefined();
		expect(found?.id).toBe(first.id);
	});

	test("getTemplateById 不存在返回 undefined", () => {
		expect(getTemplateById("nonexistent")).toBeUndefined();
	});

	test("getTemplatesByType 返回正确类型", () => {
		const rules = getTemplatesByType("rule");
		for (const t of rules) {
			expect(t.type).toBe("rule");
		}
	});

	test("getTemplatesByCategory 返回正确分类", () => {
		const medical = getTemplatesByCategory("medical");
		for (const t of medical) {
			expect(t.category).toBe("medical");
		}
	});

	test("getOfficialTemplates 只返回 official", () => {
		const official = getOfficialTemplates();
		for (const t of official) {
			expect(t.source).toBe("official");
		}
	});
});

// ============================================================================
// 7. loadMarketplace(模拟网络)
// ============================================================================

describe("P09 loadMarketplace", () => {
	test("加载成功:server user 模板合入 + 无错误", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({ success: true, templates: [serverTemplate()] }),
		);
		await loadMarketplace();

		expect(get(marketplaceError)).toBeNull();
		const list = get(marketplaceTemplates);
		expect(list.length).toBeGreaterThanOrEqual(10);
		expect(list.find((t) => t.id === "srv-tpl-1")).toBeDefined();
		expect(get(marketplaceLoading)).toBe(false);
	});

	test("加载失败:显式降级为仅 builtin,错误原文上屏(拒绝静默)", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ message: "数据库不可用" }, 500));
		await loadMarketplace();

		const err = get(marketplaceError);
		expect(err).toContain("数据库不可用");
		expect(err).toContain("已降级为仅内置模板");
		const list = get(marketplaceTemplates);
		expect(list.every((t) => t.source !== "user")).toBe(true);
		expect(list.length).toBeGreaterThanOrEqual(10);
	});

	test("加载响应形态异常(缺 templates 数组)显式报错", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ success: true }));
		await loadMarketplace();

		expect(get(marketplaceError)).toContain("缺 templates 数组");
	});
});
