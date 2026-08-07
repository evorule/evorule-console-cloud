// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §6.2 数据集导入导出(扩展 P03)。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.2 定义。
//
// 设计:
//   - exportDataset:数据集导出为 UniversalExportPackage
//   - importDataset:总是新建(不覆盖,加 -imported-{ts} 后缀)
//   - CSV 导出:扁平化 cases 数组
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.2

import {
	serializeTo,
	deserializeFrom,
	type UniversalFormat,
} from "./format-converter";
import {
	type UniversalExportPackage,
	type PackageOperator,
} from "./import-export-types";
import { sha256Hex } from "./ruleset-import";
import { getDataset, createDataset } from "./dataset";
import { getCurrentUser } from "./auth";

/** 从 auth store 取当前操作人 */
function getCurrentOperator(): PackageOperator {
	const user = getCurrentUser();
	if (user) {
		return {
			id: user.id,
			displayName: user.displayName,
			role: user.role,
		};
	}
	return {
		id: "anonymous",
		displayName: "匿名用户",
		role: "user",
	};
}

// ============================================================================
// 1. 数据集导出
// ============================================================================

/**
 * 数据集导出为指定格式 Blob。
 * @param datasetId 数据集 ID
 * @param format 目标格式(CSV 时扁平化 cases)
 */
export async function exportDataset(
	datasetId: string,
	format: UniversalFormat,
): Promise<Blob> {
	const dataset = getDataset(datasetId);
	if (!dataset) {
		throw new Error(`数据集 ${datasetId} 不存在`);
	}

	const operator = getCurrentOperator();
	const pkg: UniversalExportPackage = {
		meta: {
			manifest_version: "1.0",
			package_id: `pkg-dataset-${Date.now().toString(36)}`,
			exported_at: new Date().toISOString(),
			exported_by: operator,
			source_instance: "evorule-console-cloud",
			object_type: "dataset",
			object_count: 1,
			format,
			content_hash: await sha256Hex(JSON.stringify(dataset)),
		},
		objectType: "dataset",
		data: dataset,
	};

	return serializeTo(pkg, format, { prettyPrint: true });
}

// ============================================================================
// 2. 数据集导入
// ============================================================================

/**
 * 数据集导入(总是新建,加 -imported-{ts} 后缀,不覆盖)。
 * @param input 文本或 Blob
 * @param format 输入格式
 * @param name 新数据集名称(可选,默认用源数据集名 + imported)
 * @param description 新数据集描述(可选)
 * @returns 新数据集 ID
 */
export async function importDataset(
	input: string | Blob,
	format: UniversalFormat,
	name?: string,
	description?: string,
): Promise<string> {
	const data = await deserializeFrom(input, format);

	// 从 UniversalExportPackage 或裸 dataset 提取
	let datasetObj: Record<string, unknown>;
	if (
		data &&
		typeof data === "object" &&
		"objectType" in (data as Record<string, unknown>) &&
		(data as Record<string, unknown>).objectType === "dataset"
	) {
		datasetObj = (data as UniversalExportPackage).data as Record<string, unknown>;
	} else {
		datasetObj = data as Record<string, unknown>;
	}

	const finalName =
		name ??
		`${typeof datasetObj.name === "string" ? datasetObj.name : "数据集"}-imported-${Date.now().toString(36)}`;
	const finalDesc =
		description ??
		(typeof datasetObj.description === "string" ? datasetObj.description : "");
	const ruleIds = Array.isArray(datasetObj.ruleIds)
		? (datasetObj.ruleIds as string[])
		: [];
	const tagIds = Array.isArray(datasetObj.tagIds)
		? (datasetObj.tagIds as string[])
		: [];
	const categoryId =
		typeof datasetObj.categoryId === "string" ? datasetObj.categoryId : null;

	return createDataset(finalName, finalDesc, ruleIds, tagIds, categoryId);
}
