// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 规则编辑悲观锁 store(P08 §6.7)。
// 持久化:localStorage(key: evorule-console-cloud:edit-locks)
//
// 设计:
//   - P0 mock:localStorage 模拟悲观锁(真实后端用 Redis/DB)
//   - 锁定时长 30 分钟,过期自动释放
//   - heartbeat 续期 5 分钟(累计上限 30 分钟,防无限续期)
//   - 同一 ruleId 同时只能被一个用户持有
//   - 持有者可主动 release;非持有者 acquire 失败(返回 heldBy)
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.7

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export interface EditLock {
	ruleId: string;
	lockedBy: string;
	lockedAt: number; // ms 时间戳
	expiresAt: number; // ms 时间戳
	/** 累计续期次数(防无限续期) */
	heartbeatCount: number;
}

const STORAGE_KEY = 'evorule-console-cloud:edit-locks';

/** 锁定时长:30 分钟(ms) */
export const LOCK_DURATION_MS = 30 * 60 * 1000;
/** 心跳续期时长:5 分钟(ms) */
export const HEARTBEAT_EXTEND_MS = 5 * 60 * 1000;
/** 最大心跳次数(防无限续期) */
export const MAX_HEARTBEATS = 5;
/** 过期检查:锁过期超过此时间则清理(此处与 expiresAt 等价) */

function loadLocks(): EditLock[] {
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

export const editLocksStore = writable<EditLock[]>(loadLocks());

editLocksStore.subscribe((locks) => {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(locks));
});

/** 当前时间戳(ms) */
function now(): number {
	return Date.now();
}

/**
 * 清理过期锁(每次 acquire / isLocked 前调用)。
 */
export function cleanExpiredLocks(): void {
	const t = now();
	editLocksStore.update((locks) => locks.filter((l) => l.expiresAt > t));
}

/**
 * 获取规则锁(若存在且未过期)。
 * @returns 锁对象(null = 无锁或已过期)
 */
export function isLocked(ruleId: string): EditLock | null {
	cleanExpiredLocks();
	return get(editLocksStore).find((l) => l.ruleId === ruleId) ?? null;
}

/**
 * 获取规则锁。
 * @returns { success, heldBy? }  成功返回 { success: true };失败返回 heldBy(持有者 userId)
 */
export function acquireLock(
	ruleId: string,
	userId: string,
): { success: boolean; heldBy?: string } {
	cleanExpiredLocks();
	const existing = get(editLocksStore).find((l) => l.ruleId === ruleId);
	if (existing) {
		// 持有者重复 acquire:续期(等同于 heartbeat)
		if (existing.lockedBy === userId) {
			editLocksStore.update((locks) =>
				locks.map((l) =>
					l.ruleId === ruleId && l.lockedBy === userId
						? { ...l, expiresAt: now() + LOCK_DURATION_MS }
						: l,
				),
			);
			return { success: true };
		}
		// 被他人持有
		return { success: false, heldBy: existing.lockedBy };
	}
	// 无锁,创建
	const t = now();
	const lock: EditLock = {
		ruleId,
		lockedBy: userId,
		lockedAt: t,
		expiresAt: t + LOCK_DURATION_MS,
		heartbeatCount: 0,
	};
	editLocksStore.update((locks) => [...locks, lock]);
	return { success: true };
}

/**
 * 释放锁(仅持有者可释放)。
 */
export function releaseLock(ruleId: string, userId: string): void {
	editLocksStore.update((locks) =>
		locks.filter((l) => !(l.ruleId === ruleId && l.lockedBy === userId)),
	);
}

/**
 * 心跳续期(仅持有者可续期,最多 MAX_HEARTBEATS 次)。
 * @returns { success, reason? }
 */
export function heartbeat(
	ruleId: string,
	userId: string,
): { success: boolean; reason?: string } {
	const existing = get(editLocksStore).find(
		(l) => l.ruleId === ruleId && l.lockedBy === userId,
	);
	if (!existing) {
		return { success: false, reason: '未持有锁' };
	}
	if (existing.heartbeatCount >= MAX_HEARTBEATS) {
		return { success: false, reason: '超过最大续期次数' };
	}
	editLocksStore.update((locks) =>
		locks.map((l) =>
			l.ruleId === ruleId && l.lockedBy === userId
				? {
						...l,
						expiresAt: l.expiresAt + HEARTBEAT_EXTEND_MS,
						heartbeatCount: l.heartbeatCount + 1,
					}
				: l,
		),
	);
	return { success: true };
}

/** 当前用户持有的全部锁 */
export function myLocks(userId: string): EditLock[] {
	cleanExpiredLocks();
	return get(editLocksStore).filter((l) => l.lockedBy === userId);
}

/** 重置(测试用) */
export function resetEditLocks(): void {
	editLocksStore.set([]);
}
