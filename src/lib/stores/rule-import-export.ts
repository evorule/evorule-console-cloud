// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §6.1 规则导入导出(扩展 P01)。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.1 定义。
//
// 设计:
//   - 复用内核 rules store 的 exportRule/importRule
//   - 单条导出:UniversalExportPackage 包装 + 任意格式序列化
//   - 批量导出:BatchExportPackage(JSON manifest + 嵌入文件,P0 不用 ZIP)
//   - 单条导入:反序列化 → 取 rule json → importRule
//   - 批量导入:从 BatchExportPackage 解包 → 逐条 importRule
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.1

import {
	exportRule,
	importRule,
	getAllRules,
} from "@evorule/console";
import {
	serializeTo,
	deserializeFrom,
	type UniversalFormat,
} from "./format-converter";
import {
	type UniversalExportPackage,
	type BatchExportPackage,
	type BatchFileSpec,
	type ConflictResolution,
	type ImportResult,
	type PackageOperator,
} from "./import-export-types";
import { sha256Hex } from "./ruleset-import";
import { getCurrentUser } from "./auth";

// ============================================================================
// 1. 单条规则导出
// ============================================================================

/**
 * 单条规则导出为指定格式 Blob。
 * @param ruleId 规则 ID
 * @param format 目标格式
 */
export async function exportRuleUniversal(
	ruleId: string,
	format: UniversalFormat,
): Promise<Blob> {
	const ruleJson = exportRule(ruleId); // 内核返回 JSON 字符串
	let ruleData: unknown;
	try {
		ruleData = JSON.parse(ruleJson);
	} catch {
		ruleData = { raw: ruleJson };
	}

	const operator = getCurrentOperator();
	const pkg: UniversalExportPackage = {
		meta: {
			manifest_version: "1.0",
			package_id: `pkg-rule-${Date.now().toString(36)}`,
			exported_at: new Date().toISOString(),
			exported_by: operator,
			source_instance: "evorule-console-cloud",
			object_type: "rule",
			object_count: 1,
			format,
			content_hash: await sha256Hex(ruleJson),
		},
		objectType: "rule",
		data: ruleData,
	};

	return serializeTo(pkg, format, { prettyPrint: true });
}

// ============================================================================
// 2. 批量规则导出
// ============================================================================

/**
 * 批量规则导出为 BatchExportPackage(JSON 单文件,P0 替代 ZIP)。
 *
 * P0 简化:不打包 ZIP,改用单个 JSON 文件包含 manifest + 所有规则内容。
 * 文件扩展名:.evorule-batch.json
 *
 * @param ruleIds 规则 ID 列表(空 = 全部)
 * @param format 每条规则的格式(默认 yaml)
 */
export async function exportRulesBatch(
	ruleIds: string[],
	format: UniversalFormat = "yaml",
): Promise<Blob> {
	const ids = ruleIds.length > 0 ? ruleIds : getAllRules().map((r) => r.id);
	const files: BatchFileSpec[] = [];
	const operator = getCurrentOperator();

	for (const id of ids) {
		const ruleJson = exportRule(id);
		let ruleData: unknown;
		try {
			ruleData = JSON.parse(ruleJson);
		} catch {
			ruleData = { raw: ruleJson };
		}
		const contentBlob = await serializeTo(ruleData, format, {
			prettyPrint: true,
		});
		const contentText = await contentBlob.text();
		const ext = format === "yaml" ? "yaml" : format === "toml" ? "toml" : "json";
		files.push({
			path: `rules/${id}.${ext}`,
			content_base64: btoa(unescape(encodeURIComponent(contentText))),
			objectType: "rule",
			objectId: id,
			format,
		});
	}

	const contentHash = await sha256Hex(
		files.map((f) => f.content_base64).join(""),
	);

	const pkg: BatchExportPackage = {
		manifest: {
			manifest_version: "1.0",
			exported_at: new Date().toISOString(),
			exported_by: operator,
			source_instance: "evorule-console-cloud",
			contents: [
				{
					type: "rule",
					count: files.length,
					format,
					dir: "rules/",
				},
			],
			total_count: files.length,
			content_hash: contentHash,
		},
		files,
	};

	return serializeTo(pkg, "json", { prettyPrint: true });
}

// ============================================================================
// 3. 单条规则导入
// ============================================================================

/**
 * 单条规则导入。
 * @param input 文本或 Blob
 * @param format 输入格式
 * @param conflictResolution 冲突处理(默认 rename)
 * @returns 导入结果 { imported, action }
 */
export async function importRuleUniversal(
	input: string | Blob,
	format: UniversalFormat,
	conflictResolution: ConflictResolution = "rename",
): Promise<{ imported: string; action: "created" | "updated" | "renamed" | "skipped" }> {
	const data = await deserializeFrom(input, format);

	// 从 UniversalExportPackage 或裸 rule 对象提取 rule json
	let ruleObj: unknown;
	if (
		data &&
		typeof data === "object" &&
		"objectType" in (data as Record<string, unknown>) &&
		(data as Record<string, unknown>).objectType === "rule"
	) {
		ruleObj = (data as UniversalExportPackage).data;
	} else {
		ruleObj = data;
	}

	// 检查冲突
	const ruleId = (ruleObj as { id?: string })?.id;
	const existing = getAllRules();
	const exists = ruleId ? existing.some((r) => r.id === ruleId) : false;

	if (exists && conflictResolution === "skip") {
		return { imported: ruleId ?? "", action: "skipped" };
	}

	let ruleJson: string;
	if (typeof ruleObj === "string") {
		ruleJson = ruleObj;
	} else {
		// rename 策略:改 ID
		if (exists && conflictResolution === "rename" && ruleId) {
			const newId = `${ruleId}-imported-${Date.now().toString(36)}`;
			(ruleObj as Record<string, unknown>).id = newId;
		}
		ruleJson = JSON.stringify(ruleObj);
	}

	const newRuleId = importRule(ruleJson);
	return {
		imported: newRuleId,
		action: exists
			? conflictResolution === "rename"
				? "renamed"
				: conflictResolution === "skip"
					? "skipped"
					: "updated"
			: "created",
	};
}

// ============================================================================
// 4. 批量规则导入
// ============================================================================

/**
 * 批量规则导入(从 BatchExportPackage JSON)。
 * @param batchBlob BatchExportPackage JSON Blob
 * @param conflictResolution 冲突处理(默认 rename)
 * @returns 导入结果
 */
export async function importRulesBatch(
	batchBlob: Blob,
	conflictResolution: ConflictResolution = "rename",
): Promise<ImportResult> {
	const text = await batchBlob.text();
	const pkg = JSON.parse(text) as BatchExportPackage;

	if (!pkg.manifest || pkg.manifest.manifest_version !== "1.0") {
		throw new Error("无效的批量包:manifest_version 不兼容");
	}

	const results: ImportResult["results"] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const file of pkg.files) {
		try {
			const contentText = decodeURIComponent(
				escape(atob(file.content_base64)),
			);
			const result = await importRuleUniversal(
				contentText,
				file.format,
				conflictResolution,
			);
			results.push({
				objectId: result.imported,
				action: result.action,
				status: "success",
			});
			successCount++;
		} catch (e) {
			results.push({
				objectId: file.objectId,
				action: "failed",
				status: "error",
				error: e instanceof Error ? e.message : String(e),
			});
			failureCount++;
		}
	}

	return {
		objectType: "rule",
		totalCount: pkg.files.length,
		results,
		successCount,
		failureCount,
	};
}

// ============================================================================
// 5. 辅助
// ============================================================================

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
