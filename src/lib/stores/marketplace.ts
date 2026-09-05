// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §7 模板市场 store — builtin(本地) + 用户上传(server) + 搜索/筛选。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §7 定义;UV-084 W4 / UV-064 完成 P1 接线。
//
// 设计:
//   - official/builtin 模板:本地内置数据(BUILTIN_MARKET_TEMPLATES),不经 server
//   - user 上传模板:server `/api/marketplace/templates` 端点族为唯一真相源
//     (GET 列表 / multipart POST / GET :id/download / DELETE :id;P09 §7.1 P1 契约)
//   - localStorage 持久化已退役(P0 mock 遗留):user 模板由 server 落盘
//     `{marketplace_dir}/templates/{id}/`,浏览器侧仅保留内存镜像做乐观更新
//   - 鉴权:Bearer(netConfig.authToken,与 kernel HttpBackend 同源)
//   - 失败纪律:全部显式暴露(loadMarketplace 失败 → marketplaceError + 降级为
//     仅 builtin 可浏览;upload/delete 失败 → {success:false,error} / throw),
//     拒绝静默回落
//   - filteredTemplates:derived,按 type/category/搜索词过滤
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7

import { writable, derived, get } from "svelte/store";
import {
	type MarketTemplate,
	type ObjectType,
	type TemplateCategory,
	type TemplateSource,
} from "./import-export-types";
import { BUILTIN_MARKET_TEMPLATES } from "$lib/data/market-template-samples";
import { netConfig } from "$lib/config/net-config";
import { DEFAULT_LOCAL_BASE_URL } from "$lib/backend/types";

// ============================================================================
// 1. 请求基建(Bearer + base 解析,惯例对齐 audited-llm.ts)
// ============================================================================

function resolveApiBase(): string {
	const cfg = get(netConfig);
	return cfg.mode === "online" ? cfg.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
}

function authHeaders(): Record<string, string> {
	const token = get(netConfig).authToken;
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 从错误响应体提取 server 指引原文({message}),取不到用 HTTP 状态码 */
async function serverErrorMessage(res: Response, fallback: string): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? `${fallback}: HTTP ${res.status}`;
}

/** builtin/official 模板用私有协议 URL,不经 server 下载 */
function isLocalTemplate(t: MarketTemplate): boolean {
	return t.download_url.startsWith("builtin://") || t.download_url.startsWith("official://");
}

// ============================================================================
// 2. Store 定义
// ============================================================================

/** 用户上传模板(server 内存镜像,乐观更新;server 为唯一真相源) */
const userTemplatesStore = writable<MarketTemplate[]>([]);

/** 全部模板(builtin 本地 + user server 镜像) */
export const marketplaceTemplates = writable<MarketTemplate[]>([
	...BUILTIN_MARKET_TEMPLATES,
]);

function resyncMarketplace(): void {
	marketplaceTemplates.set([...BUILTIN_MARKET_TEMPLATES, ...get(userTemplatesStore)]);
}

export const marketplaceLoading = writable<boolean>(false);
export const marketplaceError = writable<string | null>(null);

// ============================================================================
// 3. 筛选 store
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
// 4. CRUD(P1:server 端点族)
// ============================================================================

/**
 * 加载市场模板:builtin(本地) + GET /api/marketplace/templates(用户上传)。
 *
 * 失败显式降级:marketplaceError 置错误原文,模板面降级为仅 builtin 可浏览
 * (不静默假装 user 模板为空)。
 */
export async function loadMarketplace(): Promise<void> {
	marketplaceLoading.set(true);
	marketplaceError.set(null);
	try {
		const res = await fetch(`${resolveApiBase()}/api/marketplace/templates`, {
			headers: authHeaders(),
		});
		if (!res.ok) {
			throw new Error(await serverErrorMessage(res, "加载模板市场失败"));
		}
		const data = (await res.json()) as {
			success?: boolean;
			templates?: MarketTemplate[];
		};
		if (!Array.isArray(data.templates)) {
			throw new Error("市场响应形态异常(缺 templates 数组)");
		}
		userTemplatesStore.set(data.templates);
		resyncMarketplace();
	} catch (e) {
		// 显式降级:保留 builtin 可浏览,错误原文上屏
		userTemplatesStore.set([]);
		resyncMarketplace();
		marketplaceError.set(
			`${e instanceof Error ? e.message : String(e)}(已降级为仅内置模板;请检查 evorule-server 是否可达)`,
		);
	} finally {
		marketplaceLoading.set(false);
	}
}

/**
 * 上传模板:multipart POST /api/marketplace/templates(meta JSON + content)。
 *
 * id/source/download_url/计数/时间戳由 server 生成(客户端提供的值不采信);
 * 成功后以 server 返回的完整模板做乐观前插。
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
	content: Blob,
): Promise<{ success: boolean; error?: string }> {
	try {
		const fd = new FormData();
		fd.append("meta", JSON.stringify(template));
		fd.append("content", content, "template-content.bin");

		const res = await fetch(`${resolveApiBase()}/api/marketplace/templates`, {
			method: "POST",
			headers: authHeaders(),
			body: fd,
		});
		if (!res.ok) {
			return { success: false, error: await serverErrorMessage(res, "上传失败") };
		}
		const data = (await res.json()) as { success?: boolean; template?: MarketTemplate };
		if (!data.template) {
			return { success: false, error: "上传响应形态异常(缺 template)" };
		}
		userTemplatesStore.update((list) => [data.template!, ...list]);
		resyncMarketplace();
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * 编辑模板(UV-087):multipart PATCH /api/marketplace/templates/:id。
 *
 * - meta(JSON,必填):普通字段整体替换(name/description/tags/version 等)
 * - content(可选):提供则替换内容并触发 server 重算 content_hash;缺省=保留原内容
 * - id/source/download_url/download_count/created_at 为 server 权威字段,
 *   客户端提供的值不采信(一律保留原值);updated_at 由 server 刷新
 * - 成功后以 server 返回的完整模板替换镜像对应项(不整表重拉,保持乐观更新模式)
 */
export async function updateTemplate(
	templateId: string,
	template: Omit<
		MarketTemplate,
		| "id"
		| "download_count"
		| "created_at"
		| "updated_at"
		| "source"
	>,
	content?: Blob,
): Promise<{ success: boolean; error?: string }> {
	try {
		const fd = new FormData();
		fd.append("meta", JSON.stringify(template));
		if (content) {
			fd.append("content", content, "template-content.bin");
		}

		const res = await fetch(
			`${resolveApiBase()}/api/marketplace/templates/${encodeURIComponent(templateId)}`,
			{ method: "PATCH", headers: authHeaders(), body: fd },
		);
		if (!res.ok) {
			return { success: false, error: await serverErrorMessage(res, "编辑失败") };
		}
		const data = (await res.json()) as { success?: boolean; template?: MarketTemplate };
		if (!data.template) {
			return { success: false, error: "编辑响应形态异常(缺 template)" };
		}
		// 以 server 返回的权威模板替换镜像项(双写:镜像 + 全量列表)
		userTemplatesStore.update((list) =>
			list.map((t) => (t.id === templateId ? data.template! : t)),
		);
		resyncMarketplace();
		return { success: true };
	} catch (e) {
		return {
			success: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/**
 * 下载模板:
 * - builtin/official(私有协议 URL)→ 本地返回模板元数据 JSON(P0 语义保留)
 * - user(server 模板)→ GET /api/marketplace/templates/:id/download,
 *   server 侧递增下载计数,本地镜像乐观同步
 *
 * 失败 throw(调用方呈现;拒绝静默返回空 Blob)。
 */
export async function downloadTemplate(templateId: string): Promise<Blob> {
	const template = get(marketplaceTemplates).find((t) => t.id === templateId);
	if (!template) {
		// 不存在 ID 显式报错(2026-09-05 静默通过清剿:旧形态静默返回 null 内容 Blob)
		throw new Error(`模板不存在: ${templateId}`);
	}

	// builtin/official:本地元数据 JSON(P0 语义,内容从导出接口取)
	if (isLocalTemplate(template)) {
		bumpLocalDownloadCount(templateId);
		return new Blob([JSON.stringify(template, null, 2)], {
			type: "application/json",
		});
	}

	const res = await fetch(
		`${resolveApiBase()}/api/marketplace/templates/${encodeURIComponent(templateId)}/download`,
		{ headers: authHeaders() },
	);
	if (!res.ok) {
		throw new Error(await serverErrorMessage(res, "下载失败"));
	}
	bumpLocalDownloadCount(templateId);
	return await res.blob();
}

/** 本地镜像的下载计数乐观同步(server 为权威,下次 load 收敛) */
function bumpLocalDownloadCount(templateId: string): void {
	// builtin/official 模板仅存在于全量列表,user 模板双写(镜像 + 全量列表);
	// 只 bump user 镜像会让 builtin 计数静默不生效(2026-09-05 修复)
	marketplaceTemplates.update((list) =>
		list.map((t) =>
			t.id === templateId ? { ...t, download_count: t.download_count + 1 } : t,
		),
	);
	userTemplatesStore.update((list) =>
		list.map((t) =>
			t.id === templateId ? { ...t, download_count: t.download_count + 1 } : t,
		),
	);
}

/**
 * 删除模板:DELETE /api/marketplace/templates/:id。
 *
 * builtin/official 模板不可删(显式报错——P0 静默 no-op 改为显式拒绝);
 * 失败 throw(含 server 指引原文)。
 */
export async function deleteTemplate(templateId: string): Promise<void> {
	const template = get(marketplaceTemplates).find((t) => t.id === templateId);
	if (template && isLocalTemplate(template)) {
		throw new Error("内置/官方模板不可删除");
	}

	const res = await fetch(
		`${resolveApiBase()}/api/marketplace/templates/${encodeURIComponent(templateId)}`,
		{ method: "DELETE", headers: authHeaders() },
	);
	if (!res.ok) {
		throw new Error(await serverErrorMessage(res, "删除失败"));
	}
	userTemplatesStore.update((list) => list.filter((t) => t.id !== templateId));
	resyncMarketplace();
}

// ============================================================================
// 5. 查询
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

/** 重置(测试用):清筛选 + user 镜像,恢复 builtin 基线 */
export function resetMarketplace(): void {
	userTemplatesStore.set([]);
	searchQuery.set("");
	filterType.set("all");
	filterCategory.set("all");
	filterSource.set("all");
	marketplaceTemplates.set([...BUILTIN_MARKET_TEMPLATES]);
	marketplaceError.set(null);
}
