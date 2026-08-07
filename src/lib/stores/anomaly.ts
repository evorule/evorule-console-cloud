// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 异常告警 store(最多 100 条,最新的在前)。
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.3

import { writable, derived } from "svelte/store";
import type { AnomalyData, AnomalyLevel } from "./sse-events";

/** 异常列表上限(超出丢弃最旧的) */
const MAX_ANOMALIES = 100;

export const anomalyStore = writable<AnomalyData[]>([]);

/** 当前异常数(派生) */
export const anomalyCount = derived(anomalyStore, ($a) => $a.length);

/** critical 级别异常数(派生,顶部红色横幅用) */
export const criticalAnomalyCount = derived(anomalyStore, ($a) =>
  $a.filter((a) => a.level === "critical").length,
);

/**
 * 追加异常告警(最新的在前,超出 100 条丢弃最旧的)。
 */
export function appendAnomaly(anomaly: AnomalyData): void {
  anomalyStore.update((anomalies) => {
    const updated = [anomaly, ...anomalies];
    if (updated.length > MAX_ANOMALIES) {
      return updated.slice(0, MAX_ANOMALIES);
    }
    return updated;
  });
}

/** 清空异常列表(session 切换时) */
export function clearAnomalies(): void {
  anomalyStore.set([]);
}

/** 按 level 筛选(派生) */
export function anomaliesByLevel(level: AnomalyLevel) {
  return derived(anomalyStore, ($a) => $a.filter((a) => a.level === level));
}
