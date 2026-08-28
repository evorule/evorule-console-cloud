// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// production-state 适配层单测 — mapProductionStateRecord 映射 + status 推导 + CloudHttpBackend 集成
//
// 运行: npx vitest run src/lib/stores/__tests__/production-state.test.ts
//
// 测试范围:
//   - mapProductionStateRecord:snake_case → camelCase 字段映射(对齐 server ProductionStateRecord)
//   - status 推导(current_session_id null → offline;非 null → running)
//   - updated_at 透传(RFC3339 ISO 字符串)+ 字段缺失防御性处理
//   - CloudHttpBackend.getProductionState():workspace 委托 / 错误降级 DEFAULT / 未注入 workspace
//   - refreshProductionState + productionStateStore 集成
//
// 不测:
//   - 真实 evorule-server / 内核 HttpWorkspaceBackend 交互(集成测试范畴)
//   - onSessionSwitched SSE 回调(MonitorDashboard 集成测试范畴)
//
// 注(旁路 store 收敛专项 2026-08-28):原直连 fetchProductionState 已删除,
// server 访问统一走 backend.getProductionState() → 内核 WorkspaceBackend(带 Bearer token)。

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapProductionStateRecord,
  DEFAULT_PRODUCTION_STATE,
  type ProductionState,
} from '$lib/backend/production-views';
import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
import type { ProductionStateRecord, WorkspaceBackend } from '$lib/kernel';
import {
  productionStateStore,
  refreshProductionState,
} from '../production-state';

// ============ 服务器原始响应黄金样本 ============
//
// 对齐 evorule-server core/workspace/src/models.rs::ProductionStateRecord
// snake_case 字段: id / current_session_id / ruleset_version / ruleset_hash
//                   last_operated_by / updated_at
// 注意: 服务器不返回 status 字段(cloud 版推导)

const SERVER_RUNNING: Partial<ProductionStateRecord> = {
  id: 1,
  current_session_id: 42,
  ruleset_version: 3,
  ruleset_hash: 'blake3-abc123',
  last_operated_by: 'admin',
  updated_at: '2026-08-07T12:00:00Z',
};

const SERVER_OFFLINE: Partial<ProductionStateRecord> = {
  id: 1,
  current_session_id: null,
  ruleset_version: 0,
  ruleset_hash: null,
  last_operated_by: null,
  updated_at: '2026-08-07T10:00:00Z',
};

// ============================================================================
// mapProductionStateRecord:字段映射 + status 推导
// ============================================================================

describe('mapProductionStateRecord 字段映射', () => {
  test('running 状态: current_session_id 非 null → status="running" + camelCase 映射', () => {
    const ps = mapProductionStateRecord(SERVER_RUNNING);

    expect(ps.currentSessionId).toBe(42);
    expect(ps.rulesetVersion).toBe(3);
    expect(ps.rulesetHash).toBe('blake3-abc123');
    expect(ps.status).toBe('running');
    expect(ps.updatedAt).toBe('2026-08-07T12:00:00Z');
  });

  test('offline 状态: current_session_id=null → status="offline"', () => {
    const ps = mapProductionStateRecord(SERVER_OFFLINE);

    expect(ps.currentSessionId).toBeNull();
    expect(ps.rulesetVersion).toBe(0);
    expect(ps.rulesetHash).toBeNull();
    expect(ps.status).toBe('offline');
    expect(ps.updatedAt).toBe('2026-08-07T10:00:00Z');
  });

  test('id / last_operated_by 被丢弃(不出现在 ProductionState)', () => {
    const ps = mapProductionStateRecord(SERVER_RUNNING);

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
  test('current_session_id=0 时仍视为 running(0 是合法 session_id)', () => {
    // session_id 从 0 开始,0 是有效值,不是 null
    const ps = mapProductionStateRecord({
      current_session_id: 0,
      ruleset_version: 1,
      ruleset_hash: 'hash-0',
      updated_at: '2026-08-07T00:00:00Z',
    });

    expect(ps.currentSessionId).toBe(0);
    expect(ps.status).toBe('running'); // 0 !== null
  });

  test('"switching" 不来自映射(只由 onSessionSwitched SSE 事件设置)', () => {
    const ps = mapProductionStateRecord(SERVER_RUNNING);

    // 映射只能得到 running 或 offline,绝不会是 switching
    expect(ps.status).not.toBe('switching');
  });
});

// ============================================================================
// 字段缺失防御性处理
// ============================================================================

describe('字段缺失防御性处理', () => {
  test('服务器返回空对象 {} → 全部字段降级为默认值', () => {
    const ps = mapProductionStateRecord({});

    expect(ps.currentSessionId).toBeNull();
    expect(ps.rulesetVersion).toBe(0);
    expect(ps.rulesetHash).toBeNull();
    expect(ps.status).toBe('offline'); // currentSessionId null → offline
    expect(ps.updatedAt).toBeNull();
  });

  test('current_session_id 类型错误(字符串)→ 视为 null → offline', () => {
    // 防御性用例:故意违反类型契约,模拟异常 server 响应
    const ps = mapProductionStateRecord({
      current_session_id: 'not-a-number',
      ruleset_version: 1,
    } as unknown as Partial<ProductionStateRecord>);

    expect(ps.currentSessionId).toBeNull();
    expect(ps.status).toBe('offline');
    // ruleset_version 是 number,正常映射
    expect(ps.rulesetVersion).toBe(1);
  });

  test('ruleset_version 类型错误(字符串)→ 降级为 0', () => {
    const ps = mapProductionStateRecord({
      current_session_id: 5,
      ruleset_version: 'three',
    } as unknown as Partial<ProductionStateRecord>);

    expect(ps.currentSessionId).toBe(5);
    expect(ps.status).toBe('running'); // currentSessionId 非 null
    expect(ps.rulesetVersion).toBe(0); // 类型错误降级
  });

  test('updated_at 缺失 → null', () => {
    const ps = mapProductionStateRecord({
      current_session_id: 1,
      ruleset_version: 1,
    });

    expect(ps.updatedAt).toBeNull();
  });
});

// ============================================================================
// CloudHttpBackend.getProductionState 集成(委托 workspace + 错误降级)
// ============================================================================

/** 构造仅实现 getProductionState 的最小 WorkspaceBackend mock */
function mockWorkspace(
  impl: () => Promise<unknown>,
): WorkspaceBackend {
  return {
    getProductionState: impl,
  } as unknown as WorkspaceBackend;
}

describe('CloudHttpBackend.getProductionState', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('workspace 返回 server 记录 → 映射为视图模型', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace(async () => SERVER_RUNNING),
    );

    const ps = await backend.getProductionState();

    expect(ps.currentSessionId).toBe(42);
    expect(ps.rulesetVersion).toBe(3);
    expect(ps.status).toBe('running');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('workspace 抛错(网络/401/404)→ 降级 DEFAULT_PRODUCTION_STATE + console.warn 可观测', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace(async () => {
        throw new TypeError('ECONNREFUSED');
      }),
    );

    const ps = await backend.getProductionState();

    expect(ps).toEqual(DEFAULT_PRODUCTION_STATE);
    expect(ps.status).toBe('offline');
    // 不静默:失败原因可观测(凭据问题可据此定位)
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('未注入 workspace(null)→ 返回 DEFAULT_PRODUCTION_STATE(离线演示兜底)', async () => {
    const backend = new CloudHttpBackend({ mode: 'offline' }, null);

    const ps = await backend.getProductionState();

    expect(ps).toEqual(DEFAULT_PRODUCTION_STATE);
  });

  test('降级返回的是副本(修改不影响 DEFAULT_PRODUCTION_STATE 常量)', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace(async () => {
        throw new Error('network');
      }),
    );

    const ps = await backend.getProductionState();
    ps.status = 'running';
    ps.rulesetVersion = 999;

    // 原始常量不受影响
    expect(DEFAULT_PRODUCTION_STATE.status).toBe('offline');
    expect(DEFAULT_PRODUCTION_STATE.rulesetVersion).toBe(0);
  });
});

// ============================================================================
// refreshProductionState + productionStateStore 集成
// ============================================================================

describe('refreshProductionState + store 集成', () => {
  test('backend.getProductionState 作为 fetcher 传入 refreshProductionState 更新 store', async () => {
    const backend = new CloudHttpBackend(
      { mode: 'offline' },
      mockWorkspace(async () => SERVER_RUNNING),
    );

    await refreshProductionState(() => backend.getProductionState());

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
