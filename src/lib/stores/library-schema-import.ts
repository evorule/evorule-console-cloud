// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §6.4 库 schema 模板导入(扩展 P01)。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.4 + §3.8 定义。
//
// 设计:
//   - LibrarySchemaTemplate:库 schema 模板(规则+术语+表单+数据集 初始包)
//   - 3 个内置模板:医院 starter / 财务 starter / 合规 starter
//   - 合规 starter 内嵌 5 条等保 2.0 三级门禁规则(§3.8)
//   - createLibraryFromTemplate:从模板创建新库(P01 建库向导调用)
//   - exportLibrarySchema:整库 schema 导出为 YAML
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §6.4 + §3.8

import {
	serializeTo,
	type UniversalFormat,
} from "./format-converter";
import {
	initDb,
	type Industry,
} from "./db";
import {
	importRule,
	getAllRules,
	currentWorkspace,
} from "$lib/kernel";
import { getActiveWorkspaceBackend } from "$lib/backend/cloud-workspace-backend";
import { datasetStore } from "./dataset";
import { businessFormSchemaStore } from "./business-form-schema";
import { businessTermsStore } from "./business-terms";
import { get } from "svelte/store";
import type { Dataset } from "./dataset-types";
import type { BusinessFormSchema } from "./business-form-schema";

// ============================================================================
// 1. 类型定义
// ============================================================================

export interface LibrarySchemaTemplate {
	id: string;
	name: string;
	description: string;
	industry: string;
	initialRules: unknown[];
	initialTerms: unknown[];
	initialForms: BusinessFormSchema[];
	initialDatasets: Dataset[];
}

// ============================================================================
// 2. 内置库 schema 模板(3 个)
// ============================================================================

/**
 * 内置库 schema 模板(§6.4)。
 *
 * 3 个 starter:
 *   - 医院 starter:病人就诊 / 药品开具 / 发票审批 3 规则
 *   - 财务 starter:发票审批 / 预算校验 / 费用报销 3 规则
 *   - 合规 starter:等保 2.0 三级门禁 5 条 P0 规则(§3.8)
 */
export const BUILTIN_LIBRARY_TEMPLATES: LibrarySchemaTemplate[] = [
	{
		id: "builtin.agent_audit_starter",
		name: "Agent 审计 Starter",
		description: "Agent 护栏三件套:破坏性命令拦截 / AI 自动批准转人工 / 敏感操作 MFA 门禁",
		industry: "agent",
		initialRules: [
			{
				id: "guard_shell_risky",
				version: 1,
				description: "破坏性命令护栏:risk_class=destructive 阻断转人工(检测归生产者,规则只裁决)",
				condition: { fact: "command.risk_class", op: "==", value: "destructive" },
				action: { type: "block", reason: "破坏性命令须人工审批(等保 2.0)" },
				priority: 95,
				enabled: true,
			},
			{
				id: "agent_auto_approve_gate",
				version: 1,
				description: "AI 自动批准门禁:auto_approved=true 不允许直接生效,转人工确认",
				condition: { fact: "release.auto_approved", op: "==", value: true },
				action: { type: "escalate", target: "human_operator", reason: "AI 自动批准须人工确认" },
				priority: 90,
				enabled: true,
			},
			{
				id: "ai_mfa_gate",
				version: 1,
				description: "敏感操作 MFA 门禁:未过 MFA 的资金/敏感操作阻断留痕(等保 2.0 §8.1.4.1.d)",
				condition: { fact: "request.mfa_verified", op: "==", value: false },
				action: { type: "block", reason: "敏感操作需先通过 MFA 验证" },
				priority: 85,
				enabled: true,
			},
		],
		initialTerms: [
			{ key: "command.risk_class", label: "命令风险等级" },
			{ key: "release.auto_approved", label: "AI 自动批准" },
			{ key: "request.mfa_verified", label: "MFA 已验证" },
		],
		initialForms: [],
		initialDatasets: [],
	},
	{
		id: "builtin.finance_starter",
		name: "财务 Starter",
		description: "发票审批 / 预算校验 / 费用报销 3 条 starter 规则",
		industry: "finance",
		initialRules: [
			{
				id: "finance.invoice_approval",
				version: 1,
				description: "发票审批规则:金额 > 10000 需财务总监签字",
				condition: { fact: "invoice.amount", op: ">", value: 10000 },
				action: { type: "escalate", target: "cfo", reason: "高额发票审批" },
				priority: 70,
				enabled: true,
			},
			{
				id: "finance.budget_check",
				version: 1,
				description: "预算校验规则:超预算 10% 阻止",
				condition: {
					all: [
						{ fact: "expense.amount", op: ">", value: 0 },
						{ fact: "budget.remaining", op: "<", value: 0 },
					],
				},
				action: { type: "block", reason: "预算不足" },
				priority: 90,
				enabled: true,
			},
			{
				id: "finance.expense_reimbursement",
				version: 1,
				description: "费用报销规则:差旅需附行程单",
				condition: {
					all: [
						{ fact: "expense.type", op: "==", value: "travel" },
						{ fact: "expense.has_itinerary", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "差旅报销需附行程单" },
				priority: 60,
				enabled: true,
			},
		],
		initialTerms: [
			{ key: "invoice.amount", label: "发票金额", unit: "元" },
			{ key: "budget.remaining", label: "预算余额", unit: "元" },
			{ key: "expense.type", label: "费用类型" },
		],
		initialForms: [],
		initialDatasets: [],
	},
	{
		id: "builtin.compliance_starter",
		name: "合规 Starter(等保 2.0 三级门禁)",
		description:
			"等保 2.0 三级要求 + GA/T 2380-2026 数据溯源,5 条 P0 门禁规则(§3.8)",
		industry: "compliance",
		initialRules: [
			{
				id: "djbh.identity.mfa_required",
				version: 1,
				description: "管理类工具调用前必须验证双因子认证(§8.1.4.1.d)",
				condition: { fact: "auth.factor_count", op: "<", value: 2 },
				action: { type: "block", reason: "需要双因子认证" },
				priority: 100,
				enabled: true,
			},
			{
				id: "djbh.confidentiality.storage_encryption",
				version: 1,
				description: "敏感数据写入存储前必须加密(§8.1.4.7.b)",
				condition: {
					all: [
						{ fact: "data.classification", op: "in", value: ["secret", "confidential"] },
						{ fact: "storage.encrypted", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "敏感数据需加密存储" },
				priority: 100,
				enabled: true,
			},
			{
				id: "djbh.pi.mask_on_display",
				version: 1,
				description: "AI Agent 响应含个人信息必须脱敏(§8.1.4.10.b)",
				condition: {
					all: [
						{ fact: "response.contains_pi", op: "==", value: true },
						{ fact: "response.masked", op: "==", value: false },
					],
				},
				action: { type: "transform", transform: "mask_pi", reason: "脱敏后展示" },
				priority: 90,
				enabled: true,
			},
			{
				id: "djbh.intrusion.no_high_risk_ports",
				version: 1,
				description: "禁止开放高危端口或停用防火墙(§8.1.4.4.b)",
				condition: {
					any: [
						{ fact: "network.open_ports", op: "intersects", value: [22, 23, 3389, 445] },
						{ fact: "firewall.enabled", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "检测到高危端口或防火墙关闭" },
				priority: 100,
				enabled: true,
			},
			{
				id: "djbh.data.flow_audit",
				version: 1,
				description: "数据导出/共享必须留 BLAKE3 哈希链记录(GA/T 2380-2026)",
				condition: {
					all: [
						{ fact: "operation.type", op: "in", value: ["export", "share"] },
						{ fact: "audit.blake3_recorded", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "需先记录 BLAKE3 审计链" },
				priority: 95,
				enabled: true,
			},
		],
		initialTerms: [
			{ key: "auth.factor_count", label: "认证因子数" },
			{ key: "data.classification", label: "数据密级" },
			{ key: "storage.encrypted", label: "存储是否加密" },
			{ key: "response.contains_pi", label: "响应含个人信息" },
			{ key: "audit.blake3_recorded", label: "BLAKE3 审计已记录" },
		],
		initialForms: [],
		initialDatasets: [],
	},
	{
		id: "builtin.hospital_starter",
		name: "医院 Starter",
		description: "病人就诊 / 药品开具 / 发票审批 3 条 starter 规则",
		industry: "medical",
		initialRules: [
			{
				id: "hospital.patient_consult",
				version: 1,
				description: "病人就诊规则:体温 > 38°C 触发热诊分诊",
				condition: { fact: "patient.temperature", op: ">", value: 38 },
				action: { type: "route", target: "fever_clinic", reason: "高温分诊" },
				priority: 50,
				enabled: true,
			},
			{
				id: "hospital.drug_prescription",
				version: 1,
				description: "药品开具规则:抗生素需二次审核",
				condition: {
					all: [
						{ fact: "drug.category", op: "==", value: "antibiotic" },
						{ fact: "prescription.reviewed", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "抗生素需二次审核" },
				priority: 80,
				enabled: true,
			},
			{
				id: "hospital.invoice_approval",
				version: 1,
				description: "发票审批规则:金额 > 5000 需主任签字",
				condition: { fact: "invoice.amount", op: ">", value: 5000 },
				action: { type: "escalate", target: "department_head", reason: "高额审批" },
				priority: 60,
				enabled: true,
			},
		],
		initialTerms: [
			{ key: "patient.temperature", label: "病人体温", unit: "°C" },
			{ key: "drug.category", label: "药品类别" },
			{ key: "invoice.amount", label: "发票金额", unit: "元" },
		],
		initialForms: [],
		initialDatasets: [],
	},
];

// ============================================================================
// 3. createLibraryFromTemplate
// ============================================================================

/**
 * 从模板创建新库。
 *
 * 步骤:
 *   1. initDb(模板 industry)
 *   2. 逐条 importRule(initialRules)
 *   3. businessTermsStore.set(initialTerms)
 *   4. businessFormSchemaStore.set(initialForms)
 *   5. datasetStore.set(initialDatasets)
 *
 * @param templateId 模板 ID
 * @param libraryName 库名(传给 initDb)
 */
export async function createLibraryFromTemplate(
	templateId: string,
	libraryName: string,
): Promise<void> {
	const template = BUILTIN_LIBRARY_TEMPLATES.find((t) => t.id === templateId);
	if (!template) {
		throw new Error(`库 schema 模板 ${templateId} 不存在`);
	}

	// 1. 初始化库
	const industry = template.industry as Industry;
	initDb(libraryName, [], industry);

	// 1.5 内核 v0.2.0:importRule 需 WorkspaceBackend + workspaceId
	const wb = getActiveWorkspaceBackend();
	const ws = get(currentWorkspace);
	if (!ws) {
		throw new Error("当前没有 workspace,无法导入库模板规则");
	}

	// 2. 导入规则
	for (const rule of template.initialRules) {
		await importRule(wb, ws.id, JSON.stringify(rule));
	}

	// 3. 设置术语
	businessTermsStore.set(
		template.initialTerms as never[],
	);

	// 4. 设置表单
	businessFormSchemaStore.set(template.initialForms);

	// 5. 设置数据集
	datasetStore.set(template.initialDatasets);
}

// ============================================================================
// 4. exportLibrarySchema
// ============================================================================

/**
 * 整库 schema 导出为 YAML(或 JSON)。
 *
 * 导出内容:rules + datasets + forms + terms + dbMeta
 */
export async function exportLibrarySchema(
	format: UniversalFormat = "yaml",
): Promise<Blob> {
	const data = {
		dbMeta: {
			industry: get(businessFormSchemaStore).length,
			rulesCount: getAllRules().length,
			exportedAt: new Date().toISOString(),
		},
		rules: getAllRules(),
		terms: get(businessTermsStore),
		forms: get(businessFormSchemaStore),
		datasets: get(datasetStore),
	};

	return serializeTo(data, format, { prettyPrint: true });
}

// ============================================================================
// 5. 查询
// ============================================================================

/** 列出所有内置模板 */
export function listBuiltinTemplates(): LibrarySchemaTemplate[] {
	return BUILTIN_LIBRARY_TEMPLATES;
}

/** 获取单个模板 */
export function getBuiltinTemplate(
	templateId: string,
): LibrarySchemaTemplate | undefined {
	return BUILTIN_LIBRARY_TEMPLATES.find((t) => t.id === templateId);
}
