// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// nav-registry 单测 — 门控过滤纯函数(UV-022 首项改造)
import { describe, expect, it } from 'vitest';
import {
	NAV_REGISTRY,
	navItemsByGroup,
	visibleNavItems,
	type NavVisibilityContext
} from './nav-registry';
import type { PermissionAction } from '$lib/stores/permission-matrix';

/** 构造可见性上下文:登录态 + 持有的权限点集合 */
function ctx(loggedIn: boolean, perms: PermissionAction[]): NavVisibilityContext {
	return { loggedIn, hasPermission: (a) => perms.includes(a) };
}

// 三类典型身份(与浏览器联测账号对齐)
const adminCtx = () => ctx(true, ['view_users', 'manage_users', 'manage_roles', 'view_publish_queue', 'view_monitor']);
const wangCtx = () => ctx(true, ['view_users']);
const demoExecCtx = () => ctx(true, ['view_publish_queue', 'view_monitor']);
const anonCtx = () => ctx(false, []);

describe('visibleNavItems', () => {
	it('admin(全权):全部 11 项可见', () => {
		expect(visibleNavItems(NAV_REGISTRY, adminCtx())).toHaveLength(NAV_REGISTRY.length);
	});

	it('wang(仅 view_users):无发布队列(view_publish_queue 门控,UV-023 闭合)', () => {
		const ids = visibleNavItems(NAV_REGISTRY, wangCtx()).map((i) => i.id);
		expect(ids).not.toContain('publish-queue');
		expect(ids).not.toContain('roles');
		// 用户管理:view_users 命中(ANY 语义)
		expect(ids).toContain('users');
	});

	it('demo exec(有 view_publish_queue 无 view_users):见发布队列,不见用户/角色管理', () => {
		const ids = visibleNavItems(NAV_REGISTRY, demoExecCtx()).map((i) => i.id);
		expect(ids).toContain('publish-queue');
		expect(ids).not.toContain('users');
		expect(ids).not.toContain('roles');
	});

	it('未登录:登录限定项全部隐藏,公开项保留', () => {
		const items = visibleNavItems(NAV_REGISTRY, anonCtx());
		const ids = items.map((i) => i.id);
		expect(ids).toEqual(['overview', 'monitor', 'marketplace', 'help']);
	});

	it('保序:输出顺序与注册表声明顺序一致', () => {
		const declared = NAV_REGISTRY.map((i) => i.id);
		const filtered = visibleNavItems(NAV_REGISTRY, adminCtx()).map((i) => i.id);
		expect(filtered).toEqual(declared);
	});
});

describe('navItemsByGroup', () => {
	it('三组归位:home 2 / discover 2 / governance 8', () => {
		const g = navItemsByGroup(visibleNavItems(NAV_REGISTRY, adminCtx()));
		expect(g.home.map((i) => i.id)).toEqual(['overview', 'monitor']);
		expect(g.discover.map((i) => i.id)).toEqual(['marketplace', 'help']);
		expect(g.governance).toHaveLength(8);
	});

	it('跳单卡子集(jump:true)为 4 项且顺序稳定:marketplace/export/publish-queue/governance', () => {
		const jump = visibleNavItems(NAV_REGISTRY, adminCtx()).filter((i) => i.jump);
		expect(jump.map((i) => i.id)).toEqual(['marketplace', 'export', 'publish-queue', 'governance']);
	});
});
