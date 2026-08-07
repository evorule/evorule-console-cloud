// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// P08 permission-matrix 单测 — 5 角色 × 12 动作全矩阵 + 谓词
//
// 运行: npx vitest run src/lib/stores/__tests__/permission-matrix.test.ts
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §5(权限矩阵详设)

import { describe, test, expect } from 'vitest';
import {
	ROLE_PERMISSIONS,
	ROLE_LABELS,
	checkPermission,
	listPermissions,
	listAllActions,
	listAllRoles,
	type Role,
	type PermissionAction,
} from '../permission-matrix';

// ============================================================================
// 1. 矩阵完整性:5 角色 × 12 动作
// ============================================================================

describe('P08 permission-matrix — 矩阵完整性', () => {
	test('5 个角色全部定义', () => {
		expect(listAllRoles()).toEqual(['user', 'lead', 'it', 'exec', 'auditor']);
	});

	test('12 个动作全部定义', () => {
		expect(listAllActions()).toHaveLength(12);
		expect(listAllActions()).toContain('view_monitor');
		expect(listAllActions()).toContain('view_test_report');
	});

	test('每个角色都有权限集合(非空,auditor 除外只读)', () => {
		for (const role of listAllRoles()) {
			expect(ROLE_PERMISSIONS[role]).toBeInstanceOf(Set);
			expect(ROLE_PERMISSIONS[role].size).toBeGreaterThan(0);
		}
	});

	test('5 个角色标签全部定义', () => {
		expect(ROLE_LABELS.user).toBe('普通用户');
		expect(ROLE_LABELS.lead).toBe('科室主任');
		expect(ROLE_LABELS.it).toBe('信息科');
		expect(ROLE_LABELS.exec).toBe('院领导');
		expect(ROLE_LABELS.auditor).toBe('审计员');
	});
});

// ============================================================================
// 2. user 角色:看 + 编辑 Draft + 启动沙盒
// ============================================================================

describe('P08 user 角色权限', () => {
	const role: Role = 'user';

	test('允许:看监控 + 创建 WS + 编辑 Draft + 启动沙盒 + 看测试报告', () => {
		expect(checkPermission(role, 'view_monitor')).toBe(true);
		expect(checkPermission(role, 'create_workspace')).toBe(true);
		expect(checkPermission(role, 'edit_draft')).toBe(true);
		expect(checkPermission(role, 'start_sandbox')).toBe(true);
		expect(checkPermission(role, 'view_test_report')).toBe(true);
	});

	test('禁止:干预运行时 + 回滚 + 审批发布 + 看审计链 + 看队列', () => {
		expect(checkPermission(role, 'intervene_runtime')).toBe(false);
		expect(checkPermission(role, 'rollback_ruleset')).toBe(false);
		expect(checkPermission(role, 'approve_publish')).toBe(false);
		expect(checkPermission(role, 'view_audit_chain')).toBe(false);
		expect(checkPermission(role, 'view_publish_queue')).toBe(false);
		expect(checkPermission(role, 'review_in_workspace')).toBe(false);
		expect(checkPermission(role, 'submit_to_publish')).toBe(false);
	});

	test('listPermissions 返回 5 个动作', () => {
		expect(listPermissions(role)).toHaveLength(5);
	});
});

// ============================================================================
// 3. lead 角色:user + WS 内审核 + 提交发布 + 看队列
// ============================================================================

describe('P08 lead 角色权限', () => {
	const role: Role = 'lead';

	test('允许:user 全部 + review_in_workspace + submit_to_publish + view_publish_queue', () => {
		// user 的全部
		expect(checkPermission(role, 'view_monitor')).toBe(true);
		expect(checkPermission(role, 'edit_draft')).toBe(true);
		expect(checkPermission(role, 'start_sandbox')).toBe(true);
		// lead 新增
		expect(checkPermission(role, 'review_in_workspace')).toBe(true);
		expect(checkPermission(role, 'submit_to_publish')).toBe(true);
		expect(checkPermission(role, 'view_publish_queue')).toBe(true);
	});

	test('禁止:干预运行时 + 回滚 + 审批发布 + 看审计链', () => {
		expect(checkPermission(role, 'intervene_runtime')).toBe(false);
		expect(checkPermission(role, 'rollback_ruleset')).toBe(false);
		expect(checkPermission(role, 'approve_publish')).toBe(false);
		expect(checkPermission(role, 'view_audit_chain')).toBe(false);
	});

	test('listPermissions 返回 8 个动作', () => {
		expect(listPermissions(role)).toHaveLength(8);
	});
});

// ============================================================================
// 4. it 角色:看 + 干预 + 回滚 + 审批发布 + 看审计链 + 看队列
// ============================================================================

describe('P08 it 角色权限', () => {
	const role: Role = 'it';

	test('允许:干预 + 回滚 + 审批发布 + 看审计链 + 看队列', () => {
		expect(checkPermission(role, 'view_monitor')).toBe(true);
		expect(checkPermission(role, 'view_audit_chain')).toBe(true);
		expect(checkPermission(role, 'intervene_runtime')).toBe(true);
		expect(checkPermission(role, 'rollback_ruleset')).toBe(true);
		expect(checkPermission(role, 'approve_publish')).toBe(true);
		expect(checkPermission(role, 'view_publish_queue')).toBe(true);
		expect(checkPermission(role, 'view_test_report')).toBe(true);
	});

	test('禁止:编辑 Draft + WS 内审核 + 提交发布 + 启动沙盒 + 创建 WS', () => {
		expect(checkPermission(role, 'edit_draft')).toBe(false);
		expect(checkPermission(role, 'review_in_workspace')).toBe(false);
		expect(checkPermission(role, 'submit_to_publish')).toBe(false);
		expect(checkPermission(role, 'start_sandbox')).toBe(false);
		expect(checkPermission(role, 'create_workspace')).toBe(false);
	});
});

// ============================================================================
// 5. exec 角色:同 it(P0 等同)
// ============================================================================

describe('P08 exec 角色权限(P0 等同 it)', () => {
	const role: Role = 'exec';

	test('exec 与 it 权限集合相同', () => {
		expect(listPermissions(role).sort()).toEqual(
			listPermissions('it').sort(),
		);
	});

	test('允许:干预 + 回滚 + 审批发布 + 看审计链', () => {
		expect(checkPermission(role, 'intervene_runtime')).toBe(true);
		expect(checkPermission(role, 'rollback_ruleset')).toBe(true);
		expect(checkPermission(role, 'approve_publish')).toBe(true);
		expect(checkPermission(role, 'view_audit_chain')).toBe(true);
	});
});

// ============================================================================
// 6. auditor 角色:只读审计链 + 看监控
// ============================================================================

describe('P08 auditor 角色权限(只读)', () => {
	const role: Role = 'auditor';

	test('允许:看监控 + 看审计链', () => {
		expect(checkPermission(role, 'view_monitor')).toBe(true);
		expect(checkPermission(role, 'view_audit_chain')).toBe(true);
	});

	test('禁止:其他全部动作(10 个)', () => {
		const allActions = listAllActions();
		const denied = allActions.filter((a) => !checkPermission(role, a));
		expect(denied).toHaveLength(10);
		expect(denied).not.toContain('view_monitor');
		expect(denied).not.toContain('view_audit_chain');
	});

	test('listPermissions 返回 2 个动作', () => {
		expect(listPermissions(role)).toHaveLength(2);
	});
});

// ============================================================================
// 7. checkPermission 边界
// ============================================================================

describe('P08 checkPermission 边界', () => {
	test('未知角色返回 false(不抛错)', () => {
		expect(checkPermission('unknown' as Role, 'view_monitor')).toBe(false);
	});

	test('未知动作返回 false', () => {
		expect(checkPermission('user', 'unknown_action' as PermissionAction)).toBe(
			false,
		);
	});
});
