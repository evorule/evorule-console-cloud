// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则集加载器 —— 从 static/rules/ fetch 五个规则文件,合并 transform 数组为单一规则集 JSON。
//
// 关键约束(核对 evorule-wasm-demo/src/lib.rs load_rules):
//   load_rules(rules_json) 是「覆盖赋值」(self.rules = ...),不是追加。
//   因此必须把所有文件的 transform 数组合并成一个大数组,一次性 load_rules,
//   否则后加载的会覆盖先加载的。
//
// 合并顺序(73 文档 §5.2):
//   core_eval(宪法/TCB 基础指令语义) → finance → medical → djbh → role13_demo(io_request 剧本)
//
// 关于 core_eval:有状态的 EvoRuleEngine::new() 不自动加载 include_str! 内置宪法,
// 故必须显式从 static/rules/core_eval.json 加载(72 文档 §10 风险点 1)。

import { base } from "$app/paths";

/** 合并顺序即此数组顺序 */
const RULE_FILES = [
	"core_eval.json",
	"20_finance_rules.json",
	"21_medical_rules.json",
	"22_djbh_rules.json",
	"10_role13_demo.json",
] as const;

/**
 * 拉取全部规则文件并合并为一个完整的 transform 规则数组 JSON 字符串。
 * 返回裸数组(load_rules 同时接受裸数组或 {transform:[...]} 对象)。
 */
export async function loadAllRules(): Promise<string> {
	const combined: unknown[] = [];
	for (const file of RULE_FILES) {
		const resp = await fetch(`${base}/rules/${file}`);
		if (!resp.ok) {
			throw new Error(`规则文件加载失败: ${file} (HTTP ${resp.status})`);
		}
		const obj: unknown = await resp.json();
		const arr = Array.isArray(obj)
			? obj
			: (obj as { transform?: unknown }).transform;
		if (!Array.isArray(arr)) {
			throw new Error(`规则文件缺少 transform 数组: ${file}`);
		}
		combined.push(...(arr as unknown[]));
	}
	return JSON.stringify(combined);
}
