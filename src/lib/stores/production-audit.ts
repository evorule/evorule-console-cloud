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
	/** 关联的发布请求 ID(后端记录无此字段,默认空串) */
	publishRequestId?: string;
	/** 若为回滚产生的版本,指向被回滚的版本号 */
	rollbackOf?: number;
	notes: string;
}

/**
 * evorule-server production_audit 原始记录(snake_case)。
 * 对齐 core/workspace/src/models.rs::ProductionAuditRecord。
 */
export interface ProductionAuditRecordServer {
	id: number;
	/** publish_submitted / publish_reviewed / ruleset_published / ruleset_rollback */
	event_type: string;
	/** 生命周期事件记录的是"当时的生产版本";发布/回滚事件才是新版本号 */
	ruleset_version: number;
	previous_version: number | null;
	ruleset_hash: string;
	tcb_session_id: number;
	source_workspace_ids: string;
	operated_by: string;
	operated_at: string;
	reason: string | null;
	test_report_paths: string | null;
	ruleset_snapshot: string | null;
}

/**
 * 拉取发布审计并适配为版本历史(GET /api/production/audit)。
 *
 * 仅保留**产生新版本**的事件(ruleset_published / ruleset_rollback):
 * publish_submitted / publish_reviewed 是生命周期节点,不改变版本号,
 * 若不过滤会得到重复的版本号,污染时间线。
 *
 * 语义:
 *   - 成功 → 返回版本历史数组(空数组 = 确实无版本事件)
 *   - 失败(网络错误 / 非 2xx / 响应非数组)→ 抛 Error,由调用方展示错误状态
 *
 * 为什么抛错而非返回空数组:
 *   返回空数组无法区分"无版本"与"后端不可达",会掩盖后端故障
 *   (见 F3 偏差修正)。调用方 catch 后展示明确错误,不静默降级。
 */
export async function fetchProductionAudit(
  baseUrl: string,
): Promise<VersionHistoryEntry[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/production/audit?limit=50`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`获取版本历史失败(${r.status})`);
  }
  const raw = (await r.json()) as ProductionAuditRecordServer[];
  if (!Array.isArray(raw)) {
    throw new Error('版本历史响应格式异常(期望数组)');
  }
  return raw
    .filter(
      (rec) =>
        rec.event_type === 'ruleset_published' ||
        rec.event_type === 'ruleset_rollback',
    )
    .map((rec) => ({
      version: rec.ruleset_version,
      rulesetHash: rec.ruleset_hash,
      publishedAt: rec.operated_at,
      publishedBy: rec.operated_by,
      // 仅回滚事件标注 rollbackOf;published 事件的 previous_version 是前序版本,非回滚来源
      rollbackOf:
        rec.event_type === 'ruleset_rollback'
          ? (rec.previous_version ?? undefined)
          : undefined,
      notes: rec.reason ?? '',
    }));
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
