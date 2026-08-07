// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §7 模板市场 store — builtin + 用户上传 + 搜索/筛选。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §7 定义。
//
// 设计:
//   - P0 mock:builtin 模板硬编码 + 用户上传存 localStorage
//   - P1 接真实后端:/api/marketplace/templates
//   - filteredTemplates:derived,按 type/category/搜索词过滤
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7

import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import {
	type MarketTemplate,
	type ObjectType,
	type TemplateCategory,
	type TemplateSource,
} from "./import-export-types";
import { BUILTIN_MARKET_TEMPLATES } from "$lib/data/market-template-samples";

// ============================================================================
// 1. Store 定义
// ============================================================================

const USER_TEMPLATES_KEY = "evorule-console-cloud:marketplace:user-templates";

function loadUserTemplates(): MarketTemplate[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(USER_TEMPLATES_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? (parsed as MarketTemplate[]) : [];
	} catch {
		return [];
	}
}

/** 全部模板(builtin + user 上传,official 来自 builtin 数据) */
export const marketplaceTemplates = writable<MarketTemplate[]>([
	...BUILTIN_MARKET_TEMPLATES,
	...loadUserTemplates(),
]);

/** 用户上传的模板(单独 store,便于管理) */
const userTemplatesStore = writable<MarketTemplate[]>(loadUserTemplates());

userTemplatesStore.subscribe((templates) => {
	// 持久化仅浏览器环境
	if (browser) {
		localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(templates));
	}
	// 同步到主 store(无论浏览器/Node,保证 store 一致性)
	marketplaceTemplates.set([...BUILTIN_MARKET_TEMPLATES, ...templates]);
});

export const marketplaceLoading = writable<boolean>(false);
export const marketplaceError = writable<string | null>(null);

// ============================================================================
// 2. 筛选 store
// ============================================================================

export const searchQuery = writable<string>("");
export const filterType = writable<ObjectType | "all">("all");
export const filterCategory = writable<TemplateCategory | "all">("all");
export const filterSource = writable<TemplateSource | "all">("all");

/** 过滤后的模板(derived) */
export const filteredTemplates = derived(
	[marketplaceTemplates, searchQuery, filterType, filterCategory, filterSource],
	([$templates, $query, $type, $category, $source]) => {
		const q = $query.trim().toLowerCase();
		return $templates.filter((t) => {
			if ($type !== "all" && t.type !== $type) return false;
			if ($category !== "all" && t.category !== $category) return false;
			if ($source !== "all" && t.source !== $source) return false;
			if (q) {
				const haystack =
					`${t.name} ${t.description} ${t.tags.join(" ")} ${t.author.displayName}`.toLowerCase();
				if (!haystack.includes(q)) return false;
			}
			return true;
		});
	},
);

// ============================================================================
// 3. CRUD
// ============================================================================

/**
 * 加载市场模板(P0 mock:builtin + localStorage,无网络请求)。
 * P1 改为 fetch GET /api/marketplace/templates。
 */
export async function loadMarketplace(): Promise<void> {
	marketplaceLoading.set(true);
	marketplaceError.set(null);
	try {
		// P0:模拟网络延迟
		await new Promise((r) => setTimeout(r, 100));
		const userTemplates = get(userTemplatesStore);
		marketplaceTemplates.set([
			...BUILTIN_MARKET_TEMPLATES,
			...userTemplates,
		]);
	} catch (e) {
		marketplaceError.set(e instanceof Error ? e.message : String(e));
	} finally {
		marketplaceLoading.set(false);
	}
}

/**
 * 上传模板(P0 mock:存 localStorage)。
 * P1 改为 multipart POST /api/marketplace/templates。
 *
 * @param template 模板元数据(不含 id/download_count/created_at/updated_at/source)
 * @param content 模板内容 Blob(P0 不实际存储内容,只记录元数据)
 */
export async function uploadTemplate(
	template: Omit<
		MarketTemplate,
		| "id"
		| "download_count"
		| "created_at"
		| "updated_at"
		| "source"
	>,
	_content: Blob,
): Promise<{ success: boolean; error?: string }> {
	try {
		const now = new Date().toISOString();
		const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const newTemplate: MarketTemplate = {
			...template,
			id,
			download_count: 0,
			created_at: now,
			updated_at: now,
			source: "user",
			// P0 mock download_url 用 blob: 占位
			download_url: `blob:mock/${id}`,
		};
		userTemplatesStore.update((list) => [newTemplate, ...list]);
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * 下载模板(P0 mock:返回空 Blob,实际内容由调用方从 export 接口取)。
 * P1 改为 fetch GET /api/marketplace/templates/:id/download。
 *
 * @param templateId 模板 ID
 */
export async function downloadTemplate(templateId: string): Promise<Blob> {
	// 增加下载计数
	const all = get(marketplaceTemplates);
	const template = all.find((t) => t.id === templateId);
	if (template) {
		const updated = { ...template, download_count: template.download_count + 1 };
		if (template.source === "user") {
			userTemplatesStore.update((list) =>
				list.map((t) => (t.id === templateId ? updated : t)),
			);
		} else {
			// builtin 也更新计数(只更新主 store,不持久化)
			marketplaceTemplates.update((list) =>
				list.map((t) => (t.id === templateId ? updated : t)),
			);
		}
	}
	// P0:返回模板元数据 JSON 作为占位
	return new Blob([JSON.stringify(template, null, 2)], {
		type: "application/json",
	});
}

/**
 * 删除模板(仅能删 user 上传的)。
 * P1 改为 DELETE /api/marketplace/templates/:id。
 */
export async function deleteTemplate(templateId: string): Promise<void> {
	userTemplatesStore.update((list) =>
		list.filter((t) => t.id !== templateId),
	);
}

// ============================================================================
// 4. 查询
// ============================================================================

/** 按 ID 获取模板 */
export function getTemplateById(id: string): MarketTemplate | undefined {
	return get(marketplaceTemplates).find((t) => t.id === id);
}

/** 列出某类型的全部模板 */
export function getTemplatesByType(type: ObjectType): MarketTemplate[] {
	return get(marketplaceTemplates).filter((t) => t.type === type);
}

/** 列出某分类的全部模板 */
export function getTemplatesByCategory(
	category: TemplateCategory,
): MarketTemplate[] {
	return get(marketplaceTemplates).filter((t) => t.category === category);
}

/** 列出官方规则集(source=official) */
export function getOfficialTemplates(): MarketTemplate[] {
	return get(marketplaceTemplates).filter((t) => t.source === "official");
}

/** 重置(测试用) */
export function resetMarketplace(): void {
	userTemplatesStore.set([]);
	searchQuery.set("");
	filterType.set("all");
	filterCategory.set("all");
	filterSource.set("all");
	marketplaceTemplates.set([...BUILTIN_MARKET_TEMPLATES]);
}
