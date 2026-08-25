// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// production-audit 适配层单测 — fetchProductionAudit(版本历史映射 + 事件过滤)
//
// 运行: npx vitest run src/lib/stores/__tests__/production-audit-api.test.ts
//
// 对齐 evorule-server:
//   - models.rs::ProductionAuditRecord(snake_case 响应)
//   - api.rs:GET /api/production/audit
//
// 关键行为:仅保留产生新版本的事件(ruleset_published / ruleset_rollback),
// 生命周期事件(publish_submitted / publish_reviewed)不改变版本号,须过滤。

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProductionAudit } from '../production-audit';

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

function httpError(status: number): Response {
  return {
    ok: false,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({}),
    text: async () => '',
  } as unknown as Response;
}

// 黄金样本:对齐 server production_audit 表(4 类事件各一)
const AUDIT_RECORDS: unknown[] = [
  {
    id: 1,
    event_type: 'publish_submitted',
    ruleset_version: 0,
    previous_version: null,
    ruleset_hash: 'h0',
    tcb_session_id: 0,
    source_workspace_ids: '["ws-1"]',
    operated_by: 'head-1',
    operated_at: '2026-08-24T00:00:00Z',
    reason: null,
    test_report_paths: null,
    ruleset_snapshot: null,
  },
  {
    id: 2,
    event_type: 'publish_reviewed',
    ruleset_version: 0,
    previous_version: null,
    ruleset_hash: 'h0',
    tcb_session_id: 0,
    source_workspace_ids: '["ws-1"]',
    operated_by: 'admin-1',
    operated_at: '2026-08-24T00:01:00Z',
    reason: 'decision=approved, comment=通过',
    test_report_paths: null,
    ruleset_snapshot: null,
  },
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
    ruleset_snapshot: '[{"transform":[{"type":"noop"}]}]',
  },
  {
    id: 6,
    event_type: 'ruleset_rollback',
    ruleset_version: 2,
    previous_version: 1,
    ruleset_hash: 'h1',
    tcb_session_id: 3,
    source_workspace_ids: '["rollback"]',
    operated_by: 'admin-1',
    operated_at: '2026-08-24T00:03:00Z',
    reason: '误触发回滚',
    test_report_paths: null,
    ruleset_snapshot: '[{"transform":[{"type":"noop"}]}]',
  },
];

describe('fetchProductionAudit', () => {
  test('过滤生命周期事件:仅保留 ruleset_published / ruleset_rollback', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(AUDIT_RECORDS));
    const history = await fetchProductionAudit('http://localhost:18080');
    // 4 条原始记录 → 只留 2 条版本事件
    expect(history).toHaveLength(2);
  });

  test('字段映射:version/rulesetHash/publishedAt/publishedBy/rollbackOf/notes', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(AUDIT_RECORDS));
    const history = await fetchProductionAudit('http://localhost:18080');
    const v1 = history.find((h) => h.version === 1);
    const v2 = history.find((h) => h.version === 2);
    expect(v1).toBeDefined();
    expect(v1!.rulesetHash).toBe('h1');
    expect(v1!.publishedAt).toBe('2026-08-24T00:02:00Z');
    expect(v1!.publishedBy).toBe('admin-1');
    expect(v1!.rollbackOf).toBeUndefined();
    expect(v1!.notes).toBe('');
    expect(v2).toBeDefined();
    expect(v2!.rollbackOf).toBe(1);
    expect(v2!.notes).toBe('误触发回滚');
  });

  test('URL 带 limit 参数 + 去掉末尾斜杠', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk([]));
    await fetchProductionAudit('http://localhost:18080/');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:18080/api/production/audit?limit=50',
    );
  });

  test('非 2xx → 抛错(不再静默返回空数组,避免掩盖后端故障)', async () => {
    mockFetch.mockResolvedValueOnce(httpError(500));
    await expect(fetchProductionAudit('http://localhost:18080')).rejects.toThrow(
      '获取版本历史失败(500)',
    );
  });

  test('网络错误 → 抛错(不再静默返回空数组)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchProductionAudit('http://localhost:18080')).rejects.toThrow(
      'Failed to fetch',
    );
  });

  test('响应非数组 → 抛错(防御)', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 1 }));
    await expect(fetchProductionAudit('http://localhost:18080')).rejects.toThrow(
      '版本历史响应格式异常(期望数组)',
    );
  });
});
