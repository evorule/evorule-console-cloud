// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// production-views 单测 — 纯映射函数(角色映射 / 队列项映射 / 版本历史映射与过滤)
//
// 运行: npx vitest run src/lib/backend/__tests__/production-views.test.ts
//
// 对齐 evorule-server:
//   - models.rs::PublishQueueItem(snake_case 记录,经内核 WorkspaceBackend 类型化)
//   - models.rs::ProductionAuditRecord(4 类事件)
//
// 注(旁路 store 收敛专项 2026-08-28):
//   本文件承接原 stores/__tests__/publish-queue-api.test.ts 与
//   production-audit-api.test.ts 中仍有效的纯映射用例;
//   原「未知 status 归一为 pending」防御用例随内核 PublishStatus 类型化收敛而移除
//   (类型层已保证合法值);fetch 层用例随旁路 fetch 删除而废弃,由
//   cloud-http-backend.test.ts 的委托/凭据用例承接。

import { describe, test, expect } from 'vitest';
import {
  roleToBackend,
  mapPublishQueueItem,
  mapProductionAuditRecords,
  type ProductionState,
} from '../production-views';
import { mapProductionStateRecord } from '../production-views';
import type { PublishQueueItem, ProductionAuditRecord } from '$lib/kernel';

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
// mapPublishQueueItem:内核 snake_case 记录 → camelCase 视图
// ============================================================================

const SERVER_ITEM: PublishQueueItem = {
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

describe('mapPublishQueueItem 字段映射', () => {
  test('published 项:数字 id → 字符串,status 透传,published_version → rulesetVersion', () => {
    const v = mapPublishQueueItem(SERVER_ITEM);
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
    const v = mapPublishQueueItem({
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
});

// ============================================================================
// mapProductionAuditRecords:事件过滤 + 版本历史映射
// ============================================================================

// 黄金样本:对齐 server production_audit 表(4 类事件各一)
const AUDIT_RECORDS: ProductionAuditRecord[] = [
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

describe('mapProductionAuditRecords', () => {
  test('过滤生命周期事件:仅保留 ruleset_published / ruleset_rollback', () => {
    const history = mapProductionAuditRecords(AUDIT_RECORDS);
    // 4 条原始记录 → 只留 2 条版本事件
    expect(history).toHaveLength(2);
  });

  test('字段映射:version/rulesetHash/publishedAt/publishedBy/rollbackOf/notes', () => {
    const history = mapProductionAuditRecords(AUDIT_RECORDS);
    const v1 = history.find((h) => h.version === 1);
    const v2 = history.find((h) => h.version === 2);
    expect(v1).toBeDefined();
    expect(v1!.rulesetHash).toBe('h1');
    expect(v1!.publishedAt).toBe('2026-08-24T00:02:00Z');
    expect(v1!.publishedBy).toBe('admin-1');
    // published 事件的 previous_version 是前序版本,不是回滚来源 → rollbackOf 不设
    expect(v1!.rollbackOf).toBeUndefined();
    expect(v1!.notes).toBe('');
    expect(v2).toBeDefined();
    // 仅回滚事件标注 rollbackOf
    expect(v2!.rollbackOf).toBe(1);
    expect(v2!.notes).toBe('误触发回滚');
  });
});

// ============================================================================
// mapProductionStateRecord(此处仅冒烟,详测见 stores/__tests__/production-state.test.ts)
// ============================================================================

describe('mapProductionStateRecord 冒烟', () => {
  test('类型与映射可从 production-views 统一导入(re-export 兼容)', () => {
    const ps: ProductionState = mapProductionStateRecord({
      current_session_id: 42,
      ruleset_version: 3,
    });
    expect(ps.status).toBe('running');
  });
});
