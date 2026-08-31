// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 路由守卫(对应 HOME_DESIGN.md §4.3 + P08 §5 权限矩阵)。
// - /onboarding:未登录或已有库时跳回 /(向导只对"已登录 + 空库"开放)
// - /runtime(L1) / /workspace(L2) / /view/[id] / /export / /import-export / /marketplace:
//   未登录或库空时跳回 /(向导未完成,不允许直接访问运行时 / 编辑台 / 视图 / 导出 / 导入导出 / 市场)
// - /publish-queue:未登录跳 /login;需 view_publish_queue 权限(lead/it/exec)
// - /version-history:未登录跳 /login
// - /audit:未登录跳 /login;需 view_audit_chain 权限(auditor/it/exec)
// - /login:不守卫(任何状态都能访问)
// - /demo:不守卫(任何状态都能访问)
// - /(首页):不守卫(HomeRouter 自动决策 A/B/C)
//
// adapter-static + fallback 模式:load 在客户端执行,browser 检查确保 SSR/prerender 时跳过。

import type { LayoutLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { sessionStore } from '$lib/stores/session';
import { checkEmptyDb } from '$lib/stores/db';
import { can, isPlatformSession, refreshCurrentUser } from '$lib/stores/auth';
import { toastInfo } from '$lib/stores/toast';

export const load: LayoutLoad = ({ url }) => {
	if (!browser) return {}; // SSR/prerender 时跳过守卫(adapter-static 默认无 SSR)

	// UV-017 W3:platform 会话节流刷新(30s 一次,随导航触发)。
	// - 授权变更后权限矩阵自动更新(permissions_version)
	// - 会话被吊销(登出/停用/删除)→ 本地登出,后续 loggedIn 判断自然跳登录
	if (isPlatformSession()) {
		void refreshCurrentUser();
	}

	const session = get(sessionStore);
	const emptyDb = checkEmptyDb(); // 派生 isEmptyDb 的同步版(路由守卫用)

	// /onboarding 守卫:未登录或已有库时跳回 /
	if (url.pathname === '/onboarding') {
		if (!session.loggedIn || !emptyDb) {
			throw redirect(307, '/');
		}
	}

	// /runtime(L1) / /workspace(L2) / /view/[id] / /export / /import-export / /marketplace 守卫:
	// 未登录或库空时跳回 /(向导未完成,不允许直接访问运行时 / 编辑台 / 视图 / 导出 / 导入导出 / 市场)
	if (
		url.pathname === '/runtime' ||
		url.pathname === '/workspace' ||
		url.pathname === '/export' ||
		url.pathname === '/import-export' ||
		url.pathname === '/marketplace' ||
		url.pathname.startsWith('/view/')
	) {
		if (!session.loggedIn || emptyDb) {
			throw redirect(307, '/');
		}
	}

	// P08 协作路由守卫(需登录 + 角色权限)
	if (url.pathname === '/publish-queue') {
		if (!session.loggedIn) throw redirect(307, '/login');
		if (!can('view_publish_queue')) throw redirect(307, '/');
	}

	if (url.pathname === '/version-history') {
		if (!session.loggedIn) throw redirect(307, '/login');
	}

	if (url.pathname === '/audit') {
		if (!session.loggedIn) {
			// UV-014:登录墙前置说明 —— 守卫 redirect 会短路页面 onMount,提示必须在这里给
			toastInfo(
				'审计员工作台属治理侧,需治理角色登录(auditor/admin 等)。演示凭据见包内 README-STARTUP.txt;本地免登录的审计链视图在工作台「审计」入口。',
				'登录墙'
			);
			throw redirect(307, '/login');
		}
		if (!can('view_audit_chain')) {
			toastInfo(
				'当前账号无 view_audit_chain 权限(需 auditor/admin 等治理角色)。如需演示,请用 README-STARTUP.txt 中的治理凭据登录。',
				'权限不足'
			);
			throw redirect(307, '/');
		}
	}

	// /users /roles 平台管理路由守卫(UV-017 W4):
	// - 未登录跳 /login
	// - 权限不足跳 /(demo 用户权限矩阵不含平台管理点,自然被拒)
	// - /users 需 view_users 或 manage_users;/roles 需 manage_roles
	if (url.pathname === '/users') {
		if (!session.loggedIn) throw redirect(307, '/login');
		if (!can('view_users') && !can('manage_users')) throw redirect(307, '/');
	}

	if (url.pathname === '/roles') {
		if (!session.loggedIn) throw redirect(307, '/login');
		if (!can('manage_roles')) throw redirect(307, '/');
	}

	// /login / /demo 不守卫
	// /(首页)不守卫:HomeRouter 自动决策

	return {};
};
