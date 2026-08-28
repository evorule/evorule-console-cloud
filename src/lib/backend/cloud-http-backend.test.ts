// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// CloudHttpBackend 单测 — 联网/离线切换 + 代理逻辑
//
// 运行: npx vitest run src/lib/backend/cloud-http-backend.test.ts
//
// 测试范围:
//   - 默认配置(offline + localBaseUrl)
//   - online 模式(baseUrl = remoteBaseUrl)
//   - reconfigure 切换 mode 后 baseUrl 变化
//   - config getter 返回副本(外部修改不影响内部)
//   - 代理方法(用 mock fetch 验证 health 调用内部 HttpBackend)
//
// 不测:
//   - HttpBackend 自身的 15 方法逻辑(内核单测已覆盖)
//   - 真实 evorule-server 交互(集成测试范畴)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudHttpBackend } from './cloud-http-backend';
import { DEFAULT_LOCAL_BASE_URL } from './types';
import type { WorkspaceBackend } from '$lib/kernel';

// ============ mock fetch(测代理方法用) ============

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
	mockFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============ 默认配置 ============

describe('CloudHttpBackend 默认配置', () => {
	test('默认 mode=offline', () => {
		const b = new CloudHttpBackend();
		expect(b.mode).toBe('offline');
	});

	test('默认 baseUrl=localBaseUrl(localhost:18080)', () => {
		const b = new CloudHttpBackend();
		expect(b.baseUrl).toBe(DEFAULT_LOCAL_BASE_URL);
	});

	test('默认 config 返回完整结构', () => {
		const b = new CloudHttpBackend();
		expect(b.config).toEqual({
			mode: 'offline',
			remoteBaseUrl: DEFAULT_LOCAL_BASE_URL,
			localBaseUrl: DEFAULT_LOCAL_BASE_URL
		});
	});
});

// ============ online/offline 模式 ============

describe('模式切换(baseUrl 解析)', () => {
	test('offline 模式 baseUrl=localBaseUrl', () => {
		const b = new CloudHttpBackend({
			mode: 'offline',
			localBaseUrl: 'http://local:18080',
			remoteBaseUrl: 'http://remote:9000'
		});
		expect(b.baseUrl).toBe('http://local:18080');
	});

	test('online 模式 baseUrl=remoteBaseUrl', () => {
		const b = new CloudHttpBackend({
			mode: 'online',
			localBaseUrl: 'http://local:18080',
			remoteBaseUrl: 'http://remote:9000'
		});
		expect(b.baseUrl).toBe('http://remote:9000');
	});
});

// ============ reconfigure ============

describe('reconfigure', () => {
	test('切换 mode 后 baseUrl 立即变化', () => {
		const b = new CloudHttpBackend({
			mode: 'offline',
			localBaseUrl: 'http://local:18080',
			remoteBaseUrl: 'http://remote:9000'
		});
		expect(b.baseUrl).toBe('http://local:18080');

		b.reconfigure({ mode: 'online' });
		expect(b.baseUrl).toBe('http://remote:9000');
	});

	test('更新 remoteBaseUrl 后 online 模式 baseUrl 变化', () => {
		const b = new CloudHttpBackend({ mode: 'online', remoteBaseUrl: 'http://old:9000' });
		expect(b.baseUrl).toBe('http://old:9000');

		b.reconfigure({ remoteBaseUrl: 'http://new:9000' });
		expect(b.baseUrl).toBe('http://new:9000');
	});

	test('部分更新(只传 mode,其他字段保留)', () => {
		const b = new CloudHttpBackend({
			mode: 'offline',
			localBaseUrl: 'http://local:18080',
			remoteBaseUrl: 'http://remote:9000'
		});
		b.reconfigure({ mode: 'online' });
		expect(b.config).toEqual({
			mode: 'online',
			localBaseUrl: 'http://local:18080', // 保留
			remoteBaseUrl: 'http://remote:9000' // 保留
		});
	});

	test('切换回 offline 后 baseUrl 回到 local', () => {
		const b = new CloudHttpBackend({
			mode: 'online',
			localBaseUrl: 'http://local:18080',
			remoteBaseUrl: 'http://remote:9000'
		});
		b.reconfigure({ mode: 'offline' });
		expect(b.baseUrl).toBe('http://local:18080');
	});
});

// ============ config getter 返回副本 ============

describe('config getter 不可变性', () => {
	test('修改返回的 config 不影响内部', () => {
		const b = new CloudHttpBackend({ mode: 'offline' });
		const cfg = b.config;
		cfg.mode = 'online';
		cfg.remoteBaseUrl = 'http://hacked:9000';

		// 内部不变
		expect(b.mode).toBe('offline');
		expect(b.config.remoteBaseUrl).toBe(DEFAULT_LOCAL_BASE_URL);
	});
});

// ============ baseUrl 末尾斜杠处理 ============

describe('baseUrl 末尾斜杠处理(委托 HttpBackend)', () => {
	test('传入带末尾斜杠的 URL 被去掉', () => {
		const b = new CloudHttpBackend({
			mode: 'online',
			remoteBaseUrl: 'http://remote:9000/'
		});
		expect(b.baseUrl).toBe('http://remote:9000');
	});
});

// ============ 代理方法验证 ============

describe('代理方法(验证调用内部 HttpBackend)', () => {
	test('health() 调用内部 HttpBackend 的 health', async () => {
		// mock fetch 返回 ok=true(health 端点)
		mockFetch.mockResolvedValue({ ok: true } as Response);

		const b = new CloudHttpBackend({ mode: 'offline', localBaseUrl: 'http://test:18080' });
		const result = await b.health();

		expect(result).toBe(true);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		// 验证 fetch URL 用的是正确的 baseUrl
		const calledUrl = mockFetch.mock.calls[0][0] as string;
		expect(calledUrl).toContain('http://test:18080');
		expect(calledUrl).toContain('/api/health');
	});

	test('reconfigure 后 health() 用新 baseUrl', async () => {
		mockFetch.mockResolvedValue({ ok: true } as Response);

		const b = new CloudHttpBackend({ mode: 'offline', localBaseUrl: 'http://old:18080' });
		b.reconfigure({ mode: 'online', remoteBaseUrl: 'http://new:9000' });
		await b.health();

		const calledUrl = mockFetch.mock.calls[0][0] as string;
		expect(calledUrl).toContain('http://new:9000');
		expect(calledUrl).not.toContain('http://old:18080');
	});
});

// ============ Cloud 专属方法(getProductionState,workspace 委托) ============
//
// 旁路 store 收敛(2026-08-28):读方法改为委托注入的内核 WorkspaceBackend
// (带 Bearer token,URL 拼接/reconfigure 属 HttpWorkspaceBackend 职责),
// 不再自建 fetch 直连 /api/production/state。
// 委托/降级/凭据的详细用例见 __tests__/cloud-http-backend.test.ts 与
// __tests__/production-state.test.ts;此处仅保留注入语义冒烟。

describe('Cloud 专属方法 getProductionState(workspace 委托)', () => {
	/** 最小 WorkspaceBackend mock */
	function mockWorkspace(impl: () => Promise<unknown>): WorkspaceBackend {
		return { getProductionState: impl } as unknown as WorkspaceBackend;
	}

	test('注入 workspace 时委托并映射为视图', async () => {
		const b = new CloudHttpBackend(
			{ mode: 'offline' },
			mockWorkspace(async () => ({
				current_session_id: 42,
				ruleset_version: 3,
				ruleset_hash: 'blake3-abc',
				updated_at: '2026-08-07T12:00:00Z',
			})),
		);
		const ps = await b.getProductionState();

		expect(ps.currentSessionId).toBe(42);
		expect(ps.status).toBe('running');
		// 不再自建 fetch:读方法零直连
		expect(mockFetch).not.toHaveBeenCalled();
	});

	test('未注入 workspace → 返回 offline 默认值(不抛错)', async () => {
		const b = new CloudHttpBackend({ mode: 'offline' });
		const ps = await b.getProductionState();

		expect(ps.status).toBe('offline');
		expect(ps.currentSessionId).toBeNull();
		expect(ps.rulesetVersion).toBe(0);
	});
});

// ============ 执行侧凭据(D1 闭合,2026-08-28) ============
//
// 上游 0073a0c:HttpBackend 增可选 authToken;CloudHttpBackend 构造/reconfigure
// 将 _config.authToken 传入内核,执行侧 15 方法请求统一携带 Bearer 头。

describe('CloudHttpBackend 执行侧凭据(Bearer)', () => {
	function okJson(): Response {
		return {
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({ sessions: [] }),
			text: async () => '{}',
		} as unknown as Response;
	}

	test('配置 authToken:执行侧请求(listSessions)携带 Authorization 头', async () => {
		mockFetch.mockResolvedValueOnce(okJson());
		const b = new CloudHttpBackend({ mode: 'offline', authToken: 'tok-exec' });

		await b.listSessions();

		expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
			Authorization: 'Bearer tok-exec',
		});
	});

	test('未配置 authToken:执行侧请求不带 Authorization 头', async () => {
		mockFetch.mockResolvedValueOnce(okJson());
		const b = new CloudHttpBackend({ mode: 'offline' });

		await b.listSessions();

		const h = mockFetch.mock.calls[0][1]?.headers as Record<string, string> | undefined;
		expect(h?.['Authorization']).toBeUndefined();
	});

	test('reconfigure 更新 authToken:实例引用不变,新 token 生效', async () => {
		mockFetch.mockResolvedValueOnce(okJson());
		const b = new CloudHttpBackend({ mode: 'offline', authToken: 'old-token' });

		b.reconfigure({ authToken: 'new-token' });
		await b.listSessions();

		expect(mockFetch.mock.calls[0][1]?.headers).toMatchObject({
			Authorization: 'Bearer new-token',
		});
	});
});

// ============ 满足 ExecutionBackend 接口 ============

describe('接口完整性', () => {
	test('实现 ExecutionBackend 全部 15 方法', () => {
		const b = new CloudHttpBackend();
		// 会话管理(5)
		expect(typeof b.health).toBe('function');
		expect(typeof b.createSession).toBe('function');
		expect(typeof b.listSessions).toBe('function');
		expect(typeof b.closeSession).toBe('function');
		expect(typeof b.getSessionState).toBe('function');
		// 命令执行(1)
		expect(typeof b.submitCommand).toBe('function');
		// 历史/回放(3)
		expect(typeof b.getHistory).toBe('function');
		expect(typeof b.getReplay).toBe('function');
		expect(typeof b.getFacts).toBe('function');
		// 审计(3)
		expect(typeof b.getAudit).toBe('function');
		expect(typeof b.verifyAudit).toBe('function');
		expect(typeof b.getCausalChain).toBe('function');
		// 时间旅行(2)
		expect(typeof b.getStateAtVersion).toBe('function');
		expect(typeof b.getDiff).toBe('function');
		// What-If(1)
		expect(typeof b.forkSession).toBe('function');
	});
});
