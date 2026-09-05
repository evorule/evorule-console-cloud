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
	currentWorkspace,
	loadRuleContent,
} from "$lib/kernel";
import { getActiveWorkspaceBackend } from "$lib/backend/cloud-workspace-backend";
import { get } from "svelte/store";
import {
  serializeTo,
  deserializeFrom,
  yamlParse,
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
import { blake3Hex } from "./ruleset-import";
import { getCurrentUser } from "./auth";

// ============================================================================
// 1. 单条规则导出
// ============================================================================

/**
 * 导出前置:确保目标规则 content 已加载(UV-089 ③)。
 *
 * kernel refreshRules 的 listRules 不含 content(懒加载设计),但 exportRule
 * 强依赖 content——未经预载,任何未在编辑器中打开过的规则导出必抛
 * "内容未加载,无法导出"。此函数对缺 content 的目标规则并行拉取版本内容。
 *
 * best-effort:backend 未初始化(离线/布局未注入)或 workspace 缺失时跳过,
 * 由 exportRule 的显式报错兜底(fail-fast,不静默)。
 */
async function ensureRulesContent(ids: string[]): Promise<void> {
	let backend;
	try {
		backend = getActiveWorkspaceBackend();
	} catch {
		return;
	}
	const ws = get(currentWorkspace);
	if (!ws) return;
	const missing = getAllRules().filter(
		(r) => ids.includes(r.id) && r.content === undefined,
	);
	await Promise.all(missing.map((r) => loadRuleContent(backend, ws.id, r.id)));
}

/**
 * 单条规则导出为指定格式 Blob。
 * @param ruleId 规则 ID
 * @param format 目标格式
 */
export async function exportRuleUniversal(
	ruleId: string,
	format: UniversalFormat,
): Promise<Blob> {
	await ensureRulesContent([ruleId]);
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
			content_hash: await blake3Hex(ruleJson),
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
	await ensureRulesContent(ids);
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

	const contentHash = await blake3Hex(
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

	// 检查冲突(v0.2.0:业务标识在 name,importRule 生成 "user." 前缀 name)
	const ruleId = (ruleObj as { id?: string })?.id;
	const existing = getAllRules();
	const exists = ruleId
		? existing.some((r) => r.name === ruleId || r.name === `user.${ruleId}`)
		: false;

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

	// 内核 v0.2.0:importRule 需 WorkspaceBackend + workspaceId
	const wb = getActiveWorkspaceBackend();
	const ws = get(currentWorkspace);
	if (!ws) {
		throw new Error("当前没有 workspace,无法导入规则");
	}
	const newRuleId = await importRule(wb, ws.id, ruleJson);
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
// 5. 向导包 → 治理链导入辅助(UV-078 W3 方向 b)
// ============================================================================

/**
 * 向导批量包解析结果中的单条规则(供治理页「从向导包导入」预览与入库)。
 */
export interface WizardRuleItem {
  /** 提取的治理 entry_id(rule_body.rule_id 优先,缺省用文件名/规则名清洗) */
  entryId: string;
  /** 原批量包内的规则 ID(镜像字段) */
  sourceId: string;
  /** rule_body JSON 文本(pretty-print 后,直接填治理表单) */
  ruleBody: string;
  /** 规则描述(rule_body.description 透传,预览用) */
  description: string;
}

/**
 * 解析向导批量包(.evorule-batch.json)为治理链可入库的规则条目清单。
 *
 * 形态映射(尽调核实零鸿沟):exportRulesBatch 的 files[].content_base64 解码后
 * 即 evorule 原生规则 JSON,与治理链 AddEntryRequest.rule_body 同形态直通。
 * entry_id 提取优先级:rule_body.rule_id → files[].objectId(清洗 user. 前缀)。
 *
 * 容错纪律:单条解码/解析失败不静默跳过,收集到 errors 逐条透出。
 */
export function parseWizardBatchPackage(
  pkg: unknown,
): { items: WizardRuleItem[]; errors: string[] } {
  const errors: string[] = [];
  const items: WizardRuleItem[] = [];

  const manifest = (pkg as { manifest?: unknown })?.manifest;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    (manifest as { manifest_version?: string }).manifest_version !== "1.0"
  ) {
    return {
      items,
      errors: ["无效的批量包:缺少 manifest 或 manifest_version 不兼容"],
    };
  }

  const files = (pkg as { files?: unknown })?.files;
  if (!Array.isArray(files) || files.length === 0) {
    return { items, errors: ["批量包为空:files 数组缺失或无内容"] };
  }

  for (const f of files) {
    const file = f as {
      path?: string;
      objectId?: string;
      content_base64?: string;
      format?: string;
    };
    const label = file.path ?? file.objectId ?? "(未命名)";
    try {
      if (typeof file.content_base64 !== "string") {
        errors.push(`${label}: 缺少 content_base64`);
        continue;
      }
      const text = decodeURIComponent(escape(atob(file.content_base64)));
      // 按包内 files[].format 分流:yaml 用 yamlParse(导出中心批量默认 yaml),
      // 其余按 JSON 解析。曾一律 JSON.parse,yaml 包 13/13 条逐条解析失败
      // (UV-078 W3 e2e 发现)。toml 暂不支持,走 catch 逐条诚实报错。
      let rule: unknown;
      if (file.format === "yaml") {
        rule = yamlParse(text);
        if (
          rule === null ||
          typeof rule !== "object" ||
          Array.isArray(rule)
        ) {
          throw new Error("YAML 解析结果非对象");
        }
        if (Object.keys(rule as Record<string, unknown>).length === 0) {
          // yamlParse 对非 key-value 行静默跳过,垃圾内容会解析成空 {}(UV-089 ⑤ 边界防御)
          throw new Error("YAML 解析结果为空对象(内容非法或非规则 YAML)");
        }
      } else {
        rule = JSON.parse(text);
      }
      const ruleObj = rule as {
        rule_id?: string;
        description?: string;
      };
      // entry_id 提取:rule_id 优先;缺省用 objectId 清洗 user. 前缀
      let entryId = "";
      if (typeof ruleObj.rule_id === "string" && ruleObj.rule_id.trim() !== "") {
        entryId = ruleObj.rule_id.trim();
      } else if (typeof file.objectId === "string") {
        entryId = file.objectId.replace(/^user\./, "");
      }
      if (entryId === "") {
        errors.push(`${label}: 无法提取 entry_id(rule_body 无 rule_id,objectId 缺失)`);
        continue;
      }
      items.push({
        entryId,
        sourceId: file.objectId ?? entryId,
        ruleBody: JSON.stringify(ruleObj, null, 2),
        description:
          typeof ruleObj.description === "string" ? ruleObj.description : "",
      });
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { items, errors };
}

// ============================================================================
// 6. 辅助
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
