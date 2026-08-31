// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 用户身份 + 权限 store(P08 §6.1 / UV-017 W3 后端化)。
//
// 两种登录身份:
//   - platform(平台登录):POST evorule-server /api/platform/auth/login,
//     会话 token 写入 netConfig.authToken(驱动全部后端请求带 Bearer),
//     权限矩阵由服务端随 login/me 下发 —— can() 以后端为准,前端不再硬编码
//   - demo(演示模式):P0 预置用户一键登录,无密码,权限走本地 P08 矩阵
//     (计划 §10"演示模式开关":开=一键演示可用;关=必须真实登录)
//
// 权限刷新契约(计划 §10):
//   - permissions_version 变化即授权有变更,路由守卫节流调 refreshCurrentUser
//   - 会话被吊销/过期时 /me 返回 401 → 本地登出并清 token(立即生效)
//
// 持久化:localStorage(key: evorule-console-cloud:auth)

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
	type Role,
	type PermissionAction,
	checkPermission,
	ROLE_LABELS,
} from './permission-matrix';
import { netConfig, setAuthToken } from '$lib/config/net-config';
import {
	platformLogin,
	platformLogout,
	fetchMe,
	PlatformAuthError,
	type PlatformSessionInfo,
} from '$lib/backend/platform-auth-api';
import * as session from './session';

/** 身份类型:platform=真实平台登录;demo=演示模式 */
export type AuthKind = 'platform' | 'demo';

export interface User {
	id: string;
	username: string;
	displayName: string;
	email?: string;
	role: Role | string;
	department?: string;
	status: 'active' | 'disabled';
	authKind: AuthKind;
	/** platform 身份:服务端下发的权限点清单(can() 的唯一依据) */
	permissions?: string[];
	/** platform 身份:授权快照版本(变更检测) */
	permissionsVersion?: number;
}

const AUTH_STORAGE_KEY = 'evorule-console-cloud:auth';

/**
 * 平台内置角色中文标签(自定义角色回退显示角色名原文)。
 * 与 evorule-server platform_auth::BUILTIN_ROLES 对齐。
 */
export const PLATFORM_ROLE_LABELS: Record<string, string> = {
	administrator: '管理员',
	approver: '审批人',
	rule_engineer: '规则工程师',
	viewer: '查看者',
};

/**
 * 5 预置演示用户(演示模式用,不校验密码)。
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
		authKind: 'demo',
	},
	{
		id: 'u-lead',
		username: 'lead',
		displayName: '李科长',
		email: 'lead@evorule.demo',
		role: 'lead',
		department: '呼吸科',
		status: 'active',
		authKind: 'demo',
	},
	{
		id: 'u-doctor',
		username: 'doctor',
		displayName: '王医生',
		email: 'doctor@evorule.demo',
		role: 'user',
		department: '呼吸科',
		status: 'active',
		authKind: 'demo',
	},
	{
		id: 'u-exec',
		username: 'exec',
		displayName: '陈院长',
		email: 'exec@evorule.demo',
		role: 'exec',
		department: '院办',
		status: 'active',
		authKind: 'demo',
	},
	{
		id: 'u-auditor',
		username: 'auditor',
		displayName: '刘审计',
		email: 'auditor@evorule.demo',
		role: 'auditor',
		department: '审计科',
		status: 'active',
		authKind: 'demo',
	},
];

function loadUser(): User | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(AUTH_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as User;
		// 校验关键字段(authKind 缺省视为 demo,兼容 W3 之前的存量登录态)
		if (
			typeof parsed.id === 'string' &&
			typeof parsed.username === 'string' &&
			typeof parsed.role === 'string'
		) {
			return {
				...parsed,
				authKind: parsed.authKind === 'platform' ? 'platform' : 'demo',
			};
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

/** 当前用户角色中文标签(platform 自定义角色回退显示角色名) */
export function roleDisplayName(u: User | null): string {
	if (!u) return '';
	if (u.authKind === 'platform') {
		return PLATFORM_ROLE_LABELS[u.role] ?? String(u.role);
	}
	return ROLE_LABELS[u.role as Role] ?? String(u.role);
}

/** 派生:角色标签(中文,UI 显示用) */
export const roleLabel = derived(currentUser, roleDisplayName);

/** 派生:当前用户显示名 */
export const displayName = derived(currentUser, ($u) => $u?.displayName ?? '');

/**
 * 权限判定(纯函数,can() 的内核)。
 * - platform:以服务端下发的 permissions 清单为准(后端化,前端矩阵只服务 demo)
 * - demo:本地 P08 矩阵
 */
export function hasPermission(u: User | null, action: PermissionAction): boolean {
	if (!u) return false;
	if (u.authKind === 'platform') {
		return u.permissions?.includes(action) === true;
	}
	return checkPermission(u.role as Role, action);
}

/**
 * 平台登录(UV-017 W3)。
 *
 * 成功后:
 *   1. token 写入 netConfig.authToken → 全部后端请求自动带 Bearer
 *   2. currentUser 载入服务端用户资料 + 权限矩阵
 *   3. session.login 同步(HomeRouter 依赖)
 *
 * 失败如实上抛 PlatformAuthError(网络不可达 status=0;凭据错误 401),
 * 不静默降级、不回落演示模式。
 *
 * @param baseUrl evorule-server 地址(取 netConfig.remoteBaseUrl)
 */
export async function loginPlatform(
	baseUrl: string,
	username: string,
	password: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const result = await platformLogin(baseUrl, username, password);
		// token 先行:netConfig 变更驱动全部后端请求自动带 Bearer
		setAuthToken(result.token);
		applyPlatformSession(result);
		session.login(result.user.username, result.user.displayName);
		return { success: true };
	} catch (e) {
		if (e instanceof PlatformAuthError) {
			return { success: false, error: e.message };
		}
		return { success: false, error: `登录失败:${(e as Error).message}` };
	}
}

/** 服务端会话数据 → 本地 store(login/refresh 共用;token 由调用方写入 netConfig) */
function applyPlatformSession(info: PlatformSessionInfo): void {
	currentUser.set({
		id: info.user.username,
		username: info.user.username,
		displayName: info.user.displayName || info.user.username,
		email: info.user.email,
		role: info.user.role,
		department: info.user.department,
		status: 'active',
		authKind: 'platform',
		permissions: info.permissions,
		permissionsVersion: info.permissionsVersion,
	});
}

/**
 * 演示模式登录:按 username 匹配 BUILTIN_USERS,不校验密码。
 * 同步调 session.login,保持 auth + session 两 store 一致。
 */
export function loginAs(username: string): { success: boolean; error?: string } {
	const user = BUILTIN_USERS.find(
		(u) => u.username === username && u.status === 'active'
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
 * platform 身份:best-effort 调 server 吊销会话(网络失败不阻塞本地登出),
 * 并清空 netConfig token;demo 身份:直接清本地。
 */
export function logout(): void {
	const u = get(currentUser);
	if (u?.authKind === 'platform') {
		const { remoteBaseUrl, authToken } = get(netConfig);
		if (authToken) {
			void platformLogout(remoteBaseUrl, authToken).catch(() => {
				// best-effort:server 已吊销/不可达时本地清理照常,7 天后 token 自然过期
			});
		}
		setAuthToken('');
	}
	currentUser.set(null);
	session.logout();
}

/**
 * 权限检查(组件 / 路由守卫用)。
 * platform 用户以服务端矩阵为准;demo 用户走本地 P08 矩阵;未登录 → false。
 */
export function can(action: PermissionAction): boolean {
	return hasPermission(get(currentUser), action);
}

/** 获取当前用户(同步,非响应式,守卫 / 工具函数用) */
export function getCurrentUser(): User | null {
	return get(currentUser);
}

// === 会话刷新(节流) ===

const REFRESH_THROTTLE_MS = 30_000;
let lastRefreshAt = 0;

/** 是否为 platform 登录态(守卫用,决定是否需要刷新) */
export function isPlatformSession(): boolean {
	return get(currentUser)?.authKind === 'platform';
}

/**
 * 刷新当前用户 + 权限矩阵(platform 身份)。
 *
 * - 节流:30s 内重复调用直接跳过(路由守卫每次导航触发,避免打爆 /me)
 * - force=true 跳过节流(个人中心手动刷新 / 改密后强制同步)
 * - 401(会话被吊销/过期/用户被停用):本地登出并清 token,返回 'revoked'
 * - 网络失败:如实返回 'error',不静默清登录态(可能是临时断网)
 */
export async function refreshCurrentUser(
	force = false
): Promise<'ok' | 'revoked' | 'error' | 'skipped'> {
	const u = get(currentUser);
	if (u?.authKind !== 'platform') return 'skipped';
	const now = Date.now();
	if (!force && now - lastRefreshAt < REFRESH_THROTTLE_MS) return 'skipped';
	lastRefreshAt = now;
	const { remoteBaseUrl, authToken } = get(netConfig);
	if (!authToken) {
		// token 丢失(如手动清了 net-config):本地登出保持一致
		logout();
		return 'revoked';
	}
	try {
		const info = await fetchMe(remoteBaseUrl, authToken);
		applyPlatformSession(info);
		session.login(info.user.username, info.user.displayName);
		return 'ok';
	} catch (e) {
		if (e instanceof PlatformAuthError && e.status === 401) {
			// 会话已被吊销(登出/停用/删除用户/token 过期)→ 立即失效
			setAuthToken('');
			currentUser.set(null);
			session.logout();
			return 'revoked';
		}
		return 'error';
	}
}
