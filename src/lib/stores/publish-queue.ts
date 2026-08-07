// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 发布队列 store(P08 §6.3)。
// 持久化:localStorage(key: evorule-console-cloud:publish-queue)
//
// 设计:
//   - P0 mock:localStorage 状态机,无后端调用
//   - 状态机:draft → submitted → reviewing → approved/rejected → published
//                  ↓                              ↓
//               (取消,不进队列)            rolled_back(紧急回滚)
//   - 紧急回滚:published 状态的请求可被 it/exec 回滚 → 新增 rolled_back 记录
//   - 版本号:每次 published 递增 rulesetVersion
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.3 + PUBLISH_QUEUE_DESIGN.md

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export type PublishStatus =
	| 'draft'
	| 'submitted'
	| 'reviewing'
	| 'approved'
	| 'rejected'
	| 'published'
	| 'rolled_back';

export interface PublishRequest {
	id: string;
	/** 待发布的规则集版本号(草稿号) */
	rulesetVersion: number;
	submittedBy: string;
	submittedAt: string;
	status: PublishStatus;
	reviewedBy?: string;
	reviewedAt?: string;
	reviewComment?: string;
	publishedAt?: string;
	/** 紧急回滚时间(rolled_back 状态用) */
	emergencyRollbackAt?: string;
	rolledBackBy?: string;
}

const STORAGE_KEY = 'evorule-console-cloud:publish-queue';

function loadQueue(): PublishRequest[] {
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

export const publishQueueStore = writable<PublishRequest[]>(loadQueue());

// 持久化
publishQueueStore.subscribe((queue) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
});

function generateId(): string {
	return `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 提交发布请求(lead 角色调用)。
 * @param rulesetVersion 草稿版本号
 * @param submittedBy 提交人 userId
 * @returns 请求 ID
 */
export function submitPublish(
	rulesetVersion: number,
	submittedBy: string,
): string {
	const id = generateId();
	const req: PublishRequest = {
		id,
		rulesetVersion,
		submittedBy,
		submittedAt: new Date().toISOString(),
		status: 'submitted',
	};
	publishQueueStore.update((q) => [req, ...q]);
	return id;
}

/**
 * 开始审核(it/exec 角色调用)。
 * submitted → reviewing
 */
export function startReview(id: string, reviewedBy: string): void {
	publishQueueStore.update((q) =>
		q.map((r) =>
			r.id === id && r.status === 'submitted'
				? { ...r, status: 'reviewing', reviewedBy, reviewedAt: new Date().toISOString() }
				: r,
		),
	);
}

/**
 * 审批通过(it/exec 角色调用)。
 * reviewing → approved → published(自动转)
 */
export function approvePublish(
	id: string,
	reviewedBy: string,
	comment: string,
): void {
	publishQueueStore.update((q) =>
		q.map((r) => {
			if (r.id !== id) return r;
			if (r.status !== 'reviewing') return r;
			return {
				...r,
				status: 'published' as PublishStatus,
				reviewedBy,
				reviewedAt: new Date().toISOString(),
				reviewComment: comment,
				publishedAt: new Date().toISOString(),
			};
		}),
	);
}

/**
 * 审批驳回(it/exec 角色调用)。
 * reviewing → rejected
 */
export function rejectPublish(
	id: string,
	reviewedBy: string,
	comment: string,
): void {
	publishQueueStore.update((q) =>
		q.map((r) => {
			if (r.id !== id) return r;
			if (r.status !== 'reviewing') return r;
			return {
				...r,
				status: 'rejected' as PublishStatus,
				reviewedBy,
				reviewedAt: new Date().toISOString(),
				reviewComment: comment,
			};
		}),
	);
}

/**
 * 紧急回滚(it/exec 角色调用)。
 * published → rolled_back
 */
export function emergencyRollback(id: string, by: string): void {
	publishQueueStore.update((q) =>
		q.map((r) => {
			if (r.id !== id) return r;
			if (r.status !== 'published') return r;
			return {
				...r,
				status: 'rolled_back' as PublishStatus,
				emergencyRollbackAt: new Date().toISOString(),
				rolledBackBy: by,
			};
		}),
	);
}

/** 按 ID 查请求 */
export function getPublishRequest(id: string): PublishRequest | undefined {
	return get(publishQueueStore).find((r) => r.id === id);
}

/** 按状态过滤 */
export function filterByStatus(status: PublishStatus): PublishRequest[] {
	return get(publishQueueStore).filter((r) => r.status === status);
}

/** 当前待审核数量(submitted + reviewing) */
export function pendingReviewCount(): number {
	return get(publishQueueStore).filter(
		(r) => r.status === 'submitted' || r.status === 'reviewing',
	).length;
}

/** 已发布版本号列表(降序) */
export function publishedVersions(): number[] {
	return get(publishQueueStore)
		.filter((r) => r.status === 'published')
		.map((r) => r.rulesetVersion)
		.sort((a, b) => b - a);
}

/** 重置队列(测试用) */
export function resetPublishQueue(): void {
	publishQueueStore.set([]);
}
