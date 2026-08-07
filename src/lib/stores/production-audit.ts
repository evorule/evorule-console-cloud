// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 生产审计 / 版本历史 store(P08 §6.4)。
// 持久化:localStorage(key: evorule-console-cloud:production-audit)
//
// 设计:
//   - P0 mock:localStorage,对齐第四梯队 production_audit 表结构
//   - 每次 publishPublish 成功后,appendVersion 追加一条历史
//   - 紧急回滚后,appendVersion 追加一条 rollbackOf 记录
//   - 版本号单调递增(回滚后新版本号继续递增,不回退)
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.4 + 第四梯队 production_audit 表

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface VersionHistoryEntry {
	/** 生产版本号(单调递增,从 1 开始) */
	version: number;
	/** 规则集 BLAKE3 哈希 */
	rulesetHash: string;
	publishedAt: string;
	publishedBy: string;
	/** 关联的发布请求 ID */
	publishRequestId: string;
	/** 若为回滚产生的版本,指向被回滚的版本号 */
	rollbackOf?: number;
	notes: string;
}

const STORAGE_KEY = 'evorule-console-cloud:production-audit';

function loadHistory(): VersionHistoryEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export const productionAuditStore = writable<VersionHistoryEntry[]>(loadHistory());

// 持久化
productionAuditStore.subscribe((history) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
});

/**
 * 追加版本历史(发布或回滚时调用)。
 * 版本号 = 当前最大版本 + 1(单调递增)。
 */
export function appendVersion(
	entry: Omit<VersionHistoryEntry, 'version'>,
): number {
	const current = get(productionAuditStore);
	const maxVersion = current.reduce((max, e) => Math.max(max, e.version), 0);
	const newVersion = maxVersion + 1;
	const newEntry: VersionHistoryEntry = { ...entry, version: newVersion };
	productionAuditStore.update((h) => [...h, newEntry]);
	return newVersion;
}

/** 当前生产版本号(最新一条;空历史返回 0) */
export function currentVersion(): number {
	const h = get(productionAuditStore);
	if (h.length === 0) return 0;
	return h[h.length - 1].version;
}

/** 当前生产版本的哈希(空历史返回空串) */
export function currentRulesetHash(): string {
	const h = get(productionAuditStore);
	if (h.length === 0) return '';
	return h[h.length - 1].rulesetHash;
}

/** 按版本号查历史 */
export function getVersion(version: number): VersionHistoryEntry | undefined {
	return get(productionAuditStore).find((e) => e.version === version);
}

/** 列出全部历史(降序,最新在前) */
export function listHistory(): VersionHistoryEntry[] {
	return [...get(productionAuditStore)].sort((a, b) => b.version - a.version);
}

/** 重置历史(测试用) */
export function resetProductionAudit(): void {
	productionAuditStore.set([]);
}
