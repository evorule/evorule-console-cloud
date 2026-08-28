// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — 生产域视图模型与映射层(B5 旁路 store 收敛)
//
// 职责:
//   - 定义发布队列/生产状态/版本历史的 UI 视图类型(camelCase)
//   - 内核 WorkspaceBackend 记录类型(snake_case,对齐 server models.rs)→ 视图模型映射
//   - 前端角色 → 后端 PublishRole 映射
//
// 收敛历史(2026-08-28,旁路 store 收敛专项):
//   本文件承接原 stores/publish-queue-api.ts、stores/production-audit.ts 的类型与
//   纯映射函数;server 访问统一收敛到内核 WorkspaceBackend 方法(带 Bearer token),
//   旁路 fetch 函数已删除。原"双通道发布审批"的 localStorage 本地状态机
//   (stores/publish-queue.ts)已废弃删除,审批链路单通道走 server。

import type {
	PublishQueueItem,
	ProductionAuditRecord,
	ProductionStateRecord,
} from '$lib/kernel';

// ============================================================================
// 生产运行状态
// ============================================================================

export interface ProductionState {
	/** 当前生产 session 的 tcb session_id(SessionManager 返回) */
	currentSessionId: number | null;
	/** 当前规则集版本号(单调递增,0 = 未发布) */
	rulesetVersion: number;
	/** 当前规则集 BLAKE3 哈希 */
	rulesetHash: string | null;
	/** 运行状态:running(正常)/ switching(滚动 session 切换中)/ offline */
	status: 'running' | 'switching' | 'offline';
	/** 最后更新时间(ISO 字符串) */
	updatedAt: string | null;
}

export const DEFAULT_PRODUCTION_STATE: ProductionState = {
	currentSessionId: null,
	rulesetVersion: 0,
	rulesetHash: null,
	status: 'offline',
	updatedAt: null,
};

/**
 * server ProductionStateRecord → cloud ProductionState。
 *
 * # status 推导(server 记录不含 status 字段)
 * - `current_session_id == null` → "offline"(未发布或 session 已关闭)
 * - `current_session_id != null` → "running"(有活跃生产 session)
 * - "switching" 是瞬态,仅由 SSE `session_switched` 事件临时设置,不来自轮询
 */
export function mapProductionStateRecord(
	rec: Partial<ProductionStateRecord>,
): ProductionState {
	const currentSessionId =
		typeof rec.current_session_id === 'number' ? rec.current_session_id : null;
	return {
		currentSessionId,
		rulesetVersion:
			typeof rec.ruleset_version === 'number' ? rec.ruleset_version : 0,
		rulesetHash: typeof rec.ruleset_hash === 'string' ? rec.ruleset_hash : null,
		status: currentSessionId === null ? 'offline' : 'running',
		updatedAt:
			typeof rec.updated_at === 'string' ? rec.updated_at : null,
	};
}

// ============================================================================
// 发布队列
// ============================================================================

/** 后端发布队列状态(与前端 mock 状态对齐映射后使用)。 */
export type BackendPublishStatus =
	| 'pending'
	| 'approved'
	| 'published'
	| 'rejected'
	| 'cancelled';

/** 适配后的发布队列项(UI 消费,camelCase)。 */
export interface PublishQueueItemView {
	/** 队列项 ID(后端数字转字符串,便于与 mock 的字符串 ID 统一) */
	id: string;
	/** 展示用版本号(published 后为实际发布版本,pending 为 0) */
	rulesetVersion: number;
	submittedBy: string;
	submittedAt: string;
	status: BackendPublishStatus;
	reviewedBy?: string;
	reviewedAt?: string;
	reviewComment?: string;
	publishedAt?: string;
	description?: string;
}

/** 写入操作结果(approve/reject/rollback 共用)。 */
export interface PublishWriteResult {
	ok: boolean;
	error?: string;
}

/**
 * 前端角色 → 后端 PublishRole 映射。
 *
 * evorule-server PublishRole:doctor / department_head / admin。
 * 前端 5 角色:
 *   - user(医生)      → doctor(不可提交/审批)
 *   - lead(科室主任)   → department_head(可提交)
 *   - it(信息科)       → admin(可审批+回滚)
 *   - exec(院领导)     → admin(可审批+回滚)
 *   - auditor(审计)    → doctor(只读)
 */
export function roleToBackend(role: string): string {
	switch (role) {
		case 'it':
		case 'exec':
			return 'admin';
		case 'lead':
			return 'department_head';
		case 'user':
		case 'auditor':
		default:
			return 'doctor';
	}
}

/** 后端队列项 → UI 视图(字段映射 + 类型归一)。 */
export function mapPublishQueueItem(item: PublishQueueItem): PublishQueueItemView {
	return {
		id: String(item.id),
		rulesetVersion: item.published_version ?? 0,
		submittedBy: item.submitted_by,
		submittedAt: item.submitted_at,
		status: item.status,
		reviewedBy: item.reviewed_by ?? undefined,
		reviewedAt: item.reviewed_at ?? undefined,
		reviewComment: item.review_comment ?? undefined,
		publishedAt: item.published_at ?? undefined,
		description: item.description ?? undefined,
	};
}

// ============================================================================
// 版本历史(生产审计)
// ============================================================================

export interface VersionHistoryEntry {
	/** 生产版本号(单调递增,从 1 开始) */
	version: number;
	/** 规则集 BLAKE3 哈希 */
	rulesetHash: string;
	publishedAt: string;
	publishedBy: string;
	/** 若为回滚产生的版本,指向被回滚的版本号 */
	rollbackOf?: number;
	notes: string;
}

/**
 * server production_audit 记录 → 版本历史视图。
 *
 * 仅保留**产生新版本**的事件(ruleset_published / ruleset_rollback):
 * publish_submitted / publish_reviewed 是生命周期节点,不改变版本号,
 * 若不过滤会得到重复的版本号,污染时间线。
 */
export function mapProductionAuditRecords(
	records: ProductionAuditRecord[],
): VersionHistoryEntry[] {
	return records
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
