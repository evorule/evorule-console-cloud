// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P08 auth 单测 — loginAs / logout / can / 与 session.ts 协同
//
// 运行: npx vitest run src/lib/stores/__tests__/auth.test.ts
//
// 注:测试在 node 环境运行(browser=false),localStorage 不可用。
//     auth.ts 的 loadUser/persistUser 在 node 静默返回 null/noop,
//     所以测试只验证 store 逻辑,不验证持久化(持久化在浏览器侧)。

import { describe, test, expect, beforeEach } from 'vitest';
import { get as storeGet } from 'svelte/store';
import {
	currentUser,
	isLoggedIn,
	roleLabel,
	displayName,
	BUILTIN_USERS,
	loginAs,
	logout,
	can,
	getCurrentUser,
} from '../auth';
import { sessionStore } from '../session';

beforeEach(() => {
	// 重置 store
	currentUser.set(null);
	sessionStore.set({
		loggedIn: false,
		userId: null,
		username: null,
		loginAt: null,
	});
});

// ============================================================================
// 1. BUILTIN_USERS(5 预置用户)
// ============================================================================

describe('P08 BUILTIN_USERS', () => {
	test('5 个预置用户,每个角色 1 个', () => {
		expect(BUILTIN_USERS).toHaveLength(5);
		const roles = BUILTIN_USERS.map((u) => u.role);
		expect(roles).toContain('user');
		expect(roles).toContain('lead');
		expect(roles).toContain('it');
		expect(roles).toContain('exec');
		expect(roles).toContain('auditor');
	});

	test('每个用户 status=active', () => {
		for (const u of BUILTIN_USERS) {
			expect(u.status).toBe('active');
		}
	});

	test('username 唯一', () => {
		const usernames = BUILTIN_USERS.map((u) => u.username);
		expect(new Set(usernames).size).toBe(usernames.length);
	});
});

// ============================================================================
// 2. loginAs(mock 登录)
// ============================================================================

describe('P08 loginAs', () => {
	test('admin 用户登录成功 + currentUser 设置', () => {
		const result = loginAs('admin');
		expect(result.success).toBe(true);
		expect(result.error).toBeUndefined();

		const u = storeGet(currentUser);
		expect(u).not.toBeNull();
		expect(u!.username).toBe('admin');
		expect(u!.role).toBe('it');
		expect(u!.displayName).toBe('张主任');
	});

	test('lead 用户登录 → role=lead', () => {
		loginAs('lead');
		expect(storeGet(currentUser)?.role).toBe('lead');
	});

	test('doctor 用户登录 → role=user', () => {
		loginAs('doctor');
		expect(storeGet(currentUser)?.role).toBe('user');
	});

	test('exec 用户登录 → role=exec', () => {
		loginAs('exec');
		expect(storeGet(currentUser)?.role).toBe('exec');
	});

	test('auditor 用户登录 → role=auditor', () => {
		loginAs('auditor');
		expect(storeGet(currentUser)?.role).toBe('auditor');
	});

	test('未知用户登录失败 + 不修改 currentUser', () => {
		currentUser.set(null);
		const result = loginAs('nonexistent');
		expect(result.success).toBe(false);
		expect(result.error).toContain('不存在');
		expect(storeGet(currentUser)).toBeNull();
	});

	test('登录后 isLoggedIn=true', () => {
		loginAs('admin');
		expect(storeGet(isLoggedIn)).toBe(true);
	});

	test('登录后 displayName 派生正确', () => {
		loginAs('admin');
		expect(storeGet(displayName)).toBe('张主任');
	});

	test('登录后 roleLabel 派生正确', () => {
		loginAs('lead');
		expect(storeGet(roleLabel)).toBe('科室主任');
	});
});

// ============================================================================
// 3. 与 session.ts 协同
// ============================================================================

describe('P08 auth ↔ session 协同', () => {
	test('loginAs 同步设置 sessionStore.loggedIn=true', () => {
		loginAs('admin');
		const s = storeGet(sessionStore);
		expect(s.loggedIn).toBe(true);
		expect(s.userId).toBe('u-admin');
		expect(s.username).toBe('张主任');
	});

	test('logout 同步清除 sessionStore', () => {
		loginAs('admin');
		expect(storeGet(sessionStore).loggedIn).toBe(true);

		logout();

		expect(storeGet(currentUser)).toBeNull();
		const s = storeGet(sessionStore);
		expect(s.loggedIn).toBe(false);
		expect(s.userId).toBeNull();
	});

	test('未登录时 sessionStore.loggedIn=false', () => {
		expect(storeGet(sessionStore).loggedIn).toBe(false);
		expect(storeGet(isLoggedIn)).toBe(false);
	});
});

// ============================================================================
// 4. can(权限检查)
// ============================================================================

describe('P08 can(权限检查)', () => {
	test('未登录时 can 始终返回 false', () => {
		expect(can('view_monitor')).toBe(false);
		expect(can('approve_publish')).toBe(false);
	});

	test('admin(it)can 干预/回滚/审批,不能编辑 Draft', () => {
		loginAs('admin');
		expect(can('intervene_runtime')).toBe(true);
		expect(can('rollback_ruleset')).toBe(true);
		expect(can('approve_publish')).toBe(true);
		expect(can('view_audit_chain')).toBe(true);
		expect(can('edit_draft')).toBe(false);
		expect(can('start_sandbox')).toBe(false);
	});

	test('doctor(user)can 编辑 Draft/启动沙盒,不能干预/审批', () => {
		loginAs('doctor');
		expect(can('edit_draft')).toBe(true);
		expect(can('start_sandbox')).toBe(true);
		expect(can('view_monitor')).toBe(true);
		expect(can('intervene_runtime')).toBe(false);
		expect(can('approve_publish')).toBe(false);
		expect(can('view_audit_chain')).toBe(false);
	});

	test('auditor can 看审计链,不能干预/编辑', () => {
		loginAs('auditor');
		expect(can('view_audit_chain')).toBe(true);
		expect(can('view_monitor')).toBe(true);
		expect(can('intervene_runtime')).toBe(false);
		expect(can('edit_draft')).toBe(false);
		expect(can('approve_publish')).toBe(false);
	});

	test('logout 后 can 返回 false', () => {
		loginAs('admin');
		expect(can('intervene_runtime')).toBe(true);

		logout();

		expect(can('intervene_runtime')).toBe(false);
		expect(can('view_monitor')).toBe(false);
	});
});

// ============================================================================
// 5. getCurrentUser
// ============================================================================

describe('P08 getCurrentUser', () => {
	test('未登录返回 null', () => {
		expect(getCurrentUser()).toBeNull();
	});

	test('登录后返回当前用户', () => {
		loginAs('lead');
		const u = getCurrentUser();
		expect(u).not.toBeNull();
		expect(u!.username).toBe('lead');
		expect(u!.role).toBe('lead');
	});

	test('logout 后返回 null', () => {
		loginAs('admin');
		expect(getCurrentUser()).not.toBeNull();

		logout();

		expect(getCurrentUser()).toBeNull();
	});
});
