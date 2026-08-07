// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 用户身份 + 权限 store(P08 §6.1)。
// 持久化:localStorage(key: evorule-console-cloud:auth)
//
// 设计:
//   - 扩展(不替换)session.ts:auth.ts 持有角色/权限,session.ts 保留登录态布尔
//     (T1 HomeRouter 依赖 sessionStore.loggedIn 决策 A/B/C,不改其契约)
//   - P0 mock:5 预置用户,按 username 匹配,不校验密码
//     (真实认证由 evorule-server 提供,P1+ 接 /api/auth/login)
//   - loginAs 同步调 session.login,保持两 store 一致
//   - logout 同步调 session.logout
//
// 关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §6.1(authStore)

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
	type Role,
	type PermissionAction,
	checkPermission,
	ROLE_LABELS,
} from './permission-matrix';
import * as session from './session';

export interface User {
	id: string;
	username: string;
	displayName: string;
	email?: string;
	role: Role;
	department?: string;
	status: 'active' | 'disabled';
}

const AUTH_STORAGE_KEY = 'evorule-console-cloud:auth';

/**
 * 5 预置 mock 用户(P0 demo 用,不校验密码)。
 * 每个角色 1 个,覆盖 P08 §5.2 全部 5 角色。
 */
export const BUILTIN_USERS: User[] = [
	{
		id: 'u-admin',
		username: 'admin',
		displayName: '张主任',
		email: 'admin@evorule.demo',
		role: 'it',
		department: '信息科',
		status: 'active',
	},
	{
		id: 'u-lead',
		username: 'lead',
		displayName: '李科长',
		email: 'lead@evorule.demo',
		role: 'lead',
		department: '呼吸科',
		status: 'active',
	},
	{
		id: 'u-doctor',
		username: 'doctor',
		displayName: '王医生',
		email: 'doctor@evorule.demo',
		role: 'user',
		department: '呼吸科',
		status: 'active',
	},
	{
		id: 'u-exec',
		username: 'exec',
		displayName: '陈院长',
		email: 'exec@evorule.demo',
		role: 'exec',
		department: '院办',
		status: 'active',
	},
	{
		id: 'u-auditor',
		username: 'auditor',
		displayName: '刘审计',
		email: 'auditor@evorule.demo',
		role: 'auditor',
		department: '审计科',
		status: 'active',
	},
];

function loadUser(): User | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(AUTH_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as User;
		// 校验关键字段
		if (
			typeof parsed.id === 'string' &&
			typeof parsed.username === 'string' &&
			typeof parsed.role === 'string'
		) {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

/** 当前登录用户(null = 未登录) */
export const currentUser = writable<User | null>(loadUser());

// 持久化
currentUser.subscribe((u) => {
	if (!browser) return;
	if (u) {
		localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(u));
	} else {
		localStorage.removeItem(AUTH_STORAGE_KEY);
	}
});

/** 派生:是否登录(与 sessionStore.loggedIn 保持一致) */
export const isLoggedIn = derived(currentUser, ($u) => $u !== null);

/** 派生:角色标签(中文,UI 显示用) */
export const roleLabel = derived(currentUser, ($u) => {
	if (!$u) return '';
	return ROLE_LABELS[$u.role];
});

/** 派生:当前用户显示名 */
export const displayName = derived(currentUser, ($u) => $u?.displayName ?? '');

/**
 * mock 登录:按 username 匹配 BUILTIN_USERS,不校验密码(P0)。
 *
 * 同步调 session.login,保持 auth + session 两 store 一致。
 *
 * @param username 预置用户名(admin/lead/doctor/exec/auditor)
 * @returns { success, error? }
 */
export function loginAs(
	username: string,
): { success: boolean; error?: string } {
	const user = BUILTIN_USERS.find(
		(u) => u.username === username && u.status === 'active',
	);
	if (!user) {
		return { success: false, error: `用户 "${username}" 不存在或已禁用` };
	}
	currentUser.set(user);
	// 同步 session.ts(T1 HomeRouter 依赖 sessionStore.loggedIn)
	session.login(user.id, user.displayName);
	return { success: true };
}

/**
 * 退出登录。
 * 同步调 session.logout,清除两 store。
 */
export function logout(): void {
	currentUser.set(null);
	session.logout();
}

/**
 * 权限检查(组件 / 路由守卫用)。
 *
 * P0 简化:仅角色级检查(调 checkPermission)。
 * P1+ 接真实后端时,补 §5.3 的 scope 校验。
 *
 * @param action 权限动作
 * @returns 当前用户是否有该权限(未登录 → false)
 */
export function can(action: PermissionAction): boolean {
	const u = get(currentUser);
	if (!u) return false;
	return checkPermission(u.role, action);
}

/** 获取当前用户(同步,非响应式,守卫 / 工具函数用) */
export function getCurrentUser(): User | null {
	return get(currentUser);
}

/** 刷新当前用户信息(角色变更后调,P0 mock 无后端,直接返回) */
export function refreshCurrentUser(): void {
	// P0 mock:无后端可刷新,保留接口签名供 P1+ 实现
}
