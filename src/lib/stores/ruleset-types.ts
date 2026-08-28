// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §3.8 官方规则集标准格式(ruleset.json)类型定义。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §4.6 定义。
//
// 设计:
//   - RulesetPackage:官方规则集标准格式(生态级共享)
//   - 任何 evorule 生态应用(server/application/第三方 Agent)可直接消费
//   - 等保 2.0 三级门禁规则集(DJBH 2.0 Level 3)为首个官方规则集
//   - P0 类型定义在 console-cloud,P1 迁移到 $lib/kernel 内核(协议层共享)
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.8 + §4.6

// ============================================================================
// 1. RulesetPackage(官方规则集标准格式)
// ============================================================================

export interface RulesetPackage {
	meta: RulesetMeta;
	/** 有序规则列表,按条款号排列 */
	rules: RulesetRule[];
	/** 合规条款 → 规则映射(可选) */
	complianceMapping?: ComplianceMapping[];
	/** 所有规则内容的 BLAKE3 哈希 */
	contentHash: string;
}

export interface RulesetMeta {
	schemaVersion: "1.0";
	/** semver,如 "1.0.0" */
	rulesetVersion: string;
	/** kebab-case,如 "djbh-2.0-level3" */
	rulesetId: string;
	name: string;
	description: string;
	/** 标准,如 "GB/T 22239-2019" */
	standard: string;
	/** 等保级别 1-5 */
	level: number;
	author: string;
	/** SPDX 标识符,如 "AGPL-3.0-or-later" */
	license: string;
	/** 仓库地址 */
	repository: string;
	createdAt: string;
	updatedAt: string;
	tags: string[];
}

export interface RulesetRule {
	/** 规则 ID,如 "djbh.identity.mfa_required" */
	id: string;
	/** 从 1 开始 */
	version: number;
	description: string;
	/** 原始 JSON 文本(evorule 标准 rule.json 格式) */
	content: string;
	compliance?: RulesetComplianceMeta;
}

export interface RulesetComplianceMeta {
	/** 标准,如 "GB/T 22239-2019" */
	standard: string;
	/** 等保级别 1-5 */
	level: number;
	/** 条款号,如 "8.1.4.1.d" */
	clause: string;
	clauseTitle: string;
	riskLevel: "low" | "medium" | "high" | "critical";
	/** 整改建议(中文) */
	remediation: string;
}

export interface ComplianceMapping {
	clause: string;
	clauseTitle: string;
	/** 1 个条款可对应多条规则 */
	ruleIds: string[];
	requirement: string;
}

// ============================================================================
// 2. Ruleset 导入结果
// ============================================================================

export interface RulesetImportResult {
	imported: number;
	skipped: number;
	conflicts: string[];
	/** 导入的规则 ID 列表 */
	importedRuleIds: string[];
	/** 导入耗时(ms) */
	durationMs: number;
}

// ============================================================================
// 3. 辅助标签
// ============================================================================

export const RISK_LEVEL_LABELS: Record<RulesetComplianceMeta["riskLevel"], string> = {
	low: "低",
	medium: "中",
	high: "高",
	critical: "严重",
};
