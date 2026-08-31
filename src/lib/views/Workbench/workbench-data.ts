// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 工作台数据派生纯函数(UV-021 W1,从 WorkbenchView 抽出)。
//
// 职责:
//   - deriveStats:4 统计卡数据(规则数/内置/自定义/session/待审/最近 fact)
//   - deriveActivity:最近活动列表(audit 最近 8 条)
//
// 设计:完全纯函数,输入为 store 快照,输出为视图数据——vitest 可覆盖。

/** 规则快照最小形状(kernel rules store 元素) */
export interface RuleSnapshot {
	metadata?: string | null;
}

/** 审计条目最小形状 */
export interface AuditEntrySnapshot {
	logical_time?: number;
	fact_type?: string;
	payload?: { op?: string; attr?: string };
}

/** 安全解析 Rule.metadata(JSON 字符串)→ 失败视为普通规则 */
export function parseBuiltinMetadata(s: string | null | undefined): { builtin?: boolean } {
	if (!s) return {};
	try {
		const obj = JSON.parse(s) as { builtin?: unknown };
		return { builtin: obj.builtin === true };
	} catch {
		return {};
	}
}

export interface WorkbenchStatsData {
	ruleCount: number;
	builtInCount: number;
	customCount: number;
	sessionCount: number;
	pendingCount: number;
	lastFactAt: number | null;
	lastFactType: string | null;
}

export function deriveStats(
	ruleList: RuleSnapshot[],
	sessionCount: number,
	publishPendingCount: number,
	auditEntries: AuditEntrySnapshot[] | undefined,
): WorkbenchStatsData {
	const last = auditEntries?.length ? auditEntries[auditEntries.length - 1] : undefined;
	return {
		ruleCount: ruleList.length,
		builtInCount: ruleList.filter((r) => parseBuiltinMetadata(r.metadata).builtin === true).length,
		customCount: ruleList.filter((r) => parseBuiltinMetadata(r.metadata).builtin !== true).length,
		sessionCount,
		pendingCount: publishPendingCount,
		lastFactAt: typeof last?.logical_time === 'number' ? last.logical_time : null,
		lastFactType: last?.fact_type ?? null,
	};
}

export type ActivitySeverity = 'green' | 'blue' | 'yellow';

export interface ActivityItem {
	factTime: number | null;
	type: string;
	text: string;
	severity: ActivitySeverity;
}

/** 最近活动(audit 末尾 N 条倒序);fact logical_time 作时间显示("fact #N") */
export function deriveActivity(auditEntries: AuditEntrySnapshot[] | undefined, max = 8): ActivityItem[] {
	if (!auditEntries || auditEntries.length === 0) return [];
	return auditEntries
		.slice(-max)
		.reverse()
		.map((e) => {
			const factType = e.fact_type ?? 'unknown';
			const severity: ActivitySeverity =
				factType === 'command' ? 'green' : factType === 'verify' ? 'blue' : 'yellow';
			return {
				factTime: typeof e.logical_time === 'number' ? e.logical_time : null,
				type: factType,
				text:
					factType === 'command'
						? `提交命令 ${e.payload?.op ?? ''} ${e.payload?.attr ?? ''}`.trim()
						: factType === 'verify'
							? '审计链 +1 fact'
							: factType === 'rule'
								? '规则变更'
								: factType,
				severity,
			};
		});
}
