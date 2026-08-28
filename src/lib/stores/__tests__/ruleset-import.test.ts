// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P09 ruleset-import 单测 — ruleset.json 解析 + 导入 + 冲突处理
//
// 运行: npx vitest run src/lib/stores/__tests__/ruleset-import.test.ts
//
// 关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.8 + §4.6

import { describe, test, expect, beforeEach } from "vitest";
import {
	importRuleset,
	buildDjbhRulesetPackage,
	blake3Hex,
} from "../ruleset-import";
import type { RulesetPackage } from "../ruleset-types";
import { resetRulesStore, currentWorkspace, getAllRules } from "$lib/kernel";
import { MockWorkspaceBackend } from "$lib/backend/mock-workspace-backend";
import { setActiveWorkspaceBackend } from "$lib/backend/cloud-workspace-backend";

// ============================================================================
// 1. buildDjbhRulesetPackage 内置规则集
// ============================================================================

describe("P09 buildDjbhRulesetPackage 内置规则集", () => {
	test("返回完整的 RulesetPackage", async () => {
		const pkg = await buildDjbhRulesetPackage();
		expect(pkg.meta.schemaVersion).toBe("1.0");
		expect(pkg.meta.rulesetId).toBe("djbh-2.0-level3");
		expect(pkg.meta.level).toBe(3);
		expect(pkg.meta.standard).toBe("GB/T 22239-2019");
		expect(pkg.meta.license).toBe("AGPL-3.0-or-later");
		expect(pkg.rules).toHaveLength(5);
		expect(pkg.contentHash).toBeTruthy();
		expect(pkg.contentHash.length).toBeGreaterThan(10);
	});

	test("5 条规则全部带 compliance 元数据", async () => {
		const pkg = await buildDjbhRulesetPackage();
		for (const rule of pkg.rules) {
			expect(rule.compliance).toBeDefined();
			expect(rule.compliance?.clause).toBeTruthy();
			expect(rule.compliance?.riskLevel).toMatch(
				/^(low|medium|high|critical)$/,
			);
			expect(rule.compliance?.remediation).toBeTruthy();
		}
	});

	test("5 条规则 ID 符合 djbh.* 命名规范", async () => {
		const pkg = await buildDjbhRulesetPackage();
		for (const rule of pkg.rules) {
			expect(rule.id).toMatch(/^djbh\./);
		}
	});

	test("complianceMapping 覆盖 5 个条款", async () => {
		const pkg = await buildDjbhRulesetPackage();
		expect(pkg.complianceMapping).toBeDefined();
		expect(pkg.complianceMapping?.length).toBe(5);
	});

	test("规则 content 是合法 JSON 字符串", async () => {
		const pkg = await buildDjbhRulesetPackage();
		for (const rule of pkg.rules) {
			const parsed = JSON.parse(rule.content) as { id: string };
			expect(parsed.id).toBe(rule.id);
		}
	});
});

// ============================================================================
// 2. blake3Hex 辅助函数
// ============================================================================

describe("P09 blake3Hex", () => {
	test("返回 blake3: 前缀的十六进制字符串", async () => {
		const hash = await blake3Hex("test");
		expect(hash).toMatch(/^blake3:[a-f0-9]+$/);
	});

	test("相同输入产生相同哈希", async () => {
		const h1 = await blake3Hex("hello");
		const h2 = await blake3Hex("hello");
		expect(h1).toBe(h2);
	});

	test("不同输入产生不同哈希", async () => {
		const h1 = await blake3Hex("hello");
		const h2 = await blake3Hex("world");
		expect(h1).not.toBe(h2);
	});
});

// ============================================================================
// 3. importRuleset 主函数
// ============================================================================

describe("P09 importRuleset 主函数", () => {
	beforeEach(async () => {
		// 重置内核 rules store + 注入内存 Mock backend(v0.2.0 写入走 WorkspaceBackend)
		resetRulesStore();
		const backend = new MockWorkspaceBackend();
		const ws = await backend.createWorkspace({
			name: "test-workspace",
			owner_id: "tester",
		});
		setActiveWorkspaceBackend(backend);
		currentWorkspace.set(ws);
	});

	test("导入完整规则集(5 条全成功)", async () => {
		const pkg = await buildDjbhRulesetPackage();
		const result = await importRuleset(JSON.stringify(pkg));
		expect(result.imported).toBe(5);
		expect(result.skipped).toBe(0);
		expect(result.importedRuleIds).toHaveLength(5);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("重复导入 + skip 策略 → 全部跳过", async () => {
		const pkg = await buildDjbhRulesetPackage();
		// 第一次导入
		await importRuleset(JSON.stringify(pkg));
		// 第二次用 skip
		const result = await importRuleset(JSON.stringify(pkg), {
			conflictResolution: "skip",
		});
		expect(result.imported).toBe(0);
		expect(result.skipped).toBe(5);
		expect(result.conflicts.length).toBe(5);
	});

	test("重复导入 + rename 策略 → 全部重命名导入", async () => {
		const pkg = await buildDjbhRulesetPackage();
		await importRuleset(JSON.stringify(pkg));
		const result = await importRuleset(JSON.stringify(pkg), {
			conflictResolution: "rename",
		});
		expect(result.imported).toBe(5);
		// v0.2.0:重命名体现在 name(业务标识),返回 id 为 server ULID
		const names = getAllRules().map((r) => r.name);
		for (const rule of pkg.rules) {
			expect(
				names.some((n) => n.startsWith(`user.${rule.id}-imported-`)),
			).toBe(true);
		}
	});

	test("无效 JSON 抛错", async () => {
		await expect(importRuleset("not-json")).rejects.toThrow(/解析失败/);
	});

	test("schemaVersion 不兼容抛错", async () => {
		const badPkg = {
			meta: { schemaVersion: "2.0" },
			rules: [],
			contentHash: "",
		};
		await expect(importRuleset(JSON.stringify(badPkg))).rejects.toThrow(
			/schemaVersion 不兼容/,
		);
	});

	test("rules 字段非数组抛错", async () => {
		const badPkg = {
			meta: { schemaVersion: "1.0", rulesetId: "test", rulesetVersion: "1.0.0" },
			rules: "not-array",
			contentHash: "",
		};
		await expect(importRuleset(JSON.stringify(badPkg))).rejects.toThrow(
			/rules 字段必须是数组/,
		);
	});

	test("contentHash 不匹配仅警告,不阻止导入", async () => {
		const pkg = await buildDjbhRulesetPackage();
		const tamperedPkg: RulesetPackage = {
			...pkg,
			contentHash: "tampered-hash-12345",
		};
		const result = await importRuleset(JSON.stringify(tamperedPkg));
		expect(result.imported).toBe(5);
	});
});
