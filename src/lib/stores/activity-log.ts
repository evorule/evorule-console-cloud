// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 用户操作日志 store(P08 §6.8)。
// 持久化:localStorage(key: evorule-console-cloud:activity-log)
//
// 设计:
//   - P0 mock:localStorage,append-only
//   - 限 100 条(FIFO,超限移除最早)
//   - 由前端关键操作触发(登录 / 创建规则 / 提交发布 / 审批 / 回滚 / 等)
//   - 不存储敏感数据(密码 / token)
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.8

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface ActivityEntry {
	id: string;
	userId: string;
	username: string;
	/** 动作标识(login / create_rule / submit_publish / approve_publish / rollback / 等) */
	action: string;
	/** 目标对象 ID(规则 ID / 发布请求 ID 等) */
	target?: string;
	/** 详细描述(可选) */
	detail?: string;
	timestamp: string;
}

const STORAGE_KEY = 'evorule-console-cloud:activity-log';
const MAX_ENTRIES = 100;

function loadLog(): ActivityEntry[] {
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

export const activityLogStore = writable<ActivityEntry[]>(loadLog());

activityLogStore.subscribe((log) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
});

function generateId(): string {
	return `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 追加操作日志(FIFO 限 100 条)。
 */
export function logActivity(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
	const e: ActivityEntry = {
		...entry,
		id: generateId(),
		timestamp: new Date().toISOString(),
	};
	activityLogStore.update((log) => {
		const next = [...log, e]; // append 到末尾(时间正序)
		if (next.length > MAX_ENTRIES) {
			return next.slice(next.length - MAX_ENTRIES);
		}
		return next;
	});
}

/** 列出全部日志(降序,最新在前) */
export function listActivity(): ActivityEntry[] {
	return [...get(activityLogStore)].reverse();
}

/** 按用户过滤 */
export function filterByUser(userId: string): ActivityEntry[] {
	return get(activityLogStore).filter((e) => e.userId === userId);
}

/** 按动作过滤 */
export function filterByAction(action: string): ActivityEntry[] {
	return get(activityLogStore).filter((e) => e.action === action);
}

/** 最近 N 条 */
export function recentActivity(limit = 20): ActivityEntry[] {
	return get(activityLogStore)
		.slice(-limit)
		.reverse();
}

/** 重置(测试用) */
export function resetActivityLog(): void {
	activityLogStore.set([]);
}
