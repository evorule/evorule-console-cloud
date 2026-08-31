// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// platform-auth-api 单元测试(vitest,node 环境,stub 全局 fetch)。
// 覆盖:字段映射(snake_case → camelCase)/ 错误体解析 / 网络错误 status=0 /
//       Authorization 头注入 / needs_bootstrap 映射。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	fetchAuthStatus,
	bootstrapAdmin,
	platformLogin,
	platformLogout,
	fetchMe,
	platformChangePassword,
	PlatformAuthError,
} from './platform-auth-api';

const BASE = 'http://127.0.0.1:18080/';

// fetch stub 容器
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

describe('platform-auth-api', () => {
	it('platformLogin:正常响应映射 token/权限/版本(snake_case → camelCase)', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				success: true,
				token: 'tok-123',
				expires_at_ms: 1759999999999,
				user: {
					username: 'root',
					displayName: '管理员',
					email: 'r@e.io',
					department: '平台组',
					role: 'administrator',
				},
				permissions: ['manage_users', 'view_monitor'],
				permissions_version: 7,
			})
		);
		const r = await platformLogin(BASE, 'root', 'pass-123456');
		// URL 规范化:末尾斜杠去掉
		expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:18080/api/platform/auth/login');
		expect(r.token).toBe('tok-123');
		expect(r.expiresAtMs).toBe(1759999999999);
		expect(r.user.role).toBe('administrator');
		expect(r.permissions).toEqual(['manage_users', 'view_monitor']);
		expect(r.permissionsVersion).toBe(7);
		// 请求体为 snake_case
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(JSON.parse(init.body as string)).toEqual({
			username: 'root',
			password: 'pass-123456',
		});
	});

	it('platformLogin:凭据错误 401 → 抛 PlatformAuthError(携带服务端 message)', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(401, { success: false, message: '用户名或密码错误' })
		);
		const err = await platformLogin(BASE, 'root', 'wrong').catch((e) => e);
		expect(err).toBeInstanceOf(PlatformAuthError);
		expect((err as PlatformAuthError).status).toBe(401);
		expect((err as PlatformAuthError).message).toBe('用户名或密码错误');
		expect((err as PlatformAuthError).hasServerMessage).toBe(true);
	});

	it('网络不可达 → status=0 + 连接提示(如实报错,不静默)', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		const err = await fetchAuthStatus(BASE).catch((e) => e);
		expect(err).toBeInstanceOf(PlatformAuthError);
		expect((err as PlatformAuthError).status).toBe(0);
		expect((err as PlatformAuthError).message).toContain('无法连接 evorule-server');
	});

	it('fetchAuthStatus:映射 needs_bootstrap + demo_auth', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, { success: true, needs_bootstrap: true, demo_auth: false })
		);
		const s = await fetchAuthStatus(BASE);
		expect(s.needsBootstrap).toBe(true);
		expect(s.demoAuth).toBe(false);
	});

	it('fetchAuthStatus:demo_auth 缺省 true(兼容旧 server,保留演示入口)', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, { success: true, needs_bootstrap: false })
		);
		const s = await fetchAuthStatus(BASE);
		expect(s.demoAuth).toBe(true);
	});

	it('bootstrapAdmin:POST body 为 snake_case display_name', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(201, { success: true, username: 'admin' })
		);
		await bootstrapAdmin(BASE, 'admin', 'pass-123456', '管理员');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://127.0.0.1:18080/api/platform/auth/bootstrap');
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			username: 'admin',
			password: 'pass-123456',
			display_name: '管理员',
		});
	});

	it('需认证端点:token 注入 Authorization: Bearer 头', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				success: true,
				user: {
					username: 'root',
					displayName: '管理员',
					email: '',
					department: '',
					role: 'administrator',
				},
				permissions: [],
				permissions_version: 1,
			})
		);
		await fetchMe(BASE, 'my-token');
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer my-token');
	});

	it('platformLogout / platformChangePassword:路径与请求体正确', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
		await platformLogout(BASE, 't');
		expect(fetchMock.mock.calls[0][0]).toBe(
			'http://127.0.0.1:18080/api/platform/auth/logout'
		);
		await platformChangePassword(BASE, 't', 'old-pass-1', 'new-pass-1');
		const [url, init] = fetchMock.mock.calls[1];
		expect(url).toBe('http://127.0.0.1:18080/api/platform/auth/change-password');
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			old_password: 'old-pass-1',
			new_password: 'new-pass-1',
		});
	});
});
