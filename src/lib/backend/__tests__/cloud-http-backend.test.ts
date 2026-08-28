// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// CloudHttpBackend Cloud 专属方法单测 — 读委托 workspace / 写自建 fetch 凭据与请求体
//
// 运行: npx vitest run src/lib/backend/__tests__/cloud-http-backend.test.ts
//
// 测试范围:
//   - 读方法(getPublishQueue/getProductionAudit):委托内核 WorkspaceBackend + 视图映射;
//     未注入 workspace 时如实抛错(不静默返回空数组,F3 偏差修正语义)
//   - 写方法(reviewPublishRequest/emergencyRollbackRequest):自建 fetch 请求体对齐
//     server api.rs;配置 authToken 时携带 Authorization: Bearer 头(T1-T4 凭据闭环);
//     非 2xx / 网络错误 → ok=false 且含错误信息
//
// 不测:
//   - getProductionState(见 stores/__tests__/production-state.test.ts)
//   - 内核 HttpWorkspaceBackend 的真实 HTTP 行为(集成测试范畴)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudHttpBackend } from '../cloud-http-backend';
import type { PublishQueueItem, ProductionAuditRecord, WorkspaceBackend } from '$lib/kernel';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function httpError(status: number, body: unknown = { error: 'failed' }): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** 最小 WorkspaceBackend mock(只实现被测方法) */
function mockWorkspace(methods: Record<string, () => Promise<unknown>>): WorkspaceBackend {
  return methods as unknown as WorkspaceBackend;
}

const QUEUE_ITEM: PublishQueueItem = {
  id: 7,
  workspace_id: 'ws-1',
  final_candidate_rules: '[]',
  ruleset_hash: 'abc123',
  test_report_sandbox_id: null,
  submitted_by: 'head-1',
  submitted_at: '2026-08-24T00:00:00Z',
  reviewed_by: null,
  reviewed_at: null,
  review_comment: null,
  published_version: null,
  published_at: null,
  status: 'pending',
  description: null,
};

// ============================================================================
// 读方法:委托内核 WorkspaceBackend
// ============================================================================

describe('CloudHttpBackend 读方法', () => {
  test('getPublishQueue:委托 workspace.listPublishQueue 并映射为视图', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace({ listPublishQueue: async () => [QUEUE_ITEM] }),
    );

    const list = await backend.getPublishQueue();

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('7');
    expect(list[0].status).toBe('pending');
  });

  test('getPublishQueue:未注入 workspace → 如实抛错(不静默返回空数组)', async () => {
    const backend = new CloudHttpBackend({ mode: 'offline' }, null);

    await expect(backend.getPublishQueue()).rejects.toThrow('发布队列不可用');
  });

  test('getProductionAudit:委托 workspace.listProductionAudit 并过滤映射', async () => {
    const records: ProductionAuditRecord[] = [
      {
        id: 3,
        event_type: 'ruleset_published',
        ruleset_version: 1,
        previous_version: 0,
        ruleset_hash: 'h1',
        tcb_session_id: 2,
        source_workspace_ids: '["ws-1"]',
        operated_by: 'admin-1',
        operated_at: '2026-08-24T00:02:00Z',
        reason: null,
        test_report_paths: null,
        ruleset_snapshot: null,
      },
    ];
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace({ listProductionAudit: async () => records }),
    );

    const history = await backend.getProductionAudit();

    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
  });

  test('getProductionAudit:未注入 workspace → 如实抛错', async () => {
    const backend = new CloudHttpBackend({ mode: 'offline' }, null);

    await expect(backend.getProductionAudit()).rejects.toThrow('版本历史不可用');
  });
});

// ============================================================================
// 写方法:自建 fetch(凭据 + 请求体)
// ============================================================================

describe('CloudHttpBackend.reviewPublishRequest', () => {
  test('成功:请求体对齐 server api.rs + 配置 token 时携带 Bearer 头', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    const backend = new CloudHttpBackend({
      mode: 'offline',
      authToken: 'tok-123',
    });

    const res = await backend.reviewPublishRequest(7, 'approved', '通过', 'admin-1', 'admin');

    expect(res.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:18080/api/publish/queue/7/review');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer tok-123',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      decision: 'approved',
      comment: '通过',
      reviewed_by: 'admin-1',
      role: 'admin',
    });
  });

  test('未配置 token:请求不带 Authorization 头(免认证 server 可用)', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.reviewPublishRequest(7, 'rejected', '驳回', 'admin-1', 'admin');

    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  test('非 2xx → ok=false + 含状态码与响应片段', async () => {
    mockFetch.mockResolvedValueOnce(httpError(400, { error: 'bad request' }));
    const backend = new CloudHttpBackend({ mode: 'offline' });

    const res = await backend.reviewPublishRequest(7, 'rejected', 'x', 'admin-1', 'admin');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('400');
  });

  test('网络错误 → ok=false', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const backend = new CloudHttpBackend({ mode: 'offline' });

    const res = await backend.reviewPublishRequest(7, 'approved', 'x', 'admin-1', 'admin');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('网络错误');
  });
});

describe('CloudHttpBackend.emergencyRollbackRequest', () => {
  test('成功:请求体对齐 server api.rs + Bearer 头', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ new_ruleset_version: 4, rolled_back_to: 3 }));
    const backend = new CloudHttpBackend({
      mode: 'offline',
      authToken: 'tok-123',
    });

    const res = await backend.emergencyRollbackRequest(3, '误发布回滚', 'admin-1', 'admin');

    expect(res.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:18080/api/publish/rollback');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok-123' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      target_version: 3,
      reason: '误发布回滚',
      operated_by: 'admin-1',
      role: 'admin',
    });
  });

  test('网络错误 → ok=false', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const backend = new CloudHttpBackend({ mode: 'offline' });

    const res = await backend.emergencyRollbackRequest(3, 'x', 'admin-1', 'admin');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('网络错误');
  });
});
