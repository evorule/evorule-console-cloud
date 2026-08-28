// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// PR9 安全子集 · legacy token 防回潮 lint。
//
// 扫描 src 下的 .svelte / .css / .ts 文件,找出仍在使用旧 token 的「带浅色 hex 回退」写法:
//   var(--color-xxx, #f8fafc) / var(--spacing-xxx, #...) / var(--radius-xxx, #...)
// 这类写法在强制深色作用域(`html:root` 已补齐 --color-text-* 别名)下多数回退已失效,
// 但仍属 PR9 全量清理要消除的 legacy 债务。本脚本用于在 CI / pre-commit 阶段拦截「重新引入」。
//
// 用法:
//   node scripts/lint-legacy-tokens.mjs            # 报告模式(默认),exit 0
//   node scripts/lint-legacy-tokens.mjs --strict  # 发现任何 legacy 回退则 exit 1(用于门禁)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.argv[1] ? process.cwd() : process.cwd();
const SRC = join(ROOT, "src");
const SKIP = new Set(["node_modules", ".svelte-kit", "build", "dist", ".genie-trash"]);
const EXT = new Set([".svelte", ".css", ".ts"]);

// 旧 token 前缀(对应 app.css 计划「全面弃用 --color-* / --spacing-* / --radius-*」)
const LEGACY_RE =
	/var\(\s*(--(?:color|spacing|radius)-[a-z0-9-]+)\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g;

function walk(dir, out) {
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name)) continue;
		const full = join(dir, name);
		const st = statSync(full);
		if (st.isDirectory()) {
			walk(full, out);
		} else if (EXT.has(extname(name))) {
			out.push(full);
		}
	}
}

const files = [];
walk(SRC, files);

const findings = [];
for (const file of files) {
	const lines = readFileSync(file, "utf8").split("\n");
	lines.forEach((line, i) => {
		let m;
		LEGACY_RE.lastIndex = 0;
		while ((m = LEGACY_RE.exec(line))) {
			findings.push({
				file: file.replace(ROOT + "\\", "").replace(ROOT + "/", ""),
				line: i + 1,
				token: m[1],
				fallback: m[2],
			});
		}
	});
}

const strict = process.argv.includes("--strict");

console.log("=== PR9 legacy token lint ===");
console.log(`扫描目录: ${SRC}`);
console.log(`匹配「var(--color|spacing|radius-*, #hex)」回退: ${findings.length} 处\n`);

if (findings.length === 0) {
	console.log("✅ 未发现 legacy token 浅色回退写法。");
	process.exit(0);
}

// 汇总
const byToken = {};
for (const f of findings) {
	byToken[f.token] = (byToken[f.token] || 0) + 1;
}
console.log("按 token 统计:");
for (const [tok, n] of Object.entries(byToken).sort((a, b) => b[1] - a[1])) {
	console.log(`  ${tok}: ${n}`);
}
console.log("\n明细(前 40 条):");
for (const f of findings.slice(0, 40)) {
	console.log(`  ${f.file}:${f.line}  ${f.token} → ${f.fallback}`);
}
if (findings.length > 40) {
	console.log(`  … 其余 ${findings.length - 40} 处省略。`);
}

if (strict) {
	console.log(
		`\n❌ --strict:发现 ${findings.length} 处 legacy 回退,CI 门禁失败。请改用 app.css 新 token(var(--text-primary) 等)。`,
	);
	process.exit(1);
}
console.log(
	`\n⚠️ 报告模式:以上 ${findings.length} 处为已知 legacy 债务(PR9 全量清理范围)。` +
		`加 --strict 可将其变为失败门禁。`,
);
process.exit(0);
