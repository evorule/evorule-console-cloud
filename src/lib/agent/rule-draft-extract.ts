// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// Agent 会话消息 → 规则草案 JSON 提取(会话台「转规则草稿」入口的纯函数)
//
// 提取口径:优先取首个 ```json(或裸 ```)围栏代码块,整块可解析为 JSON
// 对象即采用;否则回退尝试整条消息文本。数组/标量不视为规则草案,返回 null
// (草稿纪律:提取失败就不给入口,不猜)。

/** 从 agent 消息文本提取可预填的规则草案 JSON(格式化;无则 null) */
export function extractRuleDraftJson(text: string): string | null {
	const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
	const candidates: string[] = [];
	if (fenced) candidates.push(fenced[1]);
	candidates.push(text);
	for (const candidate of candidates) {
		const s = candidate.trim();
		if (!s.startsWith('{')) continue;
		try {
			const parsed: unknown = JSON.parse(s);
			if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return JSON.stringify(parsed, null, 2);
			}
		} catch {
			// 尝试下一候选
		}
	}
	return null;
}

/** 消息摘要(去掉代码块并折叠空白;作草稿来源描述,超长截断) */
export function messageDraftSummary(text: string, maxLen = 50): string {
	const prose = text
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!prose) return '';
	return prose.length > maxLen ? `${prose.slice(0, maxLen)}...` : prose;
}
