// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 生产运行状态 store(L1 监控大屏的数据源)。
// 设计:
//   - 跟踪当前 production session_id(滚动 session 切换时原子更新)
//   - 跟踪 ruleset_version / ruleset_hash / status
//   - U7:SSE session_switched 事件触发 currentSessionId 切换 + 通知监听者
//
// 数据来源:evorule-server 应用层 production_state 表(单行)
//   GET /api/production/state → ProductionState
//   SSE /api/sessions/{id}/events → session_switched 事件触发切换
//
// 持久化:不持久化(每次启动从 server 拉取最新状态)

import { writable } from "svelte/store";

export interface ProductionState {
  /** 当前生产 session 的 tcb session_id(SessionManager 返回) */
  currentSessionId: number | null;
  /** 当前规则集版本号(单调递增,0 = 未发布) */
  rulesetVersion: number;
  /** 当前规则集 BLAKE3 哈希 */
  rulesetHash: string | null;
  /** 运行状态:running(正常)/ switching(滚动 session 切换中)/ offline */
  status: "running" | "switching" | "offline";
  /** 最后更新时间(ISO 字符串) */
  updatedAt: string | null;
}

export const DEFAULT_PRODUCTION_STATE: ProductionState = {
  currentSessionId: null,
  rulesetVersion: 0,
  rulesetHash: null,
  status: "offline",
  updatedAt: null,
};

export const productionStateStore = writable<ProductionState>(
  DEFAULT_PRODUCTION_STATE,
);

// === SSE 切换通知回调链(U7) ===
// MonitorDashboard 订阅 SSE,收到 session_switched 时调用 onSessionSwitched
type SwitchHandler = (newSessionId: number, newVersion: number) => void;
let switchHandler: SwitchHandler | null = null;

export function setSessionSwitchHandler(handler: SwitchHandler): void {
  switchHandler = handler;
}

/**
 * U7:服务端推送切换通知处理。
 * 由 MonitorDashboard 的 SSE 监听器在收到 session_switched 事件时调用。
 *
 * 流程:
 *   1. 标记 status='switching'(大屏显示"切换中")
 *   2. 更新 currentSessionId + rulesetVersion(原子)
 *   3. 调用 switchHandler(由 MonitorDashboard 关闭旧 SSE → 开新 SSE)
 *   4. 标记 status='running'
 */
export function onSessionSwitched(
  newSessionId: number,
  newVersion: number,
): void {
  productionStateStore.update((s) => ({
    ...s,
    status: "switching",
  }));

  // 通知 MonitorDashboard 切换 SSE 订阅
  switchHandler?.(newSessionId, newVersion);

  productionStateStore.update((s) => ({
    ...s,
    currentSessionId: newSessionId,
    rulesetVersion: newVersion,
    status: "running",
    updatedAt: new Date().toISOString(),
  }));
}

// === 便捷函数 ===

export function setProductionState(ps: ProductionState): void {
  productionStateStore.set(ps);
}

/** 拉取最新 production 状态(应用启动 / 发布后调用) */
export async function refreshProductionState(
  fetcher: () => Promise<ProductionState>,
): Promise<void> {
  const ps = await fetcher();
  productionStateStore.set(ps);
}

// ============================================================================
// 服务器响应适配层
// ============================================================================

/**
 * evorule-server `GET /api/production/state` 原始响应(snake_case)。
 *
 * 对齐 evorule-server core/workspace/src/models.rs::ProductionStateRecord。
 * 此类型仅用于 [`fetchProductionState`] 内部映射,不对外暴露。
 *
 * 注意:服务器此结构**不含** status 字段 —— status 由 cloud 版推导
 * (见 [`fetchProductionState`] 的 status 推导逻辑)。
 */
interface ProductionStateServerRecord {
  /** 固定 ID = 1(单行表),cloud 版不消费,丢弃 */
  id: number;
  /** 当前活跃的 production session_id(null = 未发布或已关闭) */
  current_session_id: number | null;
  /** 当前规则集版本号(单调递增,初始 0) */
  ruleset_version: number;
  /** 当前规则集 BLAKE3 哈希 */
  ruleset_hash: string | null;
  /** 最后操作者(cloud 版 ProductionState 暂不消费,丢弃) */
  last_operated_by: string | null;
  /** 最后更新时间(RFC3339 ISO 字符串,如 "2026-08-07T12:00:00Z") */
  updated_at: string | null;
}

/**
 * 从 evorule-server 拉取生产状态并适配为 cloud 版 [`ProductionState`]。
 *
 * 这是 [`refreshProductionState`] 的默认 fetcher 实现,也是 cloud 版消费
 * evorule-server 第四梯队新增端点 `/api/production/state` 的唯一适配入口。
 *
 * # 适配内容
 * 1. **字段命名** snake_case → camelCase
 *    (服务器 Rust serde 默认输出 snake_case,cloud 版 TS 惯例 camelCase)
 * 2. **status 推导**(服务器 `ProductionStateRecord` 不含 status 字段):
 *    - `current_session_id == null` → `"offline"`(未发布或 session 已关闭)
 *    - `current_session_id != null` → `"running"`(有活跃生产 session)
 *    - `"switching"` 是瞬态,仅由 [`onSessionSwitched`] 在 SSE
 *      `session_switched` 事件时临时设置,**不来自轮询**
 * 3. **updated_at 透传**(RFC3339 ISO 字符串,直接赋给 `updatedAt`)
 * 4. **id / last_operated_by 丢弃**(cloud 版 ProductionState 不消费)
 *
 * # 错误容错(与内核 HttpBackend.health() 哲学一致)
 * 监控大屏不应因一次拉取失败而崩,故:
 * - 网络错误(fetch 抛 TypeError)→ 返回 [`DEFAULT_PRODUCTION_STATE`](status="offline")
 * - 非 2xx 响应(404 未初始化 / 500 服务器错误)→ 返回默认值
 * - JSON 解析失败 / 字段缺失 → 返回默认值
 * - **不抛错**,调用方无需 try/catch
 *
 * # 设计依据
 * - PUBLISH_QUEUE_DESIGN.md §6 (`GET /api/production/state` 端点定义)
 * - P0_implementation_plan.md T1 (`production-state.ts` store 骨架)
 * - P0_implementation_plan.md T3/P05 (L1 监控大屏消费此数据)
 *
 * @param baseUrl evorule-server 基地址(如 `http://localhost:18080`)
 * @returns 适配后的 ProductionState;失败时返回 status="offline" 的默认值
 *
 * @example
 * ```ts
 * // 直接调用(纯函数,需自行提供 baseUrl)
 * const ps = await fetchProductionState('http://localhost:18080');
 * if (ps.status === 'running') { console.log(ps.rulesetVersion); }
 *
 * // 通过 CloudHttpBackend 调用(复用已解析的 baseUrl,随 mode 切换)
 * const backend = useBackend();
 * if (backend instanceof CloudHttpBackend) {
 *   const ps = await backend.getProductionState();
 *   refreshProductionState(async () => ps);
 * }
 * ```
 */
export async function fetchProductionState(baseUrl: string): Promise<ProductionState> {
  // 去掉末尾斜杠,避免 path 拼接出现 //(与 HttpBackend 构造行为一致)
  const url = `${baseUrl.replace(/\/+$/, '')}/api/production/state`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      // 404(未初始化) / 500(服务器错误)等 → 静默降级为 offline
      return { ...DEFAULT_PRODUCTION_STATE };
    }
    const raw = (await r.json()) as Partial<ProductionStateServerRecord>;

    // 防御性提取:服务器字段可能缺失或类型不符(如旧版服务器无此端点返回其他 JSON)
    const currentSessionId =
      typeof raw.current_session_id === 'number' ? raw.current_session_id : null;

    return {
      currentSessionId,
      rulesetVersion: typeof raw.ruleset_version === 'number' ? raw.ruleset_version : 0,
      rulesetHash: typeof raw.ruleset_hash === 'string' ? raw.ruleset_hash : null,
      // status 推导:有活跃 session → running;否则 offline
      status: currentSessionId === null ? 'offline' : 'running',
      updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : null,
    };
  } catch {
    // fetch 抛 TypeError(网络问题)或 r.json() 抛 SyntaxError(JSON 解析失败)
    return { ...DEFAULT_PRODUCTION_STATE };
  }
}
