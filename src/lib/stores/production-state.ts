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
//   server 访问统一走内核 WorkspaceBackend.getProductionState()(带 Bearer token),
//   由 backend 层适配后经 setProductionState/refreshProductionState 写入本 store。
//   (旁路 store 收敛专项 2026-08-28:原直连 fetchProductionState 已删除)
//
// 持久化:不持久化(每次启动从 server 拉取最新状态)

import { writable } from "svelte/store";
import type { ProductionState } from "$lib/backend/production-views";

// 视图类型与映射收敛在 backend 层(单一数据通道),此处 re-export 保持既有 import 路径兼容
export type { ProductionState };

export const productionStateStore = writable<ProductionState>({
  currentSessionId: null,
  rulesetVersion: 0,
  rulesetHash: null,
  status: "offline",
  updatedAt: null,
});

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

/** 拉取最新 production 状态(应用启动 / 发布后调用;fetcher 由调用方提供) */
export async function refreshProductionState(
  fetcher: () => Promise<ProductionState>,
): Promise<void> {
  const ps = await fetcher();
  productionStateStore.set(ps);
}
