// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// CloudHttpBackend Cloud 专属方法单测 — 读写全委托内核 WorkspaceBackend
//
// 运行: npx vitest run src/lib/backend/__tests__/cloud-http-backend.test.ts
//
// 测试范围:
//   - 读方法(getPublishQueue/getProductionAudit):委托内核 WorkspaceBackend + 视图映射;
//     未注入 workspace 时如实抛错(不静默返回空数组,F3 偏差修正语义)
//   - 写方法(reviewPublishRequest/emergencyRollbackRequest):委托内核并透传参数,
//     操作者身份/角色来自 backend actor(+layout 按登录用户注入,D2 闭合);
//     内核抛错/未注入 workspace → ok=false 错误透传
//
// 不测:
//   - getProductionState(见 stores/__tests__/production-state.test.ts)
//   - 内核 HttpWorkspaceBackend 的身份透传与真实 HTTP 行为(内核单测 + 集成测试范畴)

import { describe, test, expect, vi } from 'vitest';
import { CloudHttpBackend } from '../cloud-http-backend';
import type { PublishQueueItem, ProductionAuditRecord, WorkspaceBackend } from '$lib/kernel';

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
// 写方法:委托内核 WorkspaceBackend(D2 闭合后单通道,身份来自 backend actor)
// ============================================================================

describe('CloudHttpBackend.reviewPublishRequest', () => {
  test('委托 workspace.reviewPublish,透传 queueId 与请求体(不再逐调用传身份)', async () => {
    const reviewPublish = vi.fn().mockResolvedValue({});
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace({ reviewPublish: reviewPublish as unknown as () => Promise<unknown> }),
    );

    const res = await backend.reviewPublishRequest(7, 'approved', '通过');

    expect(res.ok).toBe(true);
    expect(reviewPublish).toHaveBeenCalledTimes(1);
    expect(reviewPublish).toHaveBeenCalledWith(7, {
      decision: 'approved',
      comment: '通过',
    });
  });

  test('workspace.reviewPublish 抛错(如 actor 缺 role)→ ok=false + 错误透传', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace({
        reviewPublish: async () => {
          throw new Error('发布操作需要 actor.role');
        },
      }),
    );

    const res = await backend.reviewPublishRequest(7, 'rejected', 'x');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('actor.role');
  });

  test('未注入 workspace → ok=false(不抛错,与读方法抛错语义区分:调用方仅 toast)', async () => {
    const backend = new CloudHttpBackend({ mode: 'offline' }, null);

    const res = await backend.reviewPublishRequest(7, 'approved', 'x');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('未注入 WorkspaceBackend');
  });
});

describe('CloudHttpBackend.emergencyRollbackRequest', () => {
  test('委托 workspace.emergencyRollback,透传 target_version 与 reason', async () => {
    const emergencyRollback = vi.fn().mockResolvedValue(undefined);
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace({ emergencyRollback: emergencyRollback as unknown as () => Promise<unknown> }),
    );

    const res = await backend.emergencyRollbackRequest(3, '误发布回滚');

    expect(res.ok).toBe(true);
    expect(emergencyRollback).toHaveBeenCalledTimes(1);
    expect(emergencyRollback).toHaveBeenCalledWith({
      target_version: 3,
      reason: '误发布回滚',
    });
  });

  test('workspace.emergencyRollback 抛错 → ok=false + 错误透传', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace({
        emergencyRollback: async () => {
          throw new Error('回滚需要 admin 角色');
        },
      }),
    );

    const res = await backend.emergencyRollbackRequest(3, 'x');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('回滚需要 admin 角色');
  });

  test('未注入 workspace → ok=false', async () => {
    const backend = new CloudHttpBackend({ mode: 'offline' }, null);

    const res = await backend.emergencyRollbackRequest(3, 'x');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('未注入 WorkspaceBackend');
  });
});

// ============================================================================
// 审计档案(UV-016):只读档案端点,直连执行侧 /api/audit-archive
// ============================================================================

describe('CloudHttpBackend 审计档案(UV-016)', () => {
  const ARCHIVE_LIST = {
    sessions: [
      {
        session_id: 7,
        fact_count: 4,
        first_fact_type: 'Command',
        last_fact_type: 'Stable',
        is_llm_sidecar: true,
        audit_purpose: 'draft_rule',
        wal_bytes: 2048,
      },
      {
        session_id: 8,
        fact_count: 2,
        first_fact_type: 'Command',
        last_fact_type: 'Stable',
        is_llm_sidecar: false,
        audit_purpose: null,
        wal_bytes: 512,
      },
    ],
    active_session_ids: [8],
  };

  /** mock 全局 fetch 返回 JSON 响应,并捕获请求参数 */
  function mockFetchJson(payload: unknown): ReturnType<typeof vi.fn> {
    const fn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  test('listArchiveSessions:GET /api/audit-archive/sessions + Bearer 头', async () => {
    const fetchMock = mockFetchJson(ARCHIVE_LIST);
    const backend = new CloudHttpBackend({
      mode: 'offline',
      localBaseUrl: 'http://127.0.0.1:18080',
      authToken: 'tok-1',
    });

    const resp = await backend.listArchiveSessions();

    expect(resp.sessions).toHaveLength(2);
    expect(resp.active_session_ids).toEqual([8]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:18080/api/audit-archive/sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-1',
    );
    vi.unstubAllGlobals();
  });

  test('getArchiveAudit:includeContent=true 追加查询参数', async () => {
    const fetchMock = mockFetchJson({
      session_id: 7,
      fact_count: 2,
      last_hash: 'h',
      verified: true,
      unhashed_records: 0,
      entries: [],
    });
    const backend = new CloudHttpBackend({ mode: 'offline' });

    const audit = await backend.getArchiveAudit(7, true);

    expect(audit.verified).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:18080/api/audit-archive/sessions/7/audit?include_content=true',
    );
    vi.unstubAllGlobals();
  });

  test('getArchiveAudit:默认不带 include_content', async () => {
    const fetchMock = mockFetchJson({
      session_id: 7,
      fact_count: 0,
      last_hash: 'h',
      verified: true,
      unhashed_records: 0,
      entries: [],
    });
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.getArchiveAudit(7);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:18080/api/audit-archive/sessions/7/audit');
    vi.unstubAllGlobals();
  });

  test('档案端点非 2xx → 如实抛 HttpBackendError(不静默降级)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('wal_dir 未启用', { status: 404 })),
    );
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await expect(backend.getArchiveAudit(99, false)).rejects.toThrow('HTTP 404');
    vi.unstubAllGlobals();
  });
});
