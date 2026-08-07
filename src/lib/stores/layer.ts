// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 层视图 store(状态 C 内部的 L1/L2 切换)。
// - 'L1':监控大屏(Production Runtime,消费 SSE)
// - 'L2':编辑台(Workspace,规则编辑 / 沙盒入口)
// - null:未初始化(HomeRouter 进入状态 C 时按 production 状态选默认层)
//
// 持久化:localStorage(key: evorule-console-cloud:layer)
//   刷新后保持上次所在层(符合"每天上班打开"的连续性)

import { writable } from "svelte/store";
import { browser } from "$app/environment";
import type { ProductionState } from "./production-state";

export type Layer = "L1" | "L2" | null;

const STORAGE_KEY = "evorule-console-cloud:layer";

function loadLayer(): Layer {
  if (!browser) return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "L1" || raw === "L2" ? raw : null;
}

export const layerStore = writable<Layer>(loadLayer());

layerStore.subscribe((l) => {
  if (!browser || l === null) return;
  localStorage.setItem(STORAGE_KEY, l);
});

// === 便捷函数 ===

export function setLayer(l: "L1" | "L2"): void {
  layerStore.set(l);
}

/**
 * 按 production 状态选默认层。
 * - production 运行中(status='running' 且有已发布规则)→ L1 监控大屏
 * - 否则(刚建库,还没发布)→ L2 编辑台
 */
export function resolveDefaultLayer(ps: ProductionState | null): "L1" | "L2" {
  if (ps && ps.status === "running" && ps.rulesetVersion > 0) {
    return "L1";
  }
  return "L2";
}
