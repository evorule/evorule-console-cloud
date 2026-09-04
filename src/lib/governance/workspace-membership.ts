// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// UV-073: 平台用户与 workspace 成员体系打通(①连接时自动 ensure + ②403 一键引导,用户 2026-09-04 裁定组合)
//
// 背景:执行域(18080)沙盒族端点要求 requester 是 workspace 成员(validate_member,
// sandbox_service.rs L143-150),但成员名单独立于平台用户池(bootstrap 仅 owner
// "console")→ 平台用户首次使用测试工作台即 403。server 侧 members add 本就无
// 权限校验(loopback 信任模型),403 是配置性摩擦而非安全信号。
//
// 组合方案语义:
//   ① 治理页连接成功后自动 ensure 当前平台用户(幂等;失败诚实降级不阻塞治理连接)
//   ② 沙盒操作 403 not-a-member 时 UI 引导「加入默认工作空间并重试」(显式动作,审计留痕)
//
// 本模块为纯逻辑(不含 UI/降级策略),降级与引导由治理页决定。

import type {
  PublishRole,
  WorkspaceBackend,
  WorkspaceMemberRecord
} from '$lib/kernel/backend/workspace-types';

/** workspace 成员角色(server workspace_members.role 枚举:owner/admin/editor/viewer,db.rs L172) */
export type WorkspaceMemberRole = 'admin' | 'editor' | 'viewer';

/**
 * 平台发布角色 → workspace 成员角色映射。
 * 原则:不放大权限 —— doctor(普通用户/审计员)落 viewer,仅 it/exec(admin)落 admin。
 * 沙盒族端点只校验「是成员」(validate_member 不查角色),viewer 不影响沙盒操作。
 */
export function mapRoleToWorkspaceRole(
  publishRole: PublishRole | null | undefined
): WorkspaceMemberRole {
  switch (publishRole) {
    case 'admin':
      return 'admin';
    case 'department_head':
      return 'editor';
    case 'doctor':
    default:
      return 'viewer';
  }
}

export interface MembershipResult {
  /** 名单最终包含该用户(ensure 成功) */
  ensured: boolean;
  /** 本次调用实际执行了添加(false = 已在名单/竞态幂等收敛) */
  joined: boolean;
  /** ensure 时使用的成员角色 */
  role: WorkspaceMemberRole;
}

/**
 * 幂等 ensure:目标用户在 workspace 成员名单中,不在则加入。
 * - 先查名单(避免撞 server 的 UNIQUE 约束);
 * - 并发竞态(查询后他人已加)时复查名单收敛为 already,不依赖 server 错误文本;
 * - 真失败原样抛出原始错误(不吞错、不伪造成功)。
 */
export async function ensureWorkspaceMembership(
  wb: WorkspaceBackend,
  workspaceId: string,
  actor: { name: string; role: PublishRole | null | undefined }
): Promise<MembershipResult> {
  const role = mapRoleToWorkspaceRole(actor.role);
  const inList = (members: WorkspaceMemberRecord[]): boolean =>
    members.some((m) => m.user_id === actor.name);

  const before = await wb.listMembers(workspaceId);
  if (inList(before)) {
    return { ensured: true, joined: false, role };
  }

  try {
    await wb.addMember(workspaceId, { user_id: actor.name, role });
    return { ensured: true, joined: true, role };
  } catch (e) {
    // 竞态复查:他人(或并行路径)刚加过 → 幂等收敛;复查自身失败或确实不在名单 → 抛原始错误
    try {
      const after = await wb.listMembers(workspaceId);
      if (inList(after)) {
        return { ensured: true, joined: false, role };
      }
    } catch {
      // 复查失败:落入下方抛原始错误(保留首次失败的现场)
    }
    throw e;
  }
}
