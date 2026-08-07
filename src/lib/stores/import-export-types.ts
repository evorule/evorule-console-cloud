// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 导入导出基础设施 — 类型定义。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §4 定义。
//
// 设计:
//   - UniversalExportPackage:单对象导出包(任意格式)
//   - BatchExportPackage:批量导出包(JSON manifest + 嵌入文件,P0 不用 ZIP)
//   - MarketTemplate:模板市场条目(snake_case,§4.3 权威定义)
//   - ImportConflict:4 策略冲突报告
//   - ImportSnapshot:导入前快照(可回滚)
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §4

import type { UniversalFormat } from "./format-converter";

// ============================================================================
// 1. 基础枚举
// ============================================================================

/** 4 类可导入导出对象(§4.1) */
export type ObjectType = "rule" | "dataset" | "form" | "library_schema";

/** 模板市场分类(§4.3) */
export type TemplateCategory =
	| "medical"
	| "finance"
	| "compliance"
	| "general"
	| "education"
	| "retail";

/** 冲突处理 4 策略(§3.5) */
export type ConflictResolution = "skip" | "overwrite" | "rename" | "merge";

/** 模板来源(§3.8 扩展为 3 值) */
export type TemplateSource = "builtin" | "user" | "official";

// ============================================================================
// 2. 通用导出包(单对象,§4.1)
// ============================================================================

/** 通用导出包(单对象) */
export interface UniversalExportPackage {
	meta: PackageMeta;
	objectType: ObjectType;
	/** 业务化数据 */
	data: unknown;
	/** 原始数据(可选,未业务化) */
	rawData?: unknown;
	/** 字段 schema(可选,CSV/XML 表头用) */
	fieldSchema?: FieldSchemaEntry[];
}

/** 包元数据(§4.1) */
export interface PackageMeta {
	manifest_version: "1.0";
	package_id: string;
	exported_at: string;
	exported_by: PackageOperator;
	source_instance: string;
	source_session_id?: number;
	object_type: ObjectType;
	object_count: number;
	format: UniversalFormat;
	content_hash: string;
	integrity?: {
		algorithm: "BLAKE3";
		contentHash: string;
		verified: boolean;
	};
}

/** 操作人信息 */
export interface PackageOperator {
	id: string;
	displayName: string;
	role: string;
}

/** 字段 schema 条目 */
export interface FieldSchemaEntry {
	key: string;
	label: string;
	type: "string" | "number" | "datetime" | "enum" | "boolean" | "json";
}

// ============================================================================
// 3. 批量导出包(§4.2)
// ============================================================================

/**
 * 批量导出包(P0 简化:JSON manifest + 嵌入文件 base64)。
 *
 * P0 不引入 ZIP 依赖,改用单 JSON 文件包裹 manifest + 多文件内容。
 * manifest.json 结构与设计文档 §3.4 一致,files 内嵌 base64 内容。
 * P1 升级为真正 ZIP 时,只需替换 packBatch/unpackBatch 实现。
 */
export interface BatchExportPackage {
	manifest: BatchManifest;
	files: BatchFileSpec[];
}

export interface BatchManifest {
	manifest_version: "1.0";
	exported_at: string;
	exported_by: PackageOperator;
	source_instance: string;
	contents: BatchContentEntry[];
	total_count: number;
	content_hash: string;
}

export interface BatchContentEntry {
	type: ObjectType;
	count: number;
	format: UniversalFormat | "mixed";
	dir: string;
}

export interface BatchFileSpec {
	path: string;
	/** base64 编码的内容(UTF-8 文本) */
	content_base64: string;
	objectType: ObjectType;
	objectId: string;
	format: UniversalFormat;
}

// ============================================================================
// 4. 模板市场条目(§4.3,snake_case 权威定义)
// ============================================================================

export interface MarketTemplate {
	id: string;
	type: ObjectType;
	name: string;
	description: string;
	category: TemplateCategory;
	industry?: string;
	tags: string[];
	author: { id: string; displayName: string };
	version: string;
	format: UniversalFormat;
	content_hash: string;
	download_url: string;
	download_count: number;
	created_at: string;
	updated_at: string;
	source: TemplateSource;
}

// ============================================================================
// 5. 导入冲突与结果(§4.4 + §6.1)
// ============================================================================

export interface ImportConflict {
	objectType: ObjectType;
	objectId: string;
	existingVersion: number;
	importVersion: number;
	resolution?: ConflictResolution;
}

export interface ImportResult {
	objectType: ObjectType;
	totalCount: number;
	results: ImportItemResult[];
	successCount: number;
	failureCount: number;
}

export interface ImportItemResult {
	objectId: string;
	action: "created" | "updated" | "renamed" | "skipped" | "failed";
	status: "success" | "error";
	error?: string;
}

// ============================================================================
// 6. 导入快照(§4.5)
// ============================================================================

export interface ImportSnapshot {
	id: string;
	userId: string;
	label?: string;
	sizeBytes: number;
	createdAt: string;
	/** 默认 30 天后过期 */
	expiresAt: string;
	/** localStorage 引用键(P0 快照内容直接存 localStorage) */
	contentRef: string;
}

// ============================================================================
// 7. 辅助:对象类型标签
// ============================================================================

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
	rule: "规则",
	dataset: "数据集",
	form: "表单 Schema",
	library_schema: "库 Schema",
};

export const CONFLICT_RESOLUTION_LABELS: Record<ConflictResolution, string> = {
	skip: "跳过",
	overwrite: "覆盖",
	rename: "重命名",
	merge: "合并",
};

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
	medical: "医疗",
	finance: "金融",
	compliance: "合规",
	general: "通用",
	education: "教育",
	retail: "零售",
};
