// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// evorule-console-cloud — 平台认证 API 客户端(UV-017 W3)
//
// 对接 evorule-server /api/platform/auth/* 端点:
//   - GET  /api/platform/auth/status   公开:登录页判断是否需要 bootstrap 引导
//   - POST /api/platform/auth/bootstrap 公开:创建首个平台管理员
//   - POST /api/platform/auth/login     公开:登录,返回会话 token + 权限矩阵
//   - POST /api/platform/auth/logout    需认证:吊销当前会话
//   - GET  /api/platform/auth/me        需认证:当前用户 + 最新权限矩阵
//   - POST /api/platform/auth/change-password 需认证:本人改密(需旧密码)
//
// 设计:
//   - 纯 fetch 封装,不依赖 store/localStorage(可测试;状态管理在 stores/auth.ts)
//   - 错误如实上抛 PlatformAuthError(status + 服务端 message,不静默降级):
//     网络不可达 status=0,由调用方区分"server 未启动"与"凭据错误"
//   - 响应字段与 server 对齐:login/me 返回
//     { user{username,displayName,email,department,role}, permissions[], permissions_version }

/** 平台用户(server 下发字段,camelCase 对齐) */
export interface PlatformUserInfo {
	username: string;
	displayName: string;
	email: string;
	department: string;
	role: string;
}

/** 登录 / me 成功响应(权限矩阵随行下发,前端 can() 以此为准) */
export interface PlatformSessionInfo {
	user: PlatformUserInfo;
	permissions: string[];
	permissionsVersion: number;
}

export interface PlatformLoginResult extends PlatformSessionInfo {
	token: string;
	expiresAtMs: number;
}

/** 平台认证错误(统一 401/403/4xx JSON 体 {success,message}) */
export class PlatformAuthError extends Error {
	readonly status: number;
	/** server 明确给出 message 时为 true(网络错误时为 false,提示语由调用方拼) */
	readonly hasServerMessage: boolean;

	constructor(message: string, status: number, hasServerMessage = true) {
		super(message);
		this.name = 'PlatformAuthError';
		this.status = status;
		this.hasServerMessage = hasServerMessage;
	}
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

/** 统一请求:非 2xx 解析 JSON 体取 message;网络错误 status=0 */
async function request<T>(
	baseUrl: string,
	path: string,
	init: RequestInit & { token?: string | null } = {}
): Promise<T> {
	const { token, headers, ...rest } = init;
	let r: Response;
	try {
		r = await fetch(normalizeBaseUrl(baseUrl) + path, {
			...rest,
			headers: {
				...(headers as Record<string, string> | undefined),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		});
	} catch (e) {
		throw new PlatformAuthError(
			`无法连接 evorule-server(${(e as Error).message});请确认 server 已启动`,
			0,
			false
		);
	}
	// 2xx:解析 JSON(空体容错)
	if (r.ok) {
		if (r.status === 204) return undefined as T;
		const ct = r.headers.get('content-type') || '';
		if (!ct.includes('json')) return undefined as T;
		return (await r.json()) as T;
	}
	// 非 2xx:统一错误体 {success:false,message}
	let message = `HTTP ${r.status}`;
	let hasServerMessage = false;
	try {
		const body = (await r.json()) as { message?: string };
		if (body && typeof body.message === 'string' && body.message.length > 0) {
			message = body.message;
			hasServerMessage = true;
		}
	} catch {
		// 无 JSON 体,保留 HTTP 状态码消息
	}
	throw new PlatformAuthError(message, r.status, hasServerMessage);
}

/** `GET /api/platform/auth/status` — 是否需要 bootstrap(尚无任何用户) */
export async function fetchAuthStatus(baseUrl: string): Promise<{ needsBootstrap: boolean }> {
	const v = await request<{ success: boolean; needs_bootstrap: boolean }>(
		baseUrl,
		'/api/platform/auth/status'
	);
	return { needsBootstrap: v.needs_bootstrap === true };
}

/** `POST /api/platform/auth/bootstrap` — 创建首个平台管理员(仅无用户时可用) */
export async function bootstrapAdmin(
	baseUrl: string,
	username: string,
	password: string,
	displayName = ''
): Promise<void> {
	await request<{ success: boolean }>(baseUrl, '/api/platform/auth/bootstrap', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username,
			password,
			display_name: displayName,
		}),
	});
}

/** `POST /api/platform/auth/login` — 登录,token + 权限矩阵一次拿全 */
export async function platformLogin(
	baseUrl: string,
	username: string,
	password: string
): Promise<PlatformLoginResult> {
	const v = await request<{
		success: boolean;
		token: string;
		expires_at_ms: number;
		user: PlatformUserInfo;
		permissions: string[];
		permissions_version: number;
	}>(baseUrl, '/api/platform/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password }),
	});
	return {
		token: v.token,
		expiresAtMs: v.expires_at_ms,
		user: v.user,
		permissions: v.permissions,
		permissionsVersion: v.permissions_version,
	};
}

/** `POST /api/platform/auth/logout` — 吊销当前会话 */
export async function platformLogout(baseUrl: string, token: string): Promise<void> {
	await request<{ success: boolean }>(baseUrl, '/api/platform/auth/logout', {
		method: 'POST',
		token,
	});
}

/** `GET /api/platform/auth/me` — 当前用户 + 最新权限矩阵(前端 can() 刷新用) */
export async function fetchMe(baseUrl: string, token: string): Promise<PlatformSessionInfo> {
	const v = await request<{
		success: boolean;
		user: PlatformUserInfo;
		permissions: string[];
		permissions_version: number;
	}>(baseUrl, '/api/platform/auth/me', { token });
	return {
		user: v.user,
		permissions: v.permissions,
		permissionsVersion: v.permissions_version,
	};
}

/** `POST /api/platform/auth/change-password` — 本人改密(需旧密码) */
export async function platformChangePassword(
	baseUrl: string,
	token: string,
	oldPassword: string,
	newPassword: string
): Promise<void> {
	await request<{ success: boolean }>(baseUrl, '/api/platform/auth/change-password', {
		method: 'POST',
		token,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			old_password: oldPassword,
			new_password: newPassword,
		}),
	});
}
