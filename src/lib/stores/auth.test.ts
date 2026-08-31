// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// auth store 权限判定单元测试(UV-017 W3:can() 后端化)。
// browser=false(无 localStorage 路径),只测纯函数:
//   - hasPermission:platform 身份以服务端 permissions 为准;demo 身份走 P08 本地矩阵
//   - roleDisplayName:platform 内置角色中文标签;自定义角色回退原文
//
// $app/environment mock 为 browser:false → store 初始化走非浏览器分支。

import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));

import { hasPermission, roleDisplayName, type User } from './auth';
import type { PermissionAction } from './permission-matrix';

function platformUser(permissions: string[], role = 'administrator'): User {
	return {
		id: 'root',
		username: 'root',
		displayName: '管理员',
		role,
		status: 'active',
		authKind: 'platform',
		permissions,
	};
}

describe('hasPermission(UV-017 can() 后端化)', () => {
	it('platform 身份:服务端 permissions 清单是唯一依据', () => {
		const u = platformUser(['view_monitor', 'manage_users']);
		expect(hasPermission(u, 'view_monitor' as PermissionAction)).toBe(true);
		expect(hasPermission(u, 'manage_users' as PermissionAction)).toBe(true);
		// 不在服务端清单中 → false(即使本地 P08 矩阵允许)
		expect(hasPermission(u, 'edit_draft' as PermissionAction)).toBe(false);
	});

	it('platform 身份:无 permissions 字段(异常态)→ 一律拒绝(fail-safe)', () => {
		const u = platformUser(undefined as unknown as string[]);
		expect(hasPermission(u, 'view_monitor' as PermissionAction)).toBe(false);
	});

	it('platform 自定义角色:权限仍以清单为准,与角色名无关', () => {
		const u = platformUser(['view_audit_chain'], 'lab_auditor');
		expect(hasPermission(u, 'view_audit_chain' as PermissionAction)).toBe(true);
		expect(hasPermission(u, 'manage_roles' as PermissionAction)).toBe(false);
	});

	it('demo 身份:走本地 P08 矩阵(it 角色可干预运行时)', () => {
		const u: User = {
			id: 'u-admin',
			username: 'admin',
			displayName: '张主任',
			role: 'it',
			status: 'active',
			authKind: 'demo',
		};
		expect(hasPermission(u, 'intervene_runtime')).toBe(true);
		expect(hasPermission(u, 'manage_users' as PermissionAction)).toBe(false);
	});

	it('未登录(null)→ false', () => {
		expect(hasPermission(null, 'view_monitor' as PermissionAction)).toBe(false);
	});
});

describe('roleDisplayName', () => {
	it('platform 内置角色 → 中文标签', () => {
		expect(roleDisplayName(platformUser([], 'administrator'))).toBe('管理员');
		expect(roleDisplayName(platformUser([], 'rule_engineer'))).toBe('规则工程师');
	});

	it('platform 自定义角色 → 回退角色名原文', () => {
		expect(roleDisplayName(platformUser([], 'lab_auditor'))).toBe('lab_auditor');
	});

	it('demo 角色 → P08 中文标签', () => {
		expect(
			roleDisplayName({
				id: 'u-lead',
				username: 'lead',
				displayName: '李科长',
				role: 'lead',
				status: 'active',
				authKind: 'demo',
			})
		).toBe('科室主任');
	});

	it('未登录 → 空串', () => {
		expect(roleDisplayName(null)).toBe('');
	});
});
