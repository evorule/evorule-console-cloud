// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// 规则库静态体检 — workspace 规则 → 合并指令列表 → 四项静态分析 → 红黄绿报告。
//
// 四项(全量单库分析,项目方裁定 D2):
//   conflict_detect 冲突六型学 / cycle_detect 环路 / convergence_check 收敛 /
//   effect_predict 效果分级(读写集影响面)
//   (等价探针需两套规则集,属变更对比场景,不入全量体检)
//
// 诚实边界:静态分析只报告不拦截;服务失败单列不阻塞其余项;
// 报告按规则集指纹绑定,规则变动即视为过期。

import { blake3 } from "@noble/hashes/blake3.js";
import { writable } from "svelte/store";
import { browser } from "$app/environment";
import type { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
import type { Rule, WorkspaceBackend } from "$lib/kernel";
import type { RuleVersionRecord } from "$lib/kernel/backend/workspace-types";

// ============================================================================
// 1. 转换器:workspace 规则 → 推理服务入参(合并指令列表)
// ============================================================================

export interface RulesetBundle {
	rules: unknown[];
	sources: string[];
	/** 规则集指纹(名字@内容哈希 排序连接的 blake3)——报告与规则版本的绑定键 */
	fingerprint: string;
	/** 无法纳入体检的规则(无版本/内容解析失败),报告中单列 */
	skipped: Array<{ name: string; reason: string }>;
}

/**
 * 拉取 workspace 全部规则的当前版本内容并转成推理服务入参。
 * 确定性:规则按 name 排序;指纹覆盖 name+content_hash,规则一变指纹即变。
 */
export async function buildRulesetBundle(
	wsBackend: WorkspaceBackend,
	workspaceId: string,
	listRules: Rule[],
): Promise<RulesetBundle> {
	const entries: Array<{ name: string; hash: string; transform: unknown[] }> = [];
	const skipped: RulesetBundle["skipped"] = [];

	for (const rule of [...listRules].sort((a, b) => a.name.localeCompare(b.name))) {
		if (!rule.currentVersionId) {
			skipped.push({ name: rule.name, reason: "无当前版本(草稿未保存)" });
			continue;
		}
		let versions: RuleVersionRecord[];
		try {
			versions = await wsBackend.listRuleVersions(workspaceId, rule.id);
		} catch (e) {
			skipped.push({ name: rule.name, reason: `版本列表拉取失败:${(e as Error).message}` });
			continue;
		}
		const current =
			versions.find((v) => v.id === rule.currentVersionId) ??
			[...versions].sort((a, b) => b.version - a.version)[0];
		if (!current) {
			skipped.push({ name: rule.name, reason: "版本记录为空" });
			continue;
		}
		let parsed: { transform?: unknown };
		try {
			parsed = JSON.parse(current.content) as { transform?: unknown };
		} catch {
			skipped.push({ name: rule.name, reason: "规则内容不是合法 JSON" });
			continue;
		}
		if (!Array.isArray(parsed.transform)) {
			skipped.push({ name: rule.name, reason: "规则内容缺 transform 数组" });
			continue;
		}
		entries.push({ name: rule.name, hash: current.content_hash, transform: parsed.transform });
	}

	const bundle: RulesetBundle = {
		rules: entries.flatMap((e) => e.transform),
		// 来源标签用规则名(非 core_eval——那是宪法豁免标记,体检不豁免任何规则)
		sources: entries.flatMap((e) => e.transform.map(() => e.name)),
		fingerprint: "",
		skipped,
	};
	bundle.fingerprint = fingerprintOf(entries.map((e) => `${e.name}@${e.hash}`));
	return bundle;
}

function fingerprintOf(parts: string[]): string {
	const bytes = new TextEncoder().encode(parts.join("\n"));
	let hex = "";
	for (const b of blake3(bytes)) hex += b.toString(16).padStart(2, "0");
	return `blake3:${hex.slice(0, 16)}`;
}

// ============================================================================
// 2. 执行器:四服务并行,失败单列
// ============================================================================

export type CheckupVerdict = "green" | "yellow" | "red";

export interface CheckupItem<T = Record<string, unknown>> {
	key: "conflict" | "cycle" | "convergence" | "effect";
	title: string;
	/** ok=服务返回;error=服务失败(单列不阻塞);无 red 级发现 */
	status: "ok" | "error";
	/** 本项判定(发现即红/警告黄/干净绿) */
	verdict: CheckupVerdict;
	/** 人话摘要(每条发现一行) */
	findings: string[];
	raw: T | null;
	error: string | null;
}

export interface CheckupReport {
	ranAt: string;
	workspaceId: string;
	fingerprint: string;
	ruleCount: number;
	skipped: RulesetBundle["skipped"];
	items: CheckupItem[];
	overall: CheckupVerdict;
	/** 全部服务确定性信封(四项同为 determined/bitwise_replayable) */
	determinism: string;
}

export async function runCheckup(
	cloud: CloudHttpBackend,
	bundle: RulesetBundle,
	workspaceId: string,
): Promise<CheckupReport> {
	const payload = { rules: bundle.rules, sources: bundle.sources };
	const defs: Array<{
		key: CheckupItem["key"];
		title: string;
		summarize: (raw: Record<string, unknown>) => { verdict: CheckupVerdict; findings: string[] };
	}> = [
		{
			key: "conflict",
			title: "冲突检测(六型学)",
			summarize: (raw) => {
				const findings = (raw.conflicts as Array<Record<string, unknown>> | undefined ?? []).map(
					(c) => `[${String(c.conflict_type)}] ${String(c.description ?? "")}`,
				);
				return { verdict: findings.length > 0 ? "red" : "green", findings };
			},
		},
		{
			key: "cycle",
			title: "环路检测(Kahn 拓扑)",
			summarize: (raw) => {
				const cycles = raw.static_cycles as unknown[][] | undefined ?? [];
				const unsafe = raw.unsafe_rules as string[] | undefined ?? [];
				const findings = cycles.map((c) => `环:${c.join(" ↔ ")}`);
				if (unsafe.length > 0) findings.push(`拓扑不可排序规则:${unsafe.join(", ")}`);
				return { verdict: findings.length > 0 ? "red" : "green", findings };
			},
		},
		{
			key: "convergence",
			title: "收敛检测",
			summarize: (raw) => {
				const findings: string[] = [];
				let verdict: CheckupVerdict = "green";
				const status = String(raw.convergence ?? raw.status ?? "");
				const reasons = raw.reasons as string[] | undefined ?? [];
				for (const r of reasons) {
					if (String(r).includes("undetermined")) verdict = "yellow";
					findings.push(String(r));
				}
				if (status === "undetermined" && findings.length === 0) {
					verdict = "yellow";
					findings.push("静态不可判定(undetermined 显式)");
				}
				if (String(raw.non_terminating ?? "") === "true" || status === "non_terminating") {
					verdict = "red";
					findings.unshift("存在静态可判定的不终止风险");
				}
				return { verdict, findings };
			},
		},
		{
			key: "effect",
			title: "效果预测(读写集影响面)",
			summarize: (raw) => {
				const items = raw.effects as Array<Record<string, unknown>> | undefined ?? [];
				const findings = items.map(
					(e) => `${String(e.id)}:影响=${String(e.impact)}${e.dynamic ? "(含动态路径)" : ""}`,
				);
				const verdict = items.some((e) => String(e.impact) === "high")
					? "yellow"
					: "green";
				return { verdict, findings };
			},
		},
	];

	const results = await Promise.allSettled(
		defs.map((d) => cloud.invokeService<Record<string, unknown>>(`inference_${d.key === "effect" ? "effect_predict" : d.key === "cycle" ? "cycle_detect" : d.key === "conflict" ? "conflict_detect" : "convergence_check"}`, payload)),
	);

	const items: CheckupItem[] = defs.map((d, i) => {
		const r = results[i];
		if (r.status === "fulfilled") {
			const { verdict, findings } = d.summarize(r.value);
			return { key: d.key, title: d.title, status: "ok", verdict, findings, raw: r.value, error: null };
		}
		return {
			key: d.key,
			title: d.title,
			status: "error",
			verdict: "yellow",
			findings: [],
			raw: null,
			error: (r.reason as Error)?.message ?? String(r.reason),
		};
	});

	const overall: CheckupVerdict = items.some((i) => i.verdict === "red")
		? "red"
		: items.some((i) => i.verdict === "yellow")
			? "yellow"
			: "green";

	return {
		ranAt: new Date().toISOString(),
		workspaceId,
		fingerprint: bundle.fingerprint,
		ruleCount: bundle.sources.length > 0 ? new Set(bundle.sources).size : 0,
		skipped: bundle.skipped,
		items,
		overall,
		determinism: "determined · bitwise_replayable(四项静态分析)",
	};
}

// ============================================================================
// 3. 存档:最近报告(按 workspace)+ 体检门配置(D1 阻断/仅提示)
// ============================================================================

const REPORT_KEY = "evorule-console-cloud:rules-checkup:report";
const GATE_KEY = "evorule-console-cloud:rules-checkup:gate";

export const latestCheckup = writable<CheckupReport | null>(
	browser ? (JSON.parse(localStorage.getItem(REPORT_KEY) ?? "null") as CheckupReport | null) : null,
);
latestCheckup.subscribe((r) => {
	if (!browser) return;
	if (r) localStorage.setItem(REPORT_KEY, JSON.stringify(r));
	else localStorage.removeItem(REPORT_KEY);
});

export const checkupGate = writable<{ blocking: boolean }>(
	browser
		? ((JSON.parse(localStorage.getItem(GATE_KEY) ?? '{"blocking":false}') as { blocking: boolean }))
		: { blocking: false },
);
checkupGate.subscribe((g) => {
	if (!browser) return;
	localStorage.setItem(GATE_KEY, JSON.stringify(g));
});

export function setGateBlocking(blocking: boolean): void {
	checkupGate.set({ blocking });
}

/** 报告对当前规则集是否仍新鲜(指纹一致) */
export function reportIsFresh(report: CheckupReport | null, fingerprint: string): boolean {
	return report !== null && report.fingerprint === fingerprint;
}
