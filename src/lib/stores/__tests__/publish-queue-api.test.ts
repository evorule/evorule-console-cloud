// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// publish-queue-api 适配层单测 — F3 发布队列(角色映射 / 字段映射 / 读写容错)
//
// 运行: npx vitest run src/lib/stores/__tests__/publish-queue-api.test.ts
//
// 对齐 evorule-server:
//   - models.rs::PublishQueueItem(snake_case 响应)
//   - api.rs:GET /api/publish/queue,POST /{queue_id}/review,POST /api/publish/rollback
//
// 不测:
//   - 真实 evorule-server 交互(集成测试范畴)
//   - publishQueueStore 本身(mock store 已有独立测试)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  roleToBackend,
  mapServerQueueToView,
  fetchPublishQueue,
  reviewPublishRequest,
  emergencyRollbackRequest,
  type PublishQueueItemServer,
} from '../publish-queue-api';

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

// ============================================================================
// roleToBackend:前端 5 角色 → 后端 PublishRole
// ============================================================================

describe('roleToBackend 角色映射', () => {
  test('it/exec → admin(可审批+回滚)', () => {
    expect(roleToBackend('it')).toBe('admin');
    expect(roleToBackend('exec')).toBe('admin');
  });
  test('lead → department_head(可提交)', () => {
    expect(roleToBackend('lead')).toBe('department_head');
  });
  test('user/auditor/未知 → doctor(只读)', () => {
    expect(roleToBackend('user')).toBe('doctor');
    expect(roleToBackend('auditor')).toBe('doctor');
    expect(roleToBackend('unknown')).toBe('doctor');
  });
});

// ============================================================================
// mapServerQueueToView:snake_case → camelCase
// ============================================================================

const SERVER_ITEM: PublishQueueItemServer = {
  id: 7,
  workspace_id: 'ws-1',
  final_candidate_rules: '[{"transform":[{"type":"noop"}]}]',
  ruleset_hash: 'abc123',
  test_report_sandbox_id: null,
  submitted_by: 'head-1',
  submitted_at: '2026-08-24T00:00:00Z',
  reviewed_by: 'admin-1',
  reviewed_at: '2026-08-24T01:00:00Z',
  review_comment: '通过',
  published_version: 3,
  published_at: '2026-08-24T01:00:00Z',
  status: 'published',
  description: '内科规则发布',
};

describe('mapServerQueueToView 字段映射', () => {
  test('published 项:数字 id → 字符串,status 透传,published_version → rulesetVersion', () => {
    const v = mapServerQueueToView(SERVER_ITEM);
    expect(v.id).toBe('7');
    expect(v.rulesetVersion).toBe(3);
    expect(v.submittedBy).toBe('head-1');
    expect(v.status).toBe('published');
    expect(v.reviewedBy).toBe('admin-1');
    expect(v.reviewComment).toBe('通过');
    expect(v.publishedAt).toBe('2026-08-24T01:00:00Z');
    expect(v.description).toBe('内科规则发布');
  });

  test('pending 项:无 published_version → rulesetVersion=0,reviewedBy 为 undefined', () => {
    const v = mapServerQueueToView({
      ...SERVER_ITEM,
      status: 'pending',
      published_version: null,
      published_at: null,
      reviewed_by: null,
      reviewed_at: null,
      review_comment: null,
    });
    expect(v.rulesetVersion).toBe(0);
    expect(v.reviewedBy).toBeUndefined();
    expect(v.reviewComment).toBeUndefined();
    expect(v.publishedAt).toBeUndefined();
  });

  test('未知 status 归一为 pending(防御)', () => {
    const v = mapServerQueueToView({ ...SERVER_ITEM, status: 'weird' });
    expect(v.status).toBe('pending');
  });
});

// ============================================================================
// fetchPublishQueue:GET /api/publish/queue
// ============================================================================

describe('fetchPublishQueue', () => {
  test('成功:映射全部项', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk([SERVER_ITEM]));
    const list = await fetchPublishQueue('http://localhost:18080');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('7');
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:18080/api/publish/queue');
  });

  test('非 2xx → 抛错(不再静默返回空数组,避免掩盖后端故障)', async () => {
    mockFetch.mockResolvedValueOnce(httpError(500));
    await expect(fetchPublishQueue('http://localhost:18080')).rejects.toThrow(
      '获取发布队列失败(500)',
    );
  });

  test('网络错误 → 抛错(不再静默返回空数组)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchPublishQueue('http://localhost:18080')).rejects.toThrow(
      'Failed to fetch',
    );
  });

  test('响应非数组 → 抛错(防御)', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({ id: 1 }));
    await expect(fetchPublishQueue('http://localhost:18080')).rejects.toThrow(
      '发布队列响应格式异常(期望数组)',
    );
  });
});

// ============================================================================
// reviewPublishRequest:POST /api/publish/queue/{queue_id}/review
// ============================================================================

describe('reviewPublishRequest', () => {
  test('成功:发送正确请求体 + 返回 ok', async () => {
    mockFetch.mockResolvedValueOnce(jsonOk({}));
    const res = await reviewPublishRequest(
      'http://localhost:18080/',
      7,
      'approved',
      '通过',
      'admin-1',
      'admin',
    );
    expect(res.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:18080/api/publish/queue/7/review');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      decision: 'approved',
      comment: '通过',
      reviewed_by: 'admin-1',
      role: 'admin',
    });
  });

  test('非 2xx → ok=false + 含错误信息', async () => {
    mockFetch.mockResolvedValueOnce(httpError(400, { error: 'bad request' }));
    const res = await reviewPublishRequest(
      'http://localhost:18080',
      7,
      'rejected',
      '驳回',
      'admin-1',
      'admin',
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('400');
  });
});

// ============================================================================
// emergencyRollbackRequest:POST /api/publish/rollback
// ============================================================================

describe('emergencyRollbackRequest', () => {
  test('成功:发送 target_version 请求体', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonOk({ new_ruleset_version: 4, rolled_back_to: 3 }),
    );
    const res = await emergencyRollbackRequest(
      'http://localhost:18080',
      3,
      '误发布回滚',
      'admin-1',
      'admin',
    );
    expect(res.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:18080/api/publish/rollback');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      target_version: 3,
      reason: '误发布回滚',
      operated_by: 'admin-1',
      role: 'admin',
    });
  });

  test('网络错误 → ok=false', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const res = await emergencyRollbackRequest(
      'http://localhost:18080',
      3,
      'x',
      'admin-1',
      'admin',
    );
    expect(res.ok).toBe(false);
  });
});
