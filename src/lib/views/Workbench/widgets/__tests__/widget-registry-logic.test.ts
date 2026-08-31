// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Widget 注册表纯逻辑层单测(UV-021 W1)。
//
// 覆盖点:
//   T1: matchesPermission — 缺省权限/有权限/无权限/未登录
//   T2: matchesRoles — 缺省不限/白名单命中/未命中/未登录
//   T3: isVisibleOnSurface — 表面声明
//   T4: isWidgetVisible — 组合判定(未登录双保险)
//   T5: sortForRender — order 升序 + 同值 id 字典序(确定性) + 不改原数组
//   T6: selectWidgets — 组合过滤+排序(渲染器唯一入口)
//   T7: 双轨权限 — platform 用户按 permissions 清单,demo 用户按本地矩阵

import { describe, test, expect } from 'vitest';
import {
	matchesPermission,
	matchesRoles,
	isVisibleOnSurface,
	isWidgetVisible,
	sortForRender,
	selectWidgets,
} from '../widget-registry-logic';
import type { WidgetMeta, WidgetSurface } from '../types';
import type { User } from '$lib/stores/auth';

/** 造 meta 工厂(component 不参与纯逻辑,略) */
function meta(overrides: Partial<WidgetMeta> & { id: string }): WidgetMeta {
	return {
		title: overrides.id,
		span: 1,
		order: 0,
		surfaces: ['workbench'],
		...overrides,
	};
}

function platformUser(overrides: Partial<User> = {}): User {
	return {
		id: 'u-admin',
		username: 'admin',
		displayName: '管理员',
		role: 'administrator',
		status: 'active',
		authKind: 'platform',
		permissions: ['view_monitor', 'view_users'],
		...overrides,
	};
}

function demoUser(overrides: Partial<User> = {}): User {
	return {
		id: 'u-demo',
		username: 'demo-exec',
		displayName: '院领导',
		role: 'exec',
		status: 'active',
		authKind: 'demo',
		...overrides,
	};
}

// === T1: 权限判定 ===
describe('T1 matchesPermission', () => {
	test('缺省权限:登录即见,未登录不见', () => {
		const def = meta({ id: 'a' });
		expect(matchesPermission(def, demoUser())).toBe(true);
		expect(matchesPermission(def, platformUser())).toBe(true);
		expect(matchesPermission(def, null)).toBe(false);
	});

	test('声明权限:platform 用户按服务端清单', () => {
		const def = meta({ id: 'a', permission: 'view_monitor' });
		expect(matchesPermission(def, platformUser())).toBe(true);
		expect(matchesPermission(def, platformUser({ permissions: [] }))).toBe(false);
	});

	test('demo 用户:平台管理点不在本地矩阵,一律 false', () => {
		const def = meta({ id: 'a', permission: 'manage_users' });
		expect(matchesPermission(def, demoUser({ role: 'exec' }))).toBe(false);
	});
});

// === T2: 角色白名单 ===
describe('T2 matchesRoles', () => {
	test('缺省 roles:不限角色', () => {
		expect(matchesRoles(meta({ id: 'a' }), demoUser())).toBe(true);
	});

	test('白名单命中/未命中(demo 角色id)', () => {
		const def = meta({ id: 'a', roles: ['exec', 'auditor'] });
		expect(matchesRoles(def, demoUser())).toBe(true);
		expect(matchesRoles(def, demoUser({ role: 'user' }))).toBe(false);
	});

	test('platform 角色名同轨匹配', () => {
		const def = meta({ id: 'a', roles: ['approver'] });
		expect(matchesRoles(def, platformUser({ role: 'approver' }))).toBe(true);
		expect(matchesRoles(def, platformUser({ role: 'viewer' }))).toBe(false);
	});

	test('未登录不见', () => {
		expect(matchesRoles(meta({ id: 'a', roles: ['exec'] }), null)).toBe(false);
	});
});

// === T3: 表面声明 ===
describe('T3 isVisibleOnSurface', () => {
	test('按 surfaces 声明过滤', () => {
		const def = meta({ id: 'a', surfaces: ['workbench'] });
		expect(isVisibleOnSurface(def, 'workbench')).toBe(true);
		// 预留表面:未声明的表面不可见(未来扩展侧栏时由声明驱动)
		expect(isVisibleOnSurface(def, 'sidebar' as WidgetSurface)).toBe(false);
	});
});

// === T4: 组合可见性 ===
describe('T4 isWidgetVisible', () => {
	test('全部条件满足才可见', () => {
		// rollback_ruleset:demo user 矩阵不含;roles 白名单 exec/auditor 不含 user
		const def = meta({ id: 'a', permission: 'rollback_ruleset', roles: ['exec', 'auditor'] });
		expect(isWidgetVisible(def, 'workbench', demoUser({ role: 'user' }))).toBe(false);
		// platform viewer:角色不在白名单 → false(即使权限清单含该点)
		expect(
			isWidgetVisible(def, 'workbench', platformUser({ role: 'viewer', permissions: ['rollback_ruleset'] }))
		).toBe(false);
		// demo exec:角色命中且矩阵含 view_audit_chain → true
		const def2 = meta({ id: 'b', permission: 'view_audit_chain', roles: ['exec'] });
		expect(isWidgetVisible(def2, 'workbench', demoUser())).toBe(true);
	});

	test('未登录双保险:false', () => {
		expect(isWidgetVisible(meta({ id: 'a' }), 'workbench', null)).toBe(false);
	});
});

// === T5: 排序确定性 ===
describe('T5 sortForRender', () => {
	test('order 升序;同值按 id 字典序;不改原数组', () => {
		const original = [
			meta({ id: 'b', order: 1 }),
			meta({ id: 'z', order: 0 }),
			meta({ id: 'a', order: 1 }),
			meta({ id: 'm', order: 5 }),
		];
		const sorted = sortForRender(original);
		expect(sorted.map((d) => d.id)).toEqual(['z', 'a', 'b', 'm']);
		expect(original.map((d) => d.id)).toEqual(['b', 'z', 'a', 'm']);
	});
});

// === T6: selectWidgets 组合 ===
describe('T6 selectWidgets', () => {
	test('过滤 + 排序一步到位', () => {
		const registry = [
			meta({ id: 'stats', order: 2 }),
			meta({ id: 'monitor', order: 1, permission: 'view_monitor' }),
			meta({ id: 'decision', order: 0, roles: ['exec', 'auditor'] }),
			meta({ id: 'hidden', order: -10, surfaces: ['sidebar' as WidgetSurface] }),
		];
		const result = selectWidgets(registry, 'workbench', demoUser());
		// demo exec:有 view_monitor → monitor 可见;decision 角色命中;hidden 表面不符
		expect(result.map((d) => d.id)).toEqual(['decision', 'monitor', 'stats']);
	});

	test('demo user:decision 角色白名单外被滤掉', () => {
		const registry = [
			meta({ id: 'stats', order: 2 }),
			meta({ id: 'decision', order: 0, roles: ['exec', 'auditor'] }),
		];
		const result = selectWidgets(registry, 'workbench', demoUser({ role: 'user' }));
		expect(result.map((d) => d.id)).toEqual(['stats']);
	});

	test('platform admin:monitor 可见且按 order 排前', () => {
		const registry = [
			meta({ id: 'stats', order: 2 }),
			meta({ id: 'monitor', order: 1, permission: 'view_monitor' }),
		];
		const result = selectWidgets(registry, 'workbench', platformUser());
		expect(result.map((d) => d.id)).toEqual(['monitor', 'stats']);
	});
});

// === T7: 双轨权限一致性(与 UV-017 侧栏门控同源) ===
describe('T7 双轨权限', () => {
	test('demo exec 有 view_test_report,platform viewer 无', () => {
		const def = meta({ id: 'report', permission: 'view_test_report' });
		expect(matchesPermission(def, demoUser())).toBe(true);
		expect(matchesPermission(def, platformUser({ role: 'viewer', permissions: ['view_monitor'] }))).toBe(false);
	});
});
