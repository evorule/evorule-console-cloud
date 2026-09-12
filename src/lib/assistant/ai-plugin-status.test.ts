// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// evorule-console-cloud — ai-plugin 状态解析单测(UV-177)
// 锁定 parseAiPluginStatus 三态判定 + fetchAiPluginStatus 失败兜底

import { describe, test, expect, vi, afterEach } from 'vitest';
import {
	parseAiPluginStatus,
	fetchAiPluginStatus,
	AI_PLUGIN_ID
} from './ai-plugin-status';

/** 构造 /api/health 响应(形态对齐 server.rs HealthResponse + merge_liveness) */
function healthWith(node: unknown): Record<string, unknown> {
	return { success: true, message: 'ok', plugins: { [AI_PLUGIN_ID]: node } };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('parseAiPluginStatus — disabled 态', () => {
	test('plugins 节缺 ai-plugin 条目 → disabled(分发版空清单形态)', () => {
		expect(parseAiPluginStatus({ success: true, plugins: {} })).toEqual({ state: 'disabled' });
	});

	test('enabled:false → disabled(仓库缺省清单形态)', () => {
		expect(parseAiPluginStatus(healthWith({ enabled: false }))).toEqual({ state: 'disabled' });
	});

	test('enabled 非布尔 true(如字符串 "true")→ disabled(形态漂移不虚构就绪)', () => {
		expect(parseAiPluginStatus(healthWith({ enabled: 'true' }))).toEqual({ state: 'disabled' });
	});
});

describe('parseAiPluginStatus — enabled 后三态', () => {
	test('external + status=online → ready', () => {
		expect(
			parseAiPluginStatus(healthWith({ enabled: true, external: true, status: 'online' }))
		).toEqual({ state: 'ready' });
	});

	test('status=offline → unreachable + last_error 透出', () => {
		expect(
			parseAiPluginStatus(
				healthWith({
					enabled: true,
					external: true,
					status: 'offline',
					last_error: 'connection refused'
				})
			)
		).toEqual({ state: 'unreachable', lastError: 'connection refused' });
	});

	test('enabled 但无存活快照(探活任务未运行)→ unreachable 无 lastError', () => {
		expect(parseAiPluginStatus(healthWith({ enabled: true, external: true }))).toEqual({
			state: 'unreachable'
		});
	});

	test('status=no_probe → no_probe(插件未实现 /health 容错兜底)', () => {
		expect(parseAiPluginStatus(healthWith({ enabled: true, status: 'no_probe' }))).toEqual({
			state: 'no_probe'
		});
	});

	test('last_error 为空串 → 不透出', () => {
		expect(
			parseAiPluginStatus(healthWith({ enabled: true, status: 'offline', last_error: '' }))
		).toEqual({ state: 'unreachable' });
	});
});

describe('parseAiPluginStatus — unknown/容错', () => {
	test('响应缺 plugins 节 → unknown(非 ai-plugin 缺席,是健康面不可解析)', () => {
		expect(parseAiPluginStatus({ success: true })).toEqual({ state: 'unknown' });
	});

	test('非对象/null/原始值 → unknown', () => {
		for (const bad of [null, 'str', 42, []]) {
			expect(parseAiPluginStatus(bad)).toEqual({ state: 'unknown' });
		}
	});

	test('ai-plugin 条目为非对象(形态漂移)→ unknown,不误判 disabled', () => {
		expect(parseAiPluginStatus(healthWith('garbage'))).toEqual({ state: 'unknown' });
	});
});

describe('fetchAiPluginStatus', () => {
	test('2xx JSON → 透传 parseAiPluginStatus 判定', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(healthWith({ enabled: true, status: 'online' })), {
					status: 200
				})
			)
		);
		expect(await fetchAiPluginStatus('http://127.0.0.1:18080')).toEqual({ state: 'ready' });
	});

	test('authToken 非空 → 请求携带 Bearer 头;尾斜杠归一', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(healthWith({ enabled: false })), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
		await fetchAiPluginStatus('http://127.0.0.1:18080///', 'tok-123');
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('http://127.0.0.1:18080/api/health');
		expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123');
	});

	test('网络失败 → unknown,不抛错', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		expect(await fetchAiPluginStatus('http://127.0.0.1:18080')).toEqual({ state: 'unknown' });
	});

	test('非 2xx → unknown(server 未起但端口被占等)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('oops', { status: 500 }))
		);
		expect(await fetchAiPluginStatus('http://127.0.0.1:18080')).toEqual({ state: 'unknown' });
	});

	test('2xx 但 body 非 JSON → unknown', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response('<html>not json</html>', { status: 200 }))
		);
		expect(await fetchAiPluginStatus('http://127.0.0.1:18080')).toEqual({ state: 'unknown' });
	});
});
