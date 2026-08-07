// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
//
// 性能指标 store(5s 轮询 /metrics,解析 Prometheus 格式)。
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §4.4 + §5.1 + §3.1(决策 1:5s 轮询)

import { writable } from "svelte/store";
import { browser } from "$app/environment";

/** 性能指标数据 */
export interface PerformanceMetricsData {
  /** P50 延迟(ms) */
  latencyP50: number;
  /** P99 延迟(ms) */
  latencyP99: number;
  /** 吞吐量(req/s) */
  throughput: number;
  /** 错误率(%) */
  errorRate: number;
  /** 活跃 session 数 */
  activeSessions: number;
  /** 最后更新时间 */
  updatedAt: string;
}

/** 默认/空指标 */
export const DEFAULT_METRICS: PerformanceMetricsData = {
  latencyP50: 0,
  latencyP99: 0,
  throughput: 0,
  errorRate: 0,
  activeSessions: 0,
  updatedAt: "",
};

export const performanceMetricsStore = writable<PerformanceMetricsData>(
  DEFAULT_METRICS,
);

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 开始 5s 轮询性能指标。
 * 解析 evorule-server /metrics 端点的 Prometheus exposition 格式。
 */
export function startMetricsPolling(baseUrl: string): void {
  if (!browser) return;
  stopMetricsPolling();

  const poll = async (): Promise<void> => {
    try {
      const resp = await fetch(`${baseUrl}/metrics`);
      if (!resp.ok) return;
      const text = await resp.text();
      performanceMetricsStore.set(parsePrometheusMetrics(text));
    } catch {
      // 轮询失败,保持上次状态
    }
  };

  void poll();
  pollTimer = setInterval(() => void poll(), 5000);
}

/** 停止轮询 */
export function stopMetricsPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * 解析 Prometheus exposition 格式文本为 PerformanceMetricsData。
 *
 * Prometheus 格式示例:
 *   # HELP evorule_latency_p50 P50 latency in ms
 *   # TYPE evorule_latency_p50 gauge
 *   evorule_latency_p50 120
 *   evorule_latency_p99 480
 *   evorule_throughput 1423
 *   evorule_error_rate 0.02
 *   evorule_active_sessions 3
 *
 * 解析逻辑:逐行扫描,匹配 `metric_name value` 格式。
 * 未识别的指标保持默认 0。
 */
export function parsePrometheusMetrics(text: string): PerformanceMetricsData {
  const metrics: Record<string, number> = {};

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // 匹配 "metric_name value" 或 "metric_name{labels} value"
    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([0-9.eE+-]+)$/);
    if (!match) continue;

    const [, name, valueStr] = match;
    const value = parseFloat(valueStr);
    if (!isNaN(value)) {
      metrics[name] = value;
    }
  }

  return {
    latencyP50: metrics["evorule_latency_p50"] ?? 0,
    latencyP99: metrics["evorule_latency_p99"] ?? 0,
    throughput: metrics["evorule_throughput"] ?? 0,
    errorRate: metrics["evorule_error_rate"] ?? 0,
    activeSessions: metrics["evorule_active_sessions"] ?? 0,
    updatedAt: new Date().toISOString(),
  };
}
