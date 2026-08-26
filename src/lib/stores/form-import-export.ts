// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §6.3 表单 schema 导入导出(扩展 P02)。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.3 定义。
//
// 设计:
//   - exportFormSchema:表单 schema 导出为 UniversalExportPackage
//   - importFormSchema:加 -imported-{ts} 后缀,不覆盖
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.3

import {
	serializeTo,
	deserializeFrom,
	type UniversalFormat,
} from "./format-converter";
import {
	type UniversalExportPackage,
	type PackageOperator,
} from "./import-export-types";
import { blake3Hex } from "./ruleset-import";
import {
	businessFormSchemaStore,
	addBusinessFormSchema,
	type BusinessFormSchema,
} from "./business-form-schema";
import { get } from "svelte/store";
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
// 1. 表单 schema 导出
// ============================================================================

/**
 * 表单 schema 导出为指定格式 Blob。
 * @param formId 表单 schema ID
 * @param format 目标格式(默认 json)
 */
export async function exportFormSchema(
	formId: string,
	format: UniversalFormat = "json",
): Promise<Blob> {
	const forms = get(businessFormSchemaStore);
	const form = forms.find((f) => f.id === formId);
	if (!form) {
		throw new Error(`表单 schema ${formId} 不存在`);
	}

	const operator = getCurrentOperator();
	const pkg: UniversalExportPackage = {
		meta: {
			manifest_version: "1.0",
			package_id: `pkg-form-${Date.now().toString(36)}`,
			exported_at: new Date().toISOString(),
			exported_by: operator,
			source_instance: "evorule-console-cloud",
			object_type: "form",
			object_count: 1,
			format,
			content_hash: await blake3Hex(JSON.stringify(form)),
		},
		objectType: "form",
		data: form,
	};

	return serializeTo(pkg, format, { prettyPrint: true });
}

// ============================================================================
// 2. 表单 schema 导入
// ============================================================================

/**
 * 表单 schema 导入(加 -imported-{ts} 后缀,不覆盖)。
 * @param input 文本或 Blob
 * @param format 输入格式
 * @returns 新表单 schema ID
 */
export async function importFormSchema(
	input: string | Blob,
	format: UniversalFormat,
): Promise<string> {
	const data = await deserializeFrom(input, format);

	// 从 UniversalExportPackage 或裸 form 提取
	let formObj: Record<string, unknown>;
	if (
		data &&
		typeof data === "object" &&
		"objectType" in (data as Record<string, unknown>) &&
		(data as Record<string, unknown>).objectType === "form"
	) {
		formObj = (data as UniversalExportPackage).data as Record<string, unknown>;
	} else {
		formObj = data as Record<string, unknown>;
	}

	// 改 ID + name,加后缀
	const originalId = typeof formObj.id === "string" ? formObj.id : "form";
	const originalName =
		typeof formObj.name === "string" ? formObj.name : "表单";
	const ts = Date.now().toString(36);
	formObj.id = `${originalId}-imported-${ts}`;
	formObj.name = `${originalName}(导入)`;

	// 用 addBusinessFormSchema 创建(需匹配其签名:Omit<BusinessFormSchema, "version">)
	const newForm = formObj as unknown as Omit<BusinessFormSchema, "version">;
	return addBusinessFormSchema(newForm);
}
