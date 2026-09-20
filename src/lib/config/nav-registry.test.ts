// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// nav-registry 单测 — 门控过滤纯函数(首项改造;含功能开关 featureFlag 门控)
import { describe, expect, it } from 'vitest';
import {
	NAV_REGISTRY,
	navItemsByGroup,
	visibleNavItems,
	type NavVisibilityContext
} from './nav-registry';
import type { PermissionAction } from '$lib/stores/permission-matrix';

/**
 * 构造可见性上下文:登录态 + 持有的权限点集合 + 功能开关(默认全关)。
 * agentEnabled:模拟 agentConfig.enabled(设置页 Agent 连接开关)。
 */
function ctx(
	loggedIn: boolean,
	perms: PermissionAction[],
	opts: { agentEnabled?: boolean } = {}
): NavVisibilityContext {
	return {
		loggedIn,
		hasPermission: (a) => perms.includes(a),
		featureEnabled: (flag) => (flag === 'agent' ? (opts.agentEnabled ?? false) : false)
	};
}

// 三类典型身份(与浏览器联测账号对齐)
const adminCtx = () =>
	ctx(
		true,
		['view_users', 'manage_users', 'manage_roles', 'manage_apps', 'view_publish_queue', 'view_monitor'],
		{ agentEnabled: true }
	);
const wangCtx = () => ctx(true, ['view_users']);
const demoExecCtx = () => ctx(true, ['view_publish_queue', 'view_monitor']);
const anonCtx = () => ctx(false, []);

describe('visibleNavItems', () => {
	it('admin(全权+agent 启用):全部项可见', () => {
		expect(visibleNavItems(NAV_REGISTRY, adminCtx())).toHaveLength(NAV_REGISTRY.length);
	});

	it('wang(仅 view_users):无发布队列/插件审批(view_publish_queue 门控,闭合)', () => {
		const ids = visibleNavItems(NAV_REGISTRY, wangCtx()).map((i) => i.id);
		expect(ids).not.toContain('publish-queue');
		expect(ids).not.toContain('plugin-approvals');
		expect(ids).not.toContain('roles');
		// 应用管理:manage_apps 单点门控(专项)
		expect(ids).not.toContain('apps');
		// 用户管理:view_users 命中(ANY 语义)
		expect(ids).toContain('users');
	});

	it('demo exec(有 view_publish_queue 无 view_users):见发布队列/插件审批,不见用户/角色/应用管理', () => {
		const ids = visibleNavItems(NAV_REGISTRY, demoExecCtx()).map((i) => i.id);
		expect(ids).toContain('publish-queue');
		// 插件审批与发布审批同范式,复用同一权限点对
		expect(ids).toContain('plugin-approvals');
		expect(ids).not.toContain('users');
		expect(ids).not.toContain('roles');
		expect(ids).not.toContain('apps');
	});

	it('未登录:登录限定项全部隐藏,公开项保留', () => {
		const items = visibleNavItems(NAV_REGISTRY, anonCtx());
		const ids = items.map((i) => i.id);
		// 0.4.1 行为变更:marketplace 补标 loginRequired(其页面受登录守卫),
		// 未登录导航中随之隐藏——与页面可达性口径一致(未登录不可达即不展示)。
		// agent 默认禁用(ctx 缺省 agentEnabled=false),同口径不在未登录清单。
		expect(ids).toEqual(['overview', 'monitor', 'help']);
	});

	it('保序:输出顺序与注册表声明顺序一致', () => {
		const declared = NAV_REGISTRY.map((i) => i.id);
		const filtered = visibleNavItems(NAV_REGISTRY, adminCtx()).map((i) => i.id);
		expect(filtered).toEqual(declared);
	});
});

describe('featureFlag 门控(agent ← agentConfig.enabled)', () => {
	it('开关关闭:即使 admin 也不可见(fail-closed,导航入口不渲染语义)', () => {
		const adminOff = ctx(true, [
			'view_users',
			'manage_users',
			'manage_roles',
			'manage_apps',
			'view_publish_queue',
			'view_monitor'
		]);
		const ids = visibleNavItems(NAV_REGISTRY, adminOff).map((i) => i.id);
		expect(ids).not.toContain('agent');
		expect(ids).toHaveLength(NAV_REGISTRY.length - 1);
	});

	it('宿主未注入 featureEnabled:声明 featureFlag 的项一律隐藏(fail-closed 防越权入口)', () => {
		const legacyCtx: NavVisibilityContext = {
			loggedIn: true,
			hasPermission: () => true
		};
		const ids = visibleNavItems(NAV_REGISTRY, legacyCtx).map((i) => i.id);
		expect(ids).not.toContain('agent');
	});

	it('agent 无 loginRequired:未登录 + 开关启用时可见(连接配置属浏览器本地态)', () => {
		const anonOn = ctx(false, [], { agentEnabled: true });
		expect(visibleNavItems(NAV_REGISTRY, anonOn).map((i) => i.id)).toContain('agent');
	});
});

describe('navItemsByGroup', () => {
	it('四组归位:home 4(总览/监控/流程/Agent 会话)/ discover 3 / governance 10', () => {
		const g = navItemsByGroup(visibleNavItems(NAV_REGISTRY, adminCtx()));
		expect(g.home.map((i) => i.id)).toEqual(['overview', 'monitor', 'flow', 'agent']);
		expect(g.discover.map((i) => i.id)).toEqual(['marketplace', 'knowledge', 'help']);
		expect(g.governance).toHaveLength(10);
	});

	it('跳单卡子集(jump:true)为 5 项且顺序稳定:marketplace/export/publish-queue/plugin-approvals/governance', () => {
		const jump = visibleNavItems(NAV_REGISTRY, adminCtx()).filter((i) => i.jump);
		expect(jump.map((i) => i.id)).toEqual([
			'marketplace',
			'export',
			'publish-queue',
			'plugin-approvals',
			'governance'
		]);
	});
});
