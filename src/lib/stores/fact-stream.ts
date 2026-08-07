// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// Fact 流 store(环形缓冲,最多 1000 条)。
// 生产环境 1000+ Fact/秒,环形缓冲防止内存无限增长。
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.2 + §7.2(SSE Fact 流数据流)

import { writable, derived } from "svelte/store";
import type { FactData } from "./sse-events";

/** 环形缓冲上限(超出丢弃最旧的) */
const MAX_FACTS = 1000;

export const factStreamStore = writable<FactData[]>([]);

/** 当前 Fact 数(派生) */
export const factCount = derived(factStreamStore, ($f) => $f.length);

/** 最新一条 Fact(派生,业务对象卡片用) */
export const latestFact = derived(factStreamStore, ($f) =>
  $f.length > 0 ? $f[$f.length - 1] : null,
);

/**
 * 追加新 Fact(环形缓冲,超出 1000 条丢弃最旧的)。
 * 新 Fact 追加到末尾(时间顺序)。
 */
export function appendFact(fact: FactData): void {
  factStreamStore.update((facts) => {
    const updated = [...facts, fact];
    if (updated.length > MAX_FACTS) {
      return updated.slice(updated.length - MAX_FACTS);
    }
    return updated;
  });
}

/** 清空 Fact 流(session 切换时) */
export function clearFacts(): void {
  factStreamStore.set([]);
}

/**
 * 按 fact_type 筛选(派生)。
 * 用于业务对象卡片按类型分组。
 */
export function factsByType(factType: string) {
  return derived(factStreamStore, ($f) =>
    $f.filter((fact) => fact.fact_type === factType),
  );
}
