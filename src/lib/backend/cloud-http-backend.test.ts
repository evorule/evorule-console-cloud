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
