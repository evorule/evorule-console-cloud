// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// platform-auth-api 单元测试(vitest,node 环境,stub 全局 fetch)。
// 覆盖:字段映射(snake_case → camelCase)/ 错误体解析 / 网络错误 status=0 /
//       Authorization 头注入 / needs_bootstrap 映射 / 应用凭据与配额契约
//       (58 W3 签发吊销;59 W2 配额透出与全量覆盖更新)。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	fetchAuthStatus,
	bootstrapAdmin,
	platformLogin,
	platformLogout,
	fetchMe,
	platformChangePassword,
	listApps,
	issueApp,
	updateAppQuota,
	revokeApp,
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

	it('platformLogin:server 错误体带 code → message 本地化(i18n 阶段2)', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(401, { success: false, message: '无权限', code: 'UNAUTHORIZED' })
		);
		const err = await platformLogin(BASE, 'root', 'wrong').catch((e) => e);
		expect(err).toBeInstanceOf(PlatformAuthError);
		// 命中 err.UNAUTHORIZED 字典 → 展示本地化文案
		expect((err as PlatformAuthError).message).toBe(
			'无权限执行此操作，请登录或确认权限。'
		);
	});

	it('platformLogin:server 错误体带未知 code → 回退原始 message', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(400, { success: false, message: '原始中文兜底', code: 'NO_SUCH_CODE_XYZ' })
		);
		const err = await platformLogin(BASE, 'root', 'bad').catch((e) => e);
		expect(err).toBeInstanceOf(PlatformAuthError);
		// translateServerError 未命中 → 原样回退,不丢信息
		expect((err as PlatformAuthError).message).toBe('原始中文兜底');
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

	// --- 应用凭据与配额(58 W3 / 59 W2) ---

	it('listApps:配额字段透出映射(snake_case → camelCase,null=不限)', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				success: true,
				apps: [
					{
						app_id: 'evo-agent',
						key_hash: 'blake3:aa',
						status: 'ACTIVE',
						description: '外部应用',
						created_at_ms: 1759999999999,
						rate_limit_per_sec: 5,
						daily_quota: 1000,
						today_usage: 42,
					},
					{
						app_id: 'legacy',
						key_hash: 'blake3:bb',
						status: 'REVOKED',
						description: '',
						created_at_ms: 1759999999998,
						rate_limit_per_sec: null,
						daily_quota: null,
						today_usage: 0,
					},
				],
			})
		);
		const r = await listApps(BASE, 'tok');
		expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:18080/api/platform/apps');
		expect(r.apps).toHaveLength(2);
		expect(r.apps[0].rateLimitPerSec).toBe(5);
		expect(r.apps[0].dailyQuota).toBe(1000);
		expect(r.apps[0].todayUsage).toBe(42);
		// null=不限如实透传(不默认 0/不省略)
		expect(r.apps[1].rateLimitPerSec).toBeNull();
		expect(r.apps[1].dailyQuota).toBeNull();
	});

	it('issueApp:签发请求体携带配额(缺省=null 透传)', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(201, {
				success: true,
				app_id: 'evo-agent',
				key: 'evorule-key-plain',
				created_at_ms: 1759999999999,
			})
		);
		// 带配额签发
		await issueApp(BASE, 'tok', {
			appId: 'evo-agent',
			description: '外部应用',
			rateLimitPerSec: 5,
			dailyQuota: 1000,
		});
		expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
			app_id: 'evo-agent',
			description: '外部应用',
			rate_limit_per_sec: 5,
			daily_quota: 1000,
		});
		// 缺省签发(不限) → null(非 undefined——JSON 序列化后 server 侧 serde default 语义等价)
		await issueApp(BASE, 'tok', { appId: 'plain-app' });
		expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
			app_id: 'plain-app',
			description: '',
			rate_limit_per_sec: null,
			daily_quota: null,
		});
	});

	it('updateAppQuota:POST {id}/quota,全量覆盖语义 body 为 snake_case', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
		await updateAppQuota(BASE, 'tok', 'evo-agent', {
			rateLimitPerSec: 10,
			dailyQuota: null,
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://127.0.0.1:18080/api/platform/apps/evo-agent/quota');
		expect((init as RequestInit).method).toBe('POST');
		expect(JSON.parse((init as RequestInit).body as string)).toEqual({
			rate_limit_per_sec: 10,
			daily_quota: null,
		});
	});

	it('revokeApp:POST {id}/revoke,无请求体', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
		await revokeApp(BASE, 'tok', 'legacy-app');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://127.0.0.1:18080/api/platform/apps/legacy-app/revoke');
		expect((init as RequestInit).method).toBe('POST');
	});
});
