// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P09 marketplace 单测 — 搜索/筛选/上传/下载/删除
//
// 运行: npx vitest run src/lib/stores/__tests__\marketplace.test.ts
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7

import { describe, test, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
	marketplaceTemplates,
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
// 准备:每次测试前重置
// ============================================================================

beforeEach(() => {
	// node 环境 browser=false,localStorage 不可用;直接 reset store
	resetMarketplace();
});

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
	test("上传 user 模板,出现在 store 中", async () => {
		const result = await uploadTemplate(
			{
				type: "rule",
				name: "我的规则",
				description: "测试上传",
				category: "general",
				tags: ["test"],
				author: { id: "self", displayName: "我" },
				version: "1.0.0",
				format: "json",
				content_hash: "test-hash",
				download_url: "user://test",
			},
			new Blob(["test content"]),
		);
		expect(result.success).toBe(true);

		const list = get(marketplaceTemplates);
		const userTemplates = list.filter((t) => t.source === "user");
		expect(userTemplates).toHaveLength(1);
		expect(userTemplates[0].name).toBe("我的规则");
	});

	test("上传后 source = user", async () => {
		await uploadTemplate(
			{
				type: "rule",
				name: "test",
				description: "",
				category: "general",
				tags: [],
				author: { id: "self", displayName: "我" },
				version: "1.0.0",
				format: "json",
				content_hash: "x",
				download_url: "x",
			},
			new Blob([""]),
		);
		const list = get(marketplaceTemplates);
		const userTpl = list.find((t) => t.name === "test");
		expect(userTpl?.source).toBe("user");
	});

	test("deleteTemplate 只删 user 模板", async () => {
		const result = await uploadTemplate(
			{
				type: "rule",
				name: "待删除",
				description: "",
				category: "general",
				tags: [],
				author: { id: "self", displayName: "我" },
				version: "1.0.0",
				format: "json",
				content_hash: "x",
				download_url: "x",
			},
			new Blob([""]),
		);
		expect(result.success).toBe(true);

		const beforeList = get(marketplaceTemplates);
		const userTpl = beforeList.find((t) => t.name === "待删除");
		expect(userTpl).toBeDefined();

		await deleteTemplate(userTpl!.id);

		const afterList = get(marketplaceTemplates);
		expect(afterList.find((t) => t.id === userTpl!.id)).toBeUndefined();
	});
});

// ============================================================================
// 5. 下载
// ============================================================================

describe("P09 marketplace 下载", () => {
	test("downloadTemplate 返回 Blob + 增加下载计数", async () => {
		const beforeList = get(marketplaceTemplates);
		const tpl = beforeList[0];
		const beforeCount = tpl.download_count;

		const blob = await downloadTemplate(tpl.id);
		expect(blob).toBeInstanceOf(Blob);
		expect(blob.size).toBeGreaterThan(0);

		const afterList = get(marketplaceTemplates);
		const updated = afterList.find((t) => t.id === tpl.id);
		expect(updated?.download_count).toBe(beforeCount + 1);
	});

	test("downloadTemplate 不存在 ID 返回 Blob(空)", async () => {
		const blob = await downloadTemplate("nonexistent");
		expect(blob).toBeInstanceOf(Blob);
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
	test("loadMarketplace 加载成功", async () => {
		await loadMarketplace();
		const list = get(marketplaceTemplates);
		expect(list.length).toBeGreaterThanOrEqual(10);
	});
});
