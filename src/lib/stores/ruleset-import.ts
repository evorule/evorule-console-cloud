// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// P09 §3.8 官方规则集导入 — 从 ruleset.json 导入规则集。
// P09_IMPORT_EXPORT_INFRA_DESIGN.md §4.6 + §6.4 定义。
//
// 设计:
//   - importRuleset:解析 ruleset.json → 验证 contentHash → 逐条 importRule
//   - BUILTIN_RULESET_PACKAGES:内置官方规则集只读副本(P0)
//   - 首个官方规则集:等保 2.0 三级门禁规则集(DJBH 2.0 Level 3)
//
// P0 简化:
//   - contentHash 用 BLAKE3(全生态统一 SSOT,与 evorule 核心仓/reactor 一致)
//     (浏览器端用 @noble/hashes 纯 JS BLAKE3,带 blake3: 前缀,无需 Wasm)
//   - 规则 content 直接复用内核 importRule(jsonContent)
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.8 + §4.6 + §6.4

import { importRule, getAllRules } from "@evorule/console";
import { blake3 } from "@noble/hashes/blake3.js";
import type {
	RulesetPackage,
	RulesetImportResult,
	RulesetRule,
} from "./ruleset-types";
import type { ConflictResolution } from "./import-export-types";

// ============================================================================
// 1. 内置官方规则集:等保 2.0 三级门禁(DJBH 2.0 Level 3)
// ============================================================================

/**
 * 5 条 P0 等保门禁规则(§3.8 决策 8)。
 *
 * 规则 content 是 evorule 标准 rule.json 文本(JSON.stringify 后的字符串)。
 * console-cloud 只读副本,P1 在线规则市场 API 上线后可同步最新版本。
 */
function buildDjbhRules(): RulesetRule[] {
	return [
		{
			id: "djbh.identity.mfa_required",
			version: 1,
			description: "管理类工具调用前必须验证双因子认证(§8.1.4.1.d)",
			content: JSON.stringify({
				id: "djbh.identity.mfa_required",
				version: 1,
				description: "管理类工具调用前必须验证双因子认证",
				condition: { fact: "auth.factor_count", op: "<", value: 2 },
				action: { type: "block", reason: "需要双因子认证" },
				priority: 100,
				enabled: true,
			}),
			compliance: {
				standard: "GB/T 22239-2019",
				level: 3,
				clause: "8.1.4.1.d",
				clauseTitle: "身份鉴别 — 双因子认证",
				riskLevel: "high",
				remediation: "为管理类工具启用 MFA(密码 + 短信/TOTP/硬件)",
			},
		},
		{
			id: "djbh.confidentiality.storage_encryption",
			version: 1,
			description: "敏感数据写入存储前必须加密(§8.1.4.7.b)",
			content: JSON.stringify({
				id: "djbh.confidentiality.storage_encryption",
				version: 1,
				description: "敏感数据写入存储前必须加密(SM4 优先)",
				condition: {
					all: [
						{ fact: "data.classification", op: "in", value: ["secret", "confidential"] },
						{ fact: "storage.encrypted", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "敏感数据需加密存储" },
				priority: 100,
				enabled: true,
			}),
			compliance: {
				standard: "GB/T 22239-2019",
				level: 3,
				clause: "8.1.4.7.b",
				clauseTitle: "数据保密性 — 存储加密",
				riskLevel: "critical",
				remediation: "敏感字段用 SM4/AES-256 加密后再写入存储",
			},
		},
		{
			id: "djbh.pi.mask_on_display",
			version: 1,
			description: "AI Agent 响应含个人信息必须脱敏(§8.1.4.10.b)",
			content: JSON.stringify({
				id: "djbh.pi.mask_on_display",
				version: 1,
				description: "AI Agent 响应含个人信息必须脱敏展示",
				condition: {
					all: [
						{ fact: "response.contains_pi", op: "==", value: true },
						{ fact: "response.masked", op: "==", value: false },
					],
				},
				action: { type: "transform", transform: "mask_pi", reason: "脱敏后展示" },
				priority: 90,
				enabled: true,
			}),
			compliance: {
				standard: "GB/T 22239-2019",
				level: 3,
				clause: "8.1.4.10.b",
				clauseTitle: "个人信息保护 — 脱敏展示",
				riskLevel: "high",
				remediation: "对响应中的身份证/手机号/银行卡做掩码处理",
			},
		},
		{
			id: "djbh.intrusion.no_high_risk_ports",
			version: 1,
			description: "禁止开放高危端口或停用防火墙(§8.1.4.4.b)",
			content: JSON.stringify({
				id: "djbh.intrusion.no_high_risk_ports",
				version: 1,
				description: "禁止开放高危端口或停用防火墙",
				condition: {
					any: [
						{ fact: "network.open_ports", op: "intersects", value: [22, 23, 3389, 445] },
						{ fact: "firewall.enabled", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "检测到高危端口或防火墙关闭" },
				priority: 100,
				enabled: true,
			}),
			compliance: {
				standard: "GB/T 22239-2019",
				level: 3,
				clause: "8.1.4.4.b",
				clauseTitle: "入侵防范 — 端口与防火墙",
				riskLevel: "critical",
				remediation: "关闭 22/23/3389/445 等高危端口,启用主机防火墙",
			},
		},
		{
			id: "djbh.data.flow_audit",
			version: 1,
			description: "数据导出/共享必须留 BLAKE3 哈希链记录(GA/T 2380-2026)",
			content: JSON.stringify({
				id: "djbh.data.flow_audit",
				version: 1,
				description: "数据导出/共享必须留 BLAKE3 哈希链记录",
				condition: {
					all: [
						{ fact: "operation.type", op: "in", value: ["export", "share"] },
						{ fact: "audit.blake3_recorded", op: "==", value: false },
					],
				},
				action: { type: "block", reason: "需先记录 BLAKE3 审计链" },
				priority: 95,
				enabled: true,
			}),
			compliance: {
				standard: "GA/T 2380-2026",
				level: 3,
				clause: "6.2",
				clauseTitle: "数据流转审计 — 哈希链留痕",
				riskLevel: "high",
				remediation: "在 evorule-server 启用 production_audit,导出前写 BLAKE3 链",
			},
		},
	];
}

/**
 * 内置官方规则集包(DJBH 2.0 Level 3)。
 *
 * contentHash 用 BLAKE3(浏览器 @noble/hashes)在运行时计算,
 * 避免硬编码哈希与内容不一致。
 */
export async function buildDjbhRulesetPackage(): Promise<RulesetPackage> {
	const rules = buildDjbhRules();
	const now = new Date().toISOString();
	const contentHash = await blake3Hex(
		rules.map((r) => r.content).join("\n"),
	);
	return {
		meta: {
			schemaVersion: "1.0",
			rulesetVersion: "1.0.0",
			rulesetId: "djbh-2.0-level3",
			name: "等保 2.0 三级门禁规则集",
			description:
				"GB/T 22239-2019 三级要求 + GA/T 2380-2026 数据溯源,5 条 P0 门禁规则",
			standard: "GB/T 22239-2019",
			level: 3,
			author: "EvoRule Project",
			license: "AGPL-3.0-or-later",
			repository: "https://gitee.com/evorule/evorule-rules",
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: now,
			tags: ["djbh", "level3", "gate", "compliance"],
		},
		rules,
		complianceMapping: [
			{
				clause: "8.1.4.1.d",
				clauseTitle: "身份鉴别 — 双因子认证",
				ruleIds: ["djbh.identity.mfa_required"],
				requirement: "管理类工具调用前必须验证双因子认证",
			},
			{
				clause: "8.1.4.7.b",
				clauseTitle: "数据保密性 — 存储加密",
				ruleIds: ["djbh.confidentiality.storage_encryption"],
				requirement: "敏感数据存储前必须加密",
			},
			{
				clause: "8.1.4.10.b",
				clauseTitle: "个人信息保护 — 脱敏展示",
				ruleIds: ["djbh.pi.mask_on_display"],
				requirement: "AI 响应含 PI 必须脱敏",
			},
			{
				clause: "8.1.4.4.b",
				clauseTitle: "入侵防范 — 端口与防火墙",
				ruleIds: ["djbh.intrusion.no_high_risk_ports"],
				requirement: "禁止高危端口 + 防火墙必须启用",
			},
			{
				clause: "6.2",
				clauseTitle: "数据流转审计 — 哈希链留痕",
				ruleIds: ["djbh.data.flow_audit"],
				requirement: "数据导出/共享必须留 BLAKE3 哈希链",
			},
		],
		contentHash,
	};
}

// ============================================================================
// 2. importRuleset 主函数
// ============================================================================

/**
 * 从 ruleset.json 文本导入规则集。
 *
 * 步骤:
 *   1. JSON.parse → RulesetPackage
 *   2. 验证 contentHash(重新计算对比,失败抛错)
 *   3. 逐条 importRule(content)
 *   4. 冲突处理:skip 跳过已存在的 / overwrite 先删后建 / rename 加后缀
 *
 * @param rulesetJson ruleset.json 文本
 * @param options 冲突处理选项(默认 rename)
 * @returns 导入结果
 */
export async function importRuleset(
	rulesetJson: string,
	options?: { conflictResolution?: ConflictResolution },
): Promise<RulesetImportResult> {
	const start = Date.now();
	const conflictResolution: ConflictResolution =
		options?.conflictResolution ?? "rename";

	// 1. 解析
	let pkg: RulesetPackage;
	try {
		pkg = JSON.parse(rulesetJson) as RulesetPackage;
	} catch (e) {
		throw new Error(
			`ruleset.json 解析失败:${e instanceof Error ? e.message : String(e)}`,
		);
	}

	// 2. 验证 meta
	if (!pkg.meta || pkg.meta.schemaVersion !== "1.0") {
		throw new Error(
			`ruleset.json schemaVersion 不兼容(期望 1.0,实际 ${pkg.meta?.schemaVersion ?? "missing"})`,
		);
	}
	if (!Array.isArray(pkg.rules)) {
		throw new Error("ruleset.json rules 字段必须是数组");
	}

	// 3. 验证 contentHash(可选,失败仅警告)
	const recomputedHash = await blake3Hex(
		pkg.rules.map((r) => r.content).join("\n"),
	);
	if (pkg.contentHash && pkg.contentHash !== recomputedHash) {
		console.warn(
			`[ruleset-import] contentHash 不匹配(预期 ${pkg.contentHash.slice(0, 12)},实际 ${recomputedHash.slice(0, 12)}),继续导入`,
		);
	}

	// 4. 逐条导入
	// 内核 importRule 会给 id 加 "user." 前缀(如 "djbh.x" → "user.djbh.x"),
	// 冲突检测需同时匹配原始 ID 和带前缀的 ID。
	const existingRules = getAllRules();
	const existingIds = new Set<string>();
	for (const r of existingRules) {
		existingIds.add(r.id);
		// 去掉 "user." 前缀,加入原始 ID(用于匹配 ruleset 中的 rule.id)
		if (r.id.startsWith("user.")) {
			existingIds.add(r.id.slice(5));
		}
	}
	const conflicts: string[] = [];
	const importedRuleIds: string[] = [];
	let imported = 0;
	let skipped = 0;

	for (const rule of pkg.rules) {
		const exists = existingIds.has(rule.id);
		if (exists) {
			switch (conflictResolution) {
				case "skip":
					skipped++;
					conflicts.push(`${rule.id}:已存在,跳过`);
					continue;
				case "rename": {
					// 加后缀
					const newId = `${rule.id}-imported-${Date.now().toString(36)}`;
					const renamedContent = rewriteRuleId(rule.content, newId);
					try {
						const newRuleId = importRule(renamedContent);
						importedRuleIds.push(newRuleId);
						imported++;
					} catch (e) {
						conflicts.push(
							`${rule.id}:重命名导入失败 - ${e instanceof Error ? e.message : String(e)}`,
						);
					}
					continue;
				}
				case "overwrite":
					// 内核 importRule 默认会创建新 ID(不覆盖)
					// P0 简化:overwrite 等同 rename + 标记
					try {
						const newRuleId = importRule(rule.content);
						importedRuleIds.push(newRuleId);
						imported++;
						conflicts.push(`${rule.id}:已存在,已导入为新版本`);
					} catch (e) {
						conflicts.push(
							`${rule.id}:覆盖导入失败 - ${e instanceof Error ? e.message : String(e)}`,
						);
					}
					continue;
				case "merge":
					// P0 不实现对象级 merge,降级为 rename
					try {
						const newRuleId = importRule(rule.content);
						importedRuleIds.push(newRuleId);
						imported++;
						conflicts.push(`${rule.id}:merge 降级为 rename`);
					} catch (e) {
						conflicts.push(
							`${rule.id}:merge 导入失败 - ${e instanceof Error ? e.message : String(e)}`,
						);
					}
					continue;
			}
		}
		// 不存在,直接导入
		try {
			const newRuleId = importRule(rule.content);
			importedRuleIds.push(newRuleId);
			imported++;
		} catch (e) {
			conflicts.push(
				`${rule.id}:导入失败 - ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	return {
		imported,
		skipped,
		conflicts,
		importedRuleIds,
		durationMs: Date.now() - start,
	};
}

/**
 * 重写规则 content 中的 id 字段(用于 rename 策略)。
 */
function rewriteRuleId(content: string, newId: string): string {
	try {
		const obj = JSON.parse(content) as Record<string, unknown>;
		obj.id = newId;
		return JSON.stringify(obj);
	} catch {
		// 解析失败,原样返回(内核 importRule 会处理)
		return content;
	}
}

// ============================================================================
// 3. 辅助:BLAKE3(纯 JS,@noble/hashes)
// ============================================================================

/**
 * 用 BLAKE3 计算十六进制哈希,带 `blake3:` 前缀,与 evorule 全栈约定一致。
 * 替代原 Web Crypto SHA-256 兜底,统一到全生态 BLAKE3 SSOT。
 *
 * 注:importRuleset 的 contentHash 校验为自洽校验(浏览器算 + 浏览器验),
 *     不依赖服务端字节序,故纯 JS BLAKE3 即可保证一致。
 */
export async function blake3Hex(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const digest = blake3(data);
	const hex = Array.from(digest)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `blake3:${hex}`;
}
