// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// production-state 适配层单测 — fetchProductionState 字段映射 + status 推导 + 错误容错
//
// 运行: npx vitest run src/lib/stores/__tests__/production-state.test.ts
//
// 测试范围:
//   - snake_case → camelCase 字段映射(对齐 server ProductionStateRecord)
//   - status 推导(current_session_id null → offline;非 null → running)
//   - updated_at 透传(RFC3339 ISO 字符串)
//   - 错误容错(网络错误 / 非 2xx / JSON 解析失败 → DEFAULT_PRODUCTION_STATE)
//   - 字段缺失防御性处理
//   - baseUrl 末尾斜杠 + URL 拼接
//
// 不测:
//   - 真实 evorule-server 交互(集成测试范畴)
//   - productionStateStore 本身(writable 语义,无需测)
//   - onSessionSwitched SSE 回调(T3 MonitorDashboard 集成测试范畴)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchProductionState,
  DEFAULT_PRODUCTION_STATE,
  type ProductionState,
} from '../production-state';

// ============ mock fetch ============

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============ 工具:构造 mock Response ============

/** 构造 JSON Response(200 + application/json) */
function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** 构造错误 Response(非 2xx) */
function httpError(status: number, body: unknown = { error: 'failed' }): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ============ 服务器原始响应黄金样本 ============
//
// 对齐 evorule-server core/workspace/src/models.rs::ProductionStateRecord
// snake_case 字段: id / current_session_id / ruleset_version / ruleset_hash
//                   last_operated_by / updated_at
// 注意: 服务器不返回 status 字段(cloud 版推导)

const SERVER_RUNNING: unknown = {
  id: 1,
  current_session_id: 42,
  ruleset_version: 3,
  ruleset_hash: 'blake3-abc123',
  last_operated_by: 'admin',
  updated_at: '2026-08-07T12:00:00Z',
};

const SERVER_OFFLINE: unknown = {
  id: 1,
  current_session_id: null,
  ruleset_version: 0,
  ruleset_hash: null,
  last_operated_by: null,
  updated_at: '2026-08-07T10:00:00Z',
};

// ============================================================================
// 字段映射 + status 推导
// ============================================================================

describe('fetchProductionState 字段映射', () => {
  test('running 状态: current_session_id 非 null → status="running" + camelCase 映射', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_RUNNING));

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.currentSessionId).toBe(42);
    expect(ps.rulesetVersion).toBe(3);
    expect(ps.rulesetHash).toBe('blake3-abc123');
    expect(ps.status).toBe('running');
    expect(ps.updatedAt).toBe('2026-08-07T12:00:00Z');
  });

  test('offline 状态: current_session_id=null → status="offline"', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_OFFLINE));

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.currentSessionId).toBeNull();
    expect(ps.rulesetVersion).toBe(0);
    expect(ps.rulesetHash).toBeNull();
    expect(ps.status).toBe('offline');
    expect(ps.updatedAt).toBe('2026-08-07T10:00:00Z');
  });

  test('id / last_operated_by 被丢弃(不出现在 ProductionState)', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_RUNNING));

    const ps = await fetchProductionState('http://localhost:18080');

    // ProductionState 接口只有 5 字段,不含 id / last_operated_by
    expect(Object.keys(ps).sort()).toEqual(
      ['currentSessionId', 'rulesetHash', 'rulesetVersion', 'status', 'updatedAt'].sort(),
    );
  });
});

// ============================================================================
// status 推导(核心逻辑)
// ============================================================================

describe('status 推导', () => {
  test('current_session_id=0 时仍视为 running(0 是合法 session_id)', async () => {
    // session_id 从 0 开始,0 是有效值,不是 null
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        id: 1,
        current_session_id: 0,
        ruleset_version: 1,
        ruleset_hash: 'hash-0',
        updated_at: '2026-08-07T00:00:00Z',
      }),
    );

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.currentSessionId).toBe(0);
    expect(ps.status).toBe('running'); // 0 !== null
  });

  test('"switching" 不来自轮询(只由 onSessionSwitched SSE 事件设置)', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_RUNNING));

    const ps = await fetchProductionState('http://localhost:18080');

    // 轮询只能得到 running 或 offline,绝不会是 switching
    expect(ps.status).not.toBe('switching');
  });
});

// ============================================================================
// 错误容错(与内核 health() 哲学一致:不抛错,返回默认值)
// ============================================================================

describe('错误容错', () => {
  test('fetch 抛 TypeError(网络错误) → 返回 DEFAULT_PRODUCTION_STATE', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('ECONNREFUSED'));

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps).toEqual(DEFAULT_PRODUCTION_STATE);
    expect(ps.status).toBe('offline');
  });

  test('HTTP 404(未初始化) → 返回 DEFAULT_PRODUCTION_STATE', async () => {
    mockFetch.mockResolvedValueOnce(httpError(404));

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps).toEqual(DEFAULT_PRODUCTION_STATE);
    expect(ps.status).toBe('offline');
  });

  test('HTTP 500(服务器错误) → 返回 DEFAULT_PRODUCTION_STATE', async () => {
    mockFetch.mockResolvedValueOnce(httpError(500));

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps).toEqual(DEFAULT_PRODUCTION_STATE);
  });

  test('r.json() 抛 SyntaxError(非 JSON 响应) → 返回 DEFAULT_PRODUCTION_STATE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
      text: async () => '<html>Not Found</html>',
    } as unknown as Response);

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps).toEqual(DEFAULT_PRODUCTION_STATE);
  });

  test('返回的默认值是副本(修改不影响 DEFAULT_PRODUCTION_STATE 常量)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('network'));

    const ps = await fetchProductionState('http://localhost:18080');
    ps.status = 'running';
    ps.rulesetVersion = 999;

    // 原始常量不受影响
    expect(DEFAULT_PRODUCTION_STATE.status).toBe('offline');
    expect(DEFAULT_PRODUCTION_STATE.rulesetVersion).toBe(0);
  });
});

// ============================================================================
// 字段缺失防御性处理
// ============================================================================

describe('字段缺失防御性处理', () => {
  test('服务器返回空对象 {} → 全部字段降级为默认值', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({}));

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.currentSessionId).toBeNull();
    expect(ps.rulesetVersion).toBe(0);
    expect(ps.rulesetHash).toBeNull();
    expect(ps.status).toBe('offline'); // currentSessionId null → offline
    expect(ps.updatedAt).toBeNull();
  });

  test('current_session_id 类型错误(字符串)→ 视为 null → offline', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        current_session_id: 'not-a-number',
        ruleset_version: 1,
      }),
    );

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.currentSessionId).toBeNull();
    expect(ps.status).toBe('offline');
    // ruleset_version 是 number,正常映射
    expect(ps.rulesetVersion).toBe(1);
  });

  test('ruleset_version 类型错误(字符串)→ 降级为 0', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        current_session_id: 5,
        ruleset_version: 'three',
      }),
    );

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.currentSessionId).toBe(5);
    expect(ps.status).toBe('running'); // currentSessionId 非 null
    expect(ps.rulesetVersion).toBe(0); // 类型错误降级
  });

  test('updated_at 缺失 → null', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({
        current_session_id: 1,
        ruleset_version: 1,
      }),
    );

    const ps = await fetchProductionState('http://localhost:18080');

    expect(ps.updatedAt).toBeNull();
  });
});

// ============================================================================
// URL 拼接 + baseUrl 处理
// ============================================================================

describe('URL 拼接', () => {
  test('正确拼接 /api/production/state', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_OFFLINE));

    await fetchProductionState('http://localhost:18080');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://localhost:18080/api/production/state');
  });

  test('baseUrl 末尾斜杠被去掉(避免 //)', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_OFFLINE));

    await fetchProductionState('http://localhost:18080///');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://localhost:18080/api/production/state');
    expect(calledUrl).not.toContain('//api');
  });

  test('remote baseUrl 也正确拼接', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_OFFLINE));

    await fetchProductionState('https://api.example.com');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://api.example.com/api/production/state');
  });
});

// ============================================================================
// 集成:refreshProductionState + fetchProductionState
// ============================================================================

describe('refreshProductionState + fetchProductionState 集成', () => {
  test('fetchProductionState 作为 fetcher 传入 refreshProductionState 更新 store', async () => {
    // 动态 import 避免 store 在 mock fetch 设置前初始化
    const { productionStateStore, refreshProductionState } = await import('../production-state');

    mockFetch.mockResolvedValueOnce(jsonOk(SERVER_RUNNING));

    await refreshProductionState(() => fetchProductionState('http://localhost:18080'));

    // store 应被更新为 running 状态
    let current: ProductionState | undefined;
    const unsub = productionStateStore.subscribe((s) => {
      current = s;
    });
    expect(current?.status).toBe('running');
    expect(current?.rulesetVersion).toBe(3);
    unsub();
  });
});
