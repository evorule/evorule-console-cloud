// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 静态体检单测 — 转换器(排序/跳过/来源标签/指纹)与执行器(并行/失败单列/红黄绿)。

import { describe, expect, test, vi } from "vitest";
import type { Rule, WorkspaceBackend } from "$lib/kernel";
import type { RuleVersionRecord } from "$lib/kernel/backend/workspace-types";
import { buildRulesetBundle, runCheckup } from "./checkup";

function mkRule(id: string, name: string, currentVersionId: string | null): Rule {
	return {
		id,
		workspaceId: "ws-1",
		name,
		state: "active",
		currentVersionId,
		description: null,
		metadata: "{}",
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
	};
}

function mkVersion(id: string, version: number, transform: unknown[], hash = `h-${id}`): RuleVersionRecord {
	return {
		id,
		rule_id: "r",
		version,
		content_hash: hash,
		content: JSON.stringify({ id, version, transform }),
		created_at: "2026-01-01T00:00:00Z",
		state: "current",
		created_by: "t",
	};
}

const T1 = [{ type: "branch", params: { domain: { type: "all", inner: [] }, on_true: [] } }];
const T2 = [{ type: "set", params: { attr: "x", operation: "set", value: 1 } }];

function mkBackend(versionsByRule: Record<string, RuleVersionRecord[]>): WorkspaceBackend {
	return {
		listRuleVersions: async (_ws: string, ruleId: string) => versionsByRule[ruleId] ?? [],
	} as unknown as WorkspaceBackend;
}

describe("buildRulesetBundle(转换器)", () => {
	test("规则按名排序,来源标签=规则名(逐指令),非 core_eval", async () => {
		const wb = mkBackend({
			b: [mkVersion("v-b", 1, T2)],
			a: [mkVersion("v-a", 1, T1)],
		});
		const bundle = await buildRulesetBundle(wb, "ws-1", [
			mkRule("b", "rule.b", "v-b"),
			mkRule("a", "rule.a", "v-a"),
		]);
		expect(bundle.rules).toHaveLength(2);
		expect(bundle.sources).toEqual(["rule.a", "rule.b"]);
		expect(bundle.sources).not.toContain("core_eval");
		expect(bundle.skipped).toHaveLength(0);
	});

	test("多指令规则逐条打来源标签", async () => {
		const wb = mkBackend({ r1: [mkVersion("v-1", 1, [...T1, ...T2])] });
		const bundle = await buildRulesetBundle(wb, "ws-1", [mkRule("r1", "rule.multi", "v-1")]);
		expect(bundle.rules).toHaveLength(2);
		expect(bundle.sources).toEqual(["rule.multi", "rule.multi"]);
	});

	test("跳过路径三态:无版本/坏 JSON/缺 transform", async () => {
		const wb = mkBackend({
			r2: [{ ...mkVersion("v-2", 1, T1), content: "{not-json" }],
			r3: [mkVersion("v-3", 1, T1, "h3")].map((v) => ({
				...v,
				content: JSON.stringify({ no_transform: true }),
			})),
		});
		const bundle = await buildRulesetBundle(wb, "ws-1", [
			mkRule("r1", "rule.noversion", null),
			mkRule("r2", "rule.badjson", "v-2"),
			mkRule("r3", "rule.notransform", "v-3"),
		]);
		expect(bundle.rules).toHaveLength(0);
		expect(bundle.skipped.map((s) => s.name)).toEqual([
			"rule.badjson",  // 排序确定性:notransform < noversion(字典序)
			"rule.notransform",
			"rule.noversion",
		]);
	});

	test("指纹随内容哈希变化(规则变动即过期)", async () => {
		const wb1 = mkBackend({ r: [mkVersion("v", 1, T1, "hash-a")] });
		const wb2 = mkBackend({ r: [mkVersion("v", 1, T1, "hash-b")] });
		const rule = mkRule("r", "rule.x", "v");
		const b1 = await buildRulesetBundle(wb1, "ws-1", [rule]);
		const b2 = await buildRulesetBundle(wb2, "ws-1", [rule]);
		expect(b1.fingerprint).not.toEqual(b2.fingerprint);
		// 同输入同指纹(确定性)
		const b1b = await buildRulesetBundle(wb1, "ws-1", [rule]);
		expect(b1b.fingerprint).toEqual(b1.fingerprint);
	});
});

describe("runCheckup(执行器)", () => {
	function mkCloud(responses: Record<string, unknown>) {
		return {
			invokeService: vi.fn(async (name: string) => {
				if (name in responses) return responses[name];
				throw new Error(`${name} 服务不可用(模拟故障)`);
			}),
		} as unknown as Parameters<typeof runCheckup>[0];
	}

	test("冲突/环路发现 → 总评红;逐条人话摘要", async () => {
		const cloud = mkCloud({
			inference_conflict_detect: {
				has_conflicts: true,
				conflicts: [{ conflict_type: "contradictory_constants", description: "A 与 B 都写 discount:10 vs 20" }],
			},
			inference_cycle_detect: {
				has_cycles: true,
				static_cycles: [["a#0", "b#1"]],
				unsafe_rules: ["a#0", "b#1"],
			},
			inference_convergence_check: { status: "determined", reasons: [] },
			inference_effect_predict: { effects: [{ id: "r", impact: "low" }] },
		});
		const report = await runCheckup(cloud, { rules: [], sources: [], fingerprint: "f", skipped: [] }, "ws-1");
		expect(report.overall).toBe("red");
		const conflict = report.items.find((i) => i.key === "conflict");
		expect(conflict?.findings[0]).toContain("contradictory_constants");
		expect(conflict?.findings[0]).toContain("discount");
		const cycle = report.items.find((i) => i.key === "cycle");
		expect(cycle?.findings.join(" ")).toContain("a#0 ↔ b#1");
	});

	test("全干净 → 绿;收敛 undetermined → 黄", async () => {
		const clean = mkCloud({
			inference_conflict_detect: { has_conflicts: false, conflicts: [] },
			inference_cycle_detect: { has_cycles: false, static_cycles: [], unsafe_rules: [] },
			inference_convergence_check: { status: "determined", reasons: [] },
			inference_effect_predict: { effects: [] },
		});
		const r1 = await runCheckup(clean, { rules: [], sources: [], fingerprint: "f", skipped: [] }, "ws-1");
		expect(r1.overall).toBe("green");

		const undet = mkCloud({
			inference_conflict_detect: { has_conflicts: false, conflicts: [] },
			inference_cycle_detect: { has_cycles: false, static_cycles: [], unsafe_rules: [] },
			inference_convergence_check: { status: "undetermined", reasons: ["自修改环:undetermined"] },
			inference_effect_predict: { effects: [] },
		});
		const r2 = await runCheckup(undet, { rules: [], sources: [], fingerprint: "f", skipped: [] }, "ws-1");
		expect(r2.overall).toBe("yellow");
	});

	test("单项服务失败单列黄,不阻塞其余项", async () => {
		const cloud = mkCloud({
			inference_conflict_detect: { has_conflicts: false, conflicts: [] },
			inference_cycle_detect: { has_cycles: false, static_cycles: [], unsafe_rules: [] },
			inference_effect_predict: { effects: [] },
			// convergence 缺失 → 抛错
		});
		const report = await runCheckup(cloud, { rules: [], sources: [], fingerprint: "f", skipped: [] }, "ws-1");
		expect(report.overall).toBe("yellow");
		const conv = report.items.find((i) => i.key === "convergence");
		expect(conv?.status).toBe("error");
		expect(conv?.error).toContain("服务不可用");
		const others = report.items.filter((i) => i.key !== "convergence");
		expect(others.every((i) => i.status === "ok")).toBe(true);
	});
});
