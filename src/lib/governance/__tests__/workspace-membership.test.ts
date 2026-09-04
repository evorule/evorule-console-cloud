// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// workspace-membership 单元测试(UV-073 ①+② 组合方案的纯逻辑层)
//
// 覆盖:角色映射不放大权限 / ensure 幂等(已在名单/新加入/竞态收敛/真失败不吞错)

import { describe, expect, test, vi } from 'vitest';
import {
  ensureWorkspaceMembership,
  mapRoleToWorkspaceRole
} from '$lib/governance/workspace-membership';
import type { WorkspaceBackend, WorkspaceMemberRecord } from '$lib/kernel/backend/workspace-types';

function member(user_id: string, role = 'viewer'): WorkspaceMemberRecord {
  return { workspace_id: 'ws-1', user_id, role, joined_at: '2026-09-04T00:00:00Z' };
}

/** 构造 mock WorkspaceBackend(仅用到 listMembers/addMember) */
function mockWb(members: WorkspaceMemberRecord[], addImpl?: (user_id: string) => Promise<void>) {
  return {
    listMembers: vi.fn(async () => [...members]),
    addMember: vi.fn(async (_ws: string, req: { user_id: string }) => {
      if (addImpl) await addImpl(req.user_id);
      members.push(member(req.user_id));
    })
  } as unknown as WorkspaceBackend;
}

describe('mapRoleToWorkspaceRole(UV-073:不放大权限)', () => {
  test('admin(it/exec) → admin', () => {
    expect(mapRoleToWorkspaceRole('admin')).toBe('admin');
  });

  test('department_head(lead) → editor', () => {
    expect(mapRoleToWorkspaceRole('department_head')).toBe('editor');
  });

  test('doctor(普通用户/审计员)与 null/undefined → viewer', () => {
    expect(mapRoleToWorkspaceRole('doctor')).toBe('viewer');
    expect(mapRoleToWorkspaceRole(null)).toBe('viewer');
    expect(mapRoleToWorkspaceRole(undefined)).toBe('viewer');
  });
});

describe('ensureWorkspaceMembership(UV-073:幂等 ensure)', () => {
  const actor = { name: 'u-admin', role: 'admin' as const };

  test('已在名单 → 不调用 addMember,joined=false', async () => {
    const wb = mockWb([member('console', 'owner'), member('u-admin', 'admin')]);
    const r = await ensureWorkspaceMembership(wb, 'ws-1', actor);
    expect(r).toEqual({ ensured: true, joined: false, role: 'admin' });
    expect((wb as unknown as { addMember: { mock: { calls: unknown[][] } } }).addMember.mock.calls).toHaveLength(0);
  });

  test('不在名单 → addMember 以映射角色加入,joined=true', async () => {
    const wb = mockWb([member('console', 'owner')]);
    const r = await ensureWorkspaceMembership(wb, 'ws-1', actor);
    expect(r).toEqual({ ensured: true, joined: true, role: 'admin' });
    expect((wb as unknown as { addMember: { mock: { calls: unknown[][] } } }).addMember.mock.calls[0][1]).toEqual({
      user_id: 'u-admin',
      role: 'admin'
    });
  });

  test('竞态:addMember 失败但复查名单已在(他人刚加) → 幂等收敛为 already', async () => {
    // 首查不在 → add 抛错(竞态) → 复查时名单已含该用户
    let raced = false;
    const members = [member('console', 'owner')];
    const wb = {
      listMembers: vi.fn(async () => (raced ? [...members, member('u-admin')] : [...members])),
      addMember: vi.fn(async () => {
        raced = true;
        throw new Error('duplicate key value violates unique constraint');
      })
    } as unknown as WorkspaceBackend;
    const r = await ensureWorkspaceMembership(wb, 'ws-1', actor);
    expect(r).toEqual({ ensured: true, joined: false, role: 'admin' });
  });

  test('真失败:addMember 失败且复查仍不在 → 抛原始错误(不吞错不伪造成功)', async () => {
    const wb = {
      listMembers: vi.fn(async () => [member('console', 'owner')]),
      addMember: vi.fn(async () => {
        throw new Error('HTTP 500: boom');
      })
    } as unknown as WorkspaceBackend;
    await expect(ensureWorkspaceMembership(wb, 'ws-1', actor)).rejects.toThrow('HTTP 500: boom');
  });

  test('复查自身失败 → 抛 addMember 的原始错误(保留首次失败现场)', async () => {
    // 首查(不在名单) → add 失败 → 竞态复查也失败 → 应抛 add 的原始错误
    const listMembers = vi
      .fn<() => Promise<WorkspaceMemberRecord[]>>()
      .mockImplementationOnce(async () => [member('console', 'owner')])
      .mockImplementationOnce(async () => {
        throw new Error('HTTP 503: list failed');
      });
    const wb = {
      listMembers,
      addMember: vi.fn(async () => {
        throw new Error('HTTP 503: server unavailable');
      })
    } as unknown as WorkspaceBackend;
    await expect(ensureWorkspaceMembership(wb, 'ws-1', actor)).rejects.toThrow('HTTP 503: server unavailable');
  });
});
