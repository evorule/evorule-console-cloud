// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P08 edit-lock 单测 — acquire/release/heartbeat/过期清理/冲突
//
// 运行: npx vitest run src/lib/stores/__tests__/edit-lock.test.ts

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { get as storeGet } from 'svelte/store';
import {
	editLocksStore,
	acquireLock,
	releaseLock,
	heartbeat,
	isLocked,
	cleanExpiredLocks,
	myLocks,
	resetEditLocks,
	LOCK_DURATION_MS,
	MAX_HEARTBEATS,
} from '../edit-lock';

beforeEach(() => {
	resetEditLocks();
	vi.useRealTimers(); // 默认真实时间
});

// ============================================================================
// 1. acquireLock
// ============================================================================

describe('P08 acquireLock', () => {
	test('首次获取锁成功', () => {
		const result = acquireLock('rule-1', 'u-doctor');
		expect(result.success).toBe(true);
		expect(result.heldBy).toBeUndefined();

		const lock = isLocked('rule-1');
		expect(lock).not.toBeNull();
		expect(lock!.lockedBy).toBe('u-doctor');
		expect(lock!.heartbeatCount).toBe(0);
	});

	test('持有者重复 acquire:续期成功(expiresAt 更新)', () => {
		const r1 = acquireLock('rule-1', 'u-doctor');
		expect(r1.success).toBe(true);
		const lock1 = isLocked('rule-1');

		// 等待 1ms 确保时间戳变化
		const realNow = Date.now;
		Date.now = () => realNow() + 1000;
		const r2 = acquireLock('rule-1', 'u-doctor');
		Date.now = realNow;

		expect(r2.success).toBe(true);
		const lock2 = isLocked('rule-1');
		expect(lock2!.expiresAt).toBeGreaterThan(lock1!.expiresAt);
	});

	test('他人持有锁:acquire 失败 + 返回 heldBy', () => {
		acquireLock('rule-1', 'u-doctor');
		const result = acquireLock('rule-1', 'u-lead');
		expect(result.success).toBe(false);
		expect(result.heldBy).toBe('u-doctor');
	});
});

// ============================================================================
// 2. releaseLock
// ============================================================================

describe('P08 releaseLock', () => {
	test('持有者释放:锁消失', () => {
		acquireLock('rule-1', 'u-doctor');
		expect(isLocked('rule-1')).not.toBeNull();

		releaseLock('rule-1', 'u-doctor');
		expect(isLocked('rule-1')).toBeNull();
	});

	test('非持有者释放:无效(锁仍存在)', () => {
		acquireLock('rule-1', 'u-doctor');
		releaseLock('rule-1', 'u-lead'); // 非持有者
		expect(isLocked('rule-1')).not.toBeNull();
		expect(isLocked('rule-1')!.lockedBy).toBe('u-doctor');
	});

	test('释放不存在的锁:无副作用', () => {
		expect(() => releaseLock('nonexistent', 'u-doctor')).not.toThrow();
	});
});

// ============================================================================
// 3. heartbeat(续期)
// ============================================================================

describe('P08 heartbeat', () => {
	test('持有者续期成功:expiresAt 增加 + heartbeatCount+1', () => {
		acquireLock('rule-1', 'u-doctor');
		const lock1 = isLocked('rule-1');

		const result = heartbeat('rule-1', 'u-doctor');
		expect(result.success).toBe(true);

		const lock2 = isLocked('rule-1');
		expect(lock2!.heartbeatCount).toBe(1);
		expect(lock2!.expiresAt).toBeGreaterThan(lock1!.expiresAt);
	});

	test('非持有者续期失败', () => {
		acquireLock('rule-1', 'u-doctor');
		const result = heartbeat('rule-1', 'u-lead');
		expect(result.success).toBe(false);
		expect(result.reason).toBe('未持有锁');
	});

	test('未持有锁续期失败', () => {
		const result = heartbeat('nonexistent', 'u-doctor');
		expect(result.success).toBe(false);
		expect(result.reason).toBe('未持有锁');
	});

	test('超过 MAX_HEARTBEATS 次续期失败', () => {
		acquireLock('rule-1', 'u-doctor');
		// 续期 MAX_HEARTBEATS 次(应全部成功)
		for (let i = 0; i < MAX_HEARTBEATS; i++) {
			const r = heartbeat('rule-1', 'u-doctor');
			expect(r.success).toBe(true);
		}
		// 第 MAX_HEARTBEATS+1 次应失败
		const r = heartbeat('rule-1', 'u-doctor');
		expect(r.success).toBe(false);
		expect(r.reason).toBe('超过最大续期次数');
	});
});

// ============================================================================
// 4. 过期清理
// ============================================================================

describe('P08 过期锁清理', () => {
	test('过期锁在 isLocked 时自动清理', () => {
		acquireLock('rule-1', 'u-doctor');
		// 手动把 expiresAt 改为过去
		editLocksStore.update((locks) =>
			locks.map((l) => ({ ...l, expiresAt: Date.now() - 1000 })),
		);

		// isLocked 触发 cleanExpiredLocks
		expect(isLocked('rule-1')).toBeNull();
		expect(storeGet(editLocksStore)).toHaveLength(0);
	});

	test('cleanExpiredLocks 清理多个过期锁,保留有效锁', () => {
		acquireLock('rule-1', 'u-doctor');
		acquireLock('rule-2', 'u-lead');
		acquireLock('rule-3', 'u-admin');

		// 把 rule-1 和 rule-2 设为过期
		editLocksStore.update((locks) =>
			locks.map((l) =>
				l.ruleId === 'rule-1' || l.ruleId === 'rule-2'
					? { ...l, expiresAt: Date.now() - 1000 }
					: l,
			),
		);

		cleanExpiredLocks();
		const locks = storeGet(editLocksStore);
		expect(locks).toHaveLength(1);
		expect(locks[0].ruleId).toBe('rule-3');
	});
});

// ============================================================================
// 5. isLocked + myLocks
// ============================================================================

describe('P08 isLocked / myLocks', () => {
	test('isLocked 返回锁对象或 null', () => {
		expect(isLocked('rule-1')).toBeNull();
		acquireLock('rule-1', 'u-doctor');
		const lock = isLocked('rule-1');
		expect(lock).not.toBeNull();
		expect(lock!.ruleId).toBe('rule-1');
	});

	test('myLocks 返回当前用户持有的全部锁', () => {
		acquireLock('rule-1', 'u-doctor');
		acquireLock('rule-2', 'u-doctor');
		acquireLock('rule-3', 'u-lead');

		const myLocksList = myLocks('u-doctor');
		expect(myLocksList).toHaveLength(2);
		expect(myLocksList.map((l) => l.ruleId).sort()).toEqual([
			'rule-1',
			'rule-2',
		]);
	});

	test('myLocks 无锁返回空数组', () => {
		acquireLock('rule-1', 'u-lead');
		expect(myLocks('u-doctor')).toHaveLength(0);
	});
});

// ============================================================================
// 6. 锁定时长常量
// ============================================================================

describe('P08 锁常量', () => {
	test('LOCK_DURATION_MS = 30 分钟', () => {
		expect(LOCK_DURATION_MS).toBe(30 * 60 * 1000);
	});

	test('MAX_HEARTBEATS = 5', () => {
		expect(MAX_HEARTBEATS).toBe(5);
	});
});
