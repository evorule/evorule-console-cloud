// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// evorule-server 发布队列 API 适配层(F3 生产状态 API 落地)。
//
// 对齐 evorule-server:
//   - core/workspace/src/models.rs::PublishQueueItem(响应结构)
//   - core/workspace/src/api.rs §6 发布队列路由
//
// 路由:
//   GET  /api/publish/queue                     — 列表
//   POST /api/publish/queue/{queue_id}/review   — 审批(decision=approved/rejected)
//   POST /api/publish/rollback                  — 紧急回滚(target_version)
//
// 设计(与 production-state.ts 适配层一致):
//   - snake_case → camelCase 字段映射
//   - 读取失败抛 Error(网络错误 / 非 2xx / 响应非数组),
//     由调用方 catch 后展示错误状态 —— 避免静默掩盖后端不可达
//   - 写入失败返回 { ok:false, error },由调用方 toast 提示

/** evorule-server PublishQueueItem 原始响应(snake_case)。 */
export interface PublishQueueItemServer {
  id: number;
  workspace_id: string;
  /** 待发布的规则集(JSON 数组字符串) */
  final_candidate_rules: string;
  /** 规则集 BLAKE3 哈希 */
  ruleset_hash: string;
  test_report_sandbox_id: number | null;
  submitted_by: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  published_version: number | null;
  published_at: string | null;
  /** pending / approved / published / rejected / cancelled */
  status: string;
  description: string | null;
}

/** 后端发布队列状态(与前端 mock 状态对齐映射后使用)。 */
export type BackendPublishStatus =
  | 'pending'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'cancelled';

/** 适配后的发布队列项(UI 消费,camelCase)。 */
export interface PublishQueueItemView {
  /** 队列项 ID(后端数字转字符串,便于与 mock 的字符串 ID 统一) */
  id: string;
  /** 展示用版本号(published 后为实际发布版本,pending 为 0) */
  rulesetVersion: number;
  submittedBy: string;
  submittedAt: string;
  status: BackendPublishStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  publishedAt?: string;
  description?: string;
}

/** 写入操作结果(approve/reject/rollback 共用)。 */
export interface PublishWriteResult {
  ok: boolean;
  error?: string;
}

/**
 * 前端角色 → 后端 PublishRole 映射(P0 后端从请求体读 role)。
 *
 * evorule-server PublishRole:doctor / department_head / admin。
 * 前端 5 角色:
 *   - user(医生)      → doctor(不可提交/审批)
 *   - lead(科室主任)   → department_head(可提交)
 *   - it(信息科)       → admin(可审批+回滚)
 *   - exec(院领导)     → admin(可审批+回滚)
 *   - auditor(审计)    → doctor(只读)
 */
export function roleToBackend(role: string): string {
  switch (role) {
    case 'it':
    case 'exec':
      return 'admin';
    case 'lead':
      return 'department_head';
    case 'user':
    case 'auditor':
    default:
      return 'doctor';
  }
}

/** 后端队列项 → UI 视图(字段映射 + 类型归一)。 */
export function mapServerQueueToView(item: PublishQueueItemServer): PublishQueueItemView {
  return {
    id: String(item.id),
    rulesetVersion: item.published_version ?? 0,
    submittedBy: item.submitted_by,
    submittedAt: item.submitted_at,
    status: (item.status === 'pending' ||
      item.status === 'approved' ||
      item.status === 'published' ||
      item.status === 'rejected' ||
      item.status === 'cancelled'
      ? item.status
      : 'pending') as BackendPublishStatus,
    reviewedBy: item.reviewed_by ?? undefined,
    reviewedAt: item.reviewed_at ?? undefined,
    reviewComment: item.review_comment ?? undefined,
    publishedAt: item.published_at ?? undefined,
    description: item.description ?? undefined,
  };
}

/**
 * 拉取发布队列(GET /api/publish/queue)。
 *
 * 语义:
 *   - 成功 → 返回队列项数组(空数组 = 队列确实为空)
 *   - 失败(网络错误 / 非 2xx / 响应非数组)→ 抛 Error,由调用方展示错误状态
 *
 * 为什么抛错而非返回空数组:
 *   返回空数组无法区分"队列为空"与"后端不可达",会掩盖后端故障
 *   (见 F3 偏差修正)。调用方 catch 后展示明确错误,不静默降级。
 */
export async function fetchPublishQueue(baseUrl: string): Promise<PublishQueueItemView[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/publish/queue`;
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`获取发布队列失败(${r.status})`);
  }
  const raw = (await r.json()) as PublishQueueItemServer[];
  if (!Array.isArray(raw)) {
    throw new Error('发布队列响应格式异常(期望数组)');
  }
  return raw.map(mapServerQueueToView);
}

/**
 * 审批发布(POST /api/publish/queue/{queue_id}/review)。
 *
 * @param decision 'approved' | 'rejected'
 * @returns ok=false 时 error 含可展示信息
 */
export async function reviewPublishRequest(
  baseUrl: string,
  queueId: number,
  decision: 'approved' | 'rejected',
  comment: string,
  reviewedBy: string,
  role: string,
): Promise<PublishWriteResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/publish/queue/${queueId}/review`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        comment,
        reviewed_by: reviewedBy,
        role,
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: `审批失败(${r.status}): ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: '审批失败:网络错误' };
  }
}

/**
 * 紧急回滚(POST /api/publish/rollback)。
 * 版本号单调递增:回滚到 target_version 的规则集,新版本号 = 当前 + 1。
 */
export async function emergencyRollbackRequest(
  baseUrl: string,
  targetVersion: number,
  reason: string,
  operatedBy: string,
  role: string,
): Promise<PublishWriteResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/publish/rollback`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_version: targetVersion,
        reason,
        operated_by: operatedBy,
        role,
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { ok: false, error: `回滚失败(${r.status}): ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: '回滚失败:网络错误' };
  }
}
