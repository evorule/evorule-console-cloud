// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 帮助文档索引(PR10-重2)。
// 在构建期惰性加载 docs/ 下全部 markdown 原文,解析标题与正文,
// 提供 searchHelpDocs() 供「帮助中心」弹窗做内嵌全文搜索。
//
// 注意:字符串内强调引号统一用中文全角引号 ""(U+201C/U+201D),
// 切勿使用 ASCII 半角双引号 ",否则会提前闭合字符串导致编译错误。

interface DocEntry {
	/** 文件相对路径(调试用) */
	path: string;
	/** 文档标题(取首个 # 一级标题,缺失则回退文件名) */
	title: string;
	/** 去噪后的纯文本(供搜索与片段截取) */
	text: string;
}

// Vite 构建期把 docs/ 下所有 markdown 以原文字符串形式打入包体(eager)。
// 相对当前文件(src/lib/data/)向上 3 级即项目根,再进入 docs。
// 注: 旧写法 `as: 'raw'` 已被 Vite 标记弃用,改用 `query: '?raw', import: 'default'`。
const modules = import.meta.glob('../../../docs/**/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

function stripNoise(raw: string): string {
	return raw
		// 去 HTML 注释(文档导航说明等)
		.replace(/<!--[\s\S]*?-->/g, ' ')
		// 去代码块(```…``` / `…`)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`]*`/g, ' ')
		// 去 markdown 语法噪音(# * > _ | - 等),保留可读文字
		.replace(/[#>*_|`]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function titleOf(raw: string, path: string): string {
	const firstHeading = raw.split('\n').find((l) => l.startsWith('# '));
	if (firstHeading) return firstHeading.replace(/^#\s+/, '').trim();
	const leaf = path.split('/').pop() ?? path;
	return leaf.replace(/\.md$/, '');
}

const DOCS: DocEntry[] = Object.entries(modules).map(([path, raw]) => ({
	path,
	title: titleOf(raw, path),
	text: stripNoise(raw)
}));

export interface DocHit {
	path: string;
	title: string;
	/** 截取自正文的片段(已省略首尾) */
	snippet: string;
}

/**
 * 在 docs/ 全文中检索查询词,返回按匹配度排序的文档命中。
 * 多词查询取所有词都出现(AND)的文档,按命中词数降序。
 */
export function searchHelpDocs(q: string, limit = 6): DocHit[] {
	const k = q.trim().toLowerCase();
	if (!k) return [];
	const terms = k.split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];

	const scored: Array<DocHit & { score: number }> = [];
	for (const d of DOCS) {
		const hay = d.text.toLowerCase();
		let score = 0;
		for (const t of terms) {
			if (hay.includes(t)) score += 1;
		}
		// 必须全部词命中(AND),否则跳过
		if (score < terms.length) continue;

		const idx = hay.indexOf(terms[0]);
		const start = Math.max(0, idx - 36);
		const rawSnippet = d.text.slice(start, start + 150);
		const snippet =
			(idx > 36 ? '…' : '') + rawSnippet.replace(/\s+/g, ' ').trim() + '…';

		scored.push({ path: d.path, title: d.title, snippet, score });
	}

	return scored
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ score, ...hit }) => hit);
}

/** 文档总数(调试/统计用) */
export const HELP_DOC_COUNT = DOCS.length;
