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
  kind: 'normal',
  meta_rule_content: null,
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

    await expect(backend.getPublishQueue()).rejects.toThrow('部署审批不可用');
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
// 审计档案():只读档案端点,直连执行侧 /api/audit-archive
// ============================================================================

describe('CloudHttpBackend 审计档案()', () => {
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

// ============================================================================
// 平台认证事件():只读报表端点 /api/audit/platform-events
// ============================================================================

describe('CloudHttpBackend 平台认证事件()', () => {
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

  const EVENTS = {
    total: 2,
    events: [
      {
        fact_id: 1,
        path: 'platform.event.login_failed.1725000000001aaaa1111bbbb2222',
        kind: 'login_failed',
        ts_ms: 1725000000001,
        detail: { username: 'bob' },
      },
      {
        fact_id: 2,
        path: 'platform.event.user_created.1725000000002cccc3333dddd4444',
        kind: 'user_created',
        ts_ms: 1725000000002,
        detail: { username: 'carol', by: 'admin' },
      },
    ],
  };

  test('listPlatformEvents:GET /api/audit/platform-events + Bearer 头', async () => {
    const fetchMock = mockFetchJson(EVENTS);
    const backend = new CloudHttpBackend({
      mode: 'offline',
      localBaseUrl: 'http://127.0.0.1:18080',
      authToken: 'tok-1',
    });

    const resp = await backend.listPlatformEvents();

    expect(resp.total).toBe(2);
    expect(resp.events[0].kind).toBe('login_failed');
    expect(resp.events[1].detail).toEqual({ username: 'carol', by: 'admin' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:18080/api/audit/platform-events');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-1',
    );
    vi.unstubAllGlobals();
  });

  test('listPlatformEvents:kind 过滤 + limit 追加查询参数', async () => {
    const fetchMock = mockFetchJson({ total: 1, events: [EVENTS.events[0]] });
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.listPlatformEvents('login_failed', 50);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:18080/api/audit/platform-events?kind=login_failed&limit=50',
    );
    vi.unstubAllGlobals();
  });

  test('listPlatformEvents:无过滤参数时不带查询串', async () => {
    const fetchMock = mockFetchJson({ total: 0, events: [] });
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.listPlatformEvents();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:18080/api/audit/platform-events');
    vi.unstubAllGlobals();
  });

  test('端点非 2xx → 如实抛 HttpBackendError(不静默降级)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('未认证', { status: 401 })),
    );
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await expect(backend.listPlatformEvents()).rejects.toThrow('HTTP 401');
    vi.unstubAllGlobals();
  });
});

// ============================================================================
// bundle 导入溯源(④):部署历史端点 /api/bundles/imports
// ============================================================================

describe('CloudHttpBackend bundle 导入溯源(④)', () => {
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

  const IMPORTS = {
    imports: [
      {
        id: 2,
        bundle_id: 'bundle-ds-tax-2024-v2',
        dataset_id: 'ds-tax-2024',
        source_version: 'v2',
        selection_mode: 'pinned',
        resolved_version: 'v2',
        content_hash: 'blake3:aaaabbbbccccdddd',
        entry_count: 5,
        imported_at: '2026-09-01T08:00:00Z',
        imported_by: 'publisher-01',
      },
      {
        id: 1,
        bundle_id: 'bundle-ds-tax-2024-v1',
        dataset_id: 'ds-tax-2024',
        source_version: 'v1',
        selection_mode: 'auto_by_effective_date',
        resolved_version: null,
        content_hash: 'blake3:1111222233334444',
        entry_count: 3,
        imported_at: '2026-08-24T12:00:00Z',
        imported_by: 'system',
      },
    ],
    count: 2,
  };

  test('listBundleImports:GET /api/bundles/imports + Bearer 头 + 响应解析', async () => {
    const fetchMock = mockFetchJson(IMPORTS);
    const backend = new CloudHttpBackend({
      mode: 'offline',
      localBaseUrl: 'http://127.0.0.1:18080',
      authToken: 'tok-1',
    });

    const resp = await backend.listBundleImports();

    expect(resp.count).toBe(2);
    expect(resp.imports[0].bundle_id).toBe('bundle-ds-tax-2024-v2');
    expect(resp.imports[1].resolved_version).toBeNull();
    expect(resp.imports[1].content_hash).toMatch(/^blake3:/);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:18080/api/bundles/imports');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-1',
    );
    vi.unstubAllGlobals();
  });

  test('listBundleImports:limit 追加查询参数', async () => {
    const fetchMock = mockFetchJson({ imports: [], count: 0 });
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.listBundleImports(50);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:18080/api/bundles/imports?limit=50');
    vi.unstubAllGlobals();
  });

  test('listBundleImports:不传 limit 时不带查询串(server 默认 100)', async () => {
    const fetchMock = mockFetchJson({ imports: [], count: 0 });
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.listBundleImports();

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:18080/api/bundles/imports');
    vi.unstubAllGlobals();
  });

  test('溯源查询失败(500)→ 如实抛 HttpBackendError(不静默返回空列表)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('溯源查询失败', { status: 500 })),
    );
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await expect(backend.listBundleImports()).rejects.toThrow('HTTP 500');
    vi.unstubAllGlobals();
  });
});

// ============================================================================
// 服务清单(⑨):能力对账端点 /api/services
// ============================================================================

describe('CloudHttpBackend 服务清单(⑨)', () => {
  const SERVICES = [
    {
      name: 'http_request',
      source: 'native',
      version: '1.0.0',
      description: 'HTTP 请求服务',
    },
    {
      name: 'payroll_svc',
      source: 'registry',
      version: '1.2.0',
      description: 'payroll service',
    },
    {
      name: 'finance_config_set',
      source: 'plugin',
      version: '0.1.0',
      description: '财务配置键写入（只创建提案不落库，需人审门确认后生效，走审计链）',
      plugin: 'finance-config',
      sensitive: true,
    },
    {
      name: 'finance_config_get',
      source: 'plugin',
      version: '0.1.0',
      description: '财务配置键读取',
      plugin: 'finance-config',
      sensitive: false,
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '配置键，例: config:limits.travel.max_amount' },
        },
        required: ['key'],
      },
    },
  ];

  test('listServices:GET /api/services + Bearer 头,返回裸数组', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SERVICES), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = new CloudHttpBackend({
      mode: 'offline',
      localBaseUrl: 'http://127.0.0.1:18080',
      authToken: 'tok-1',
    });

    const list = await backend.listServices();

    expect(list).toHaveLength(4);
    expect(list[0].source).toBe('native');
    expect(list[1].name).toBe('payroll_svc');
    expect(list[1].description).toBe('payroll service');
    // 插件归属与敏感标记透传(可选字段,server 侧经 serde skip 缺省时字段缺位)
    expect(list[0].plugin).toBeUndefined();
    expect(list[0].sensitive).toBeUndefined();
    expect(list[2].source).toBe('plugin');
    expect(list[2].plugin).toBe('finance-config');
    expect(list[2].sensitive).toBe(true);
    // 参数契约透传(外部插件包 plugin.json 声明,消费方据此生成带参工具 schema)
    expect(list[3].parameters).toEqual(SERVICES[3].parameters);
    expect(list[0].parameters).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:18080/api/services');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-1',
    );
    vi.unstubAllGlobals();
  });

  test('服务清单失败(非 2xx)→ 如实抛 HttpBackendError(调用方展示不可用态)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('未认证', { status: 401 })),
    );
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await expect(backend.listServices()).rejects.toThrow('HTTP 401');
    vi.unstubAllGlobals();
  });
});

// ============================================================================
// 插件审批代理:listExternalPlugins / listPluginProposals /
// approvePluginProposal / rejectPluginProposal — 单通道走 server 代理端点
// ============================================================================

describe('CloudHttpBackend 插件审批代理', () => {
  const HEALTH = {
    success: true,
    message: 'ok',
    plugins: {
      'finance-config': { external: true, status: 'online', last_probe: 1 },
      demo_services: { external: false },
    },
  };

  const PROPOSALS = {
    pending: [
      {
        proposal_id: 'p-1',
        key: 'config:limits.travel.max_amount',
        new_value: 8000,
        reason: '差旅上限调整',
        proposed_by: 'session:42',
        created_at: '2026-09-08T00:00:00Z',
        status: 'pending',
      },
    ],
    count: 1,
  };

  test('listExternalPlugins:GET /api/health + 过滤 external===true,透传探活状态', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(HEALTH), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = new CloudHttpBackend({
      mode: 'offline',
      localBaseUrl: 'http://127.0.0.1:18080',
      authToken: 'tok-1',
    });

    const list = await backend.listExternalPlugins();

    // 仅 external 插件(native/registry 不在审批面)
    expect(list).toEqual([{ id: 'finance-config', status: 'online' }]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:18080/api/health');
    vi.unstubAllGlobals();
  });

  test('listExternalPlugins:plugins 缺省(null)→ 空数组(不抛)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, message: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const backend = new CloudHttpBackend({ mode: 'offline' });

    expect(await backend.listExternalPlugins()).toEqual([]);
    vi.unstubAllGlobals();
  });

  test('listPluginProposals:GET 代理端点 + id 编码 + Bearer 头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(PROPOSALS), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = new CloudHttpBackend({
      mode: 'offline',
      authToken: 'tok-2',
    });

    const res = await backend.listPluginProposals('finance-config');

    expect(res.count).toBe(1);
    expect(res.pending[0].key).toBe('config:limits.travel.max_amount');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:18080/api/plugins/finance-config/admin/proposals',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
    vi.unstubAllGlobals();
  });

  test('listPluginProposals:503(token 未配置)/502(不可达)→ 如实抛错(调用方区分展示)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: '未配置 admin token' }), { status: 503 }),
      ),
    );
    const backend = new CloudHttpBackend({ mode: 'offline' });
    await expect(backend.listPluginProposals('finance-config')).rejects.toThrow('HTTP 503');
    vi.unstubAllGlobals();
  });

  test('approvePluginProposal:POST approve,body 仅 {}(approver 由 server 强制注入,前端不传)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = new CloudHttpBackend({ mode: 'offline', authToken: 'tok-3' });

    await backend.approvePluginProposal('finance-config', 'p-1');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:18080/api/plugins/finance-config/admin/proposals/p-1/approve',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-3');
    vi.unstubAllGlobals();
  });

  test('rejectPluginProposal:POST reject,body 携带 reason(操作内容保留前端值)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.rejectPluginProposal('finance-config', 'p-1', '数值超出预算');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:18080/api/plugins/finance-config/admin/proposals/p-1/reject',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: '数值超出预算' });
    vi.unstubAllGlobals();
  });

  test('提案 id 含特殊字符:URL 路径段经 encodeURIComponent 编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = new CloudHttpBackend({ mode: 'offline' });

    await backend.approvePluginProposal('finance-config', 'p/1?id=2');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      'http://localhost:18080/api/plugins/finance-config/admin/proposals/p%2F1%3Fid%3D2/approve',
    );
    vi.unstubAllGlobals();
  });
});
