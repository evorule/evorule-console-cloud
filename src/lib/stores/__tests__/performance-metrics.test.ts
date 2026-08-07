// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 EvoRule Project
// performance-metrics 单测 — parsePrometheusMetrics Prometheus 格式解析
//
// 运行: npx vitest run src/lib/stores/__tests__/performance-metrics.test.ts
//
// 关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §4.4 + §5.1 + parsePrometheusMetrics

import { describe, test, expect } from "vitest";
import {
  parsePrometheusMetrics,
  DEFAULT_METRICS,
} from "../performance-metrics";

describe("parsePrometheusMetrics - 标准 Prometheus 格式", () => {
  test("解析全部 evorule 指标", () => {
    const text = `# HELP evorule_latency_p50 P50 latency in ms
# TYPE evorule_latency_p50 gauge
evorule_latency_p50 120
evorule_latency_p99 480
evorule_throughput 1423
evorule_error_rate 0.02
evorule_active_sessions 3
`;
    const metrics = parsePrometheusMetrics(text);

    expect(metrics.latencyP50).toBe(120);
    expect(metrics.latencyP99).toBe(480);
    expect(metrics.throughput).toBe(1423);
    expect(metrics.errorRate).toBe(0.02);
    expect(metrics.activeSessions).toBe(3);
    expect(metrics.updatedAt).toBeTruthy();
  });

  test("解析带标签的指标(metric{labels} value)", () => {
    const text = `evorule_latency_p50{quantile="0.5"} 120
evorule_latency_p99{quantile="0.99"} 480
evorule_throughput 1423`;
    const metrics = parsePrometheusMetrics(text);

    expect(metrics.latencyP50).toBe(120);
    expect(metrics.latencyP99).toBe(480);
    expect(metrics.throughput).toBe(1423);
  });

  test("忽略注释行(# 开头)", () => {
    const text = `# HELP evorule_latency_p50 P50
# TYPE evorule_latency_p50 gauge
evorule_latency_p50 100`;
    const metrics = parsePrometheusMetrics(text);
    expect(metrics.latencyP50).toBe(100);
  });

  test("忽略空行", () => {
    const text = `evorule_latency_p50 100

evorule_throughput 500`;
    const metrics = parsePrometheusMetrics(text);
    expect(metrics.latencyP50).toBe(100);
    expect(metrics.throughput).toBe(500);
  });
});

describe("parsePrometheusMetrics - 缺失指标降级为 0", () => {
  test("空文本 → 全部默认值", () => {
    const metrics = parsePrometheusMetrics("");
    expect(metrics.latencyP50).toBe(0);
    expect(metrics.latencyP99).toBe(0);
    expect(metrics.throughput).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.activeSessions).toBe(0);
  });

  test("只有部分指标 → 其余降级为 0", () => {
    const text = `evorule_latency_p50 100`;
    const metrics = parsePrometheusMetrics(text);
    expect(metrics.latencyP50).toBe(100);
    expect(metrics.latencyP99).toBe(0); // 缺失
    expect(metrics.throughput).toBe(0); // 缺失
  });

  test("非 evorule 前缀的指标被忽略", () => {
    const text = `other_metric 999
evorule_throughput 500`;
    const metrics = parsePrometheusMetrics(text);
    expect(metrics.throughput).toBe(500);
    // other_metric 不映射到任何字段(不影响)
  });
});

describe("parsePrometheusMetrics - 容错", () => {
  test("科学计数法数值", () => {
    const text = `evorule_throughput 1.42e3
evorule_error_rate 2e-2`;
    const metrics = parsePrometheusMetrics(text);
    expect(metrics.throughput).toBe(1420);
    expect(metrics.errorRate).toBeCloseTo(0.02, 5);
  });

  test("非法数值行被跳过(不抛错)", () => {
    const text = `evorule_throughput not_a_number
evorule_latency_p50 100`;
    const metrics = parsePrometheusMetrics(text);
    expect(metrics.throughput).toBe(0); // 解析失败降级
    expect(metrics.latencyP50).toBe(100); // 正常解析
  });

  test("DEFAULT_METRICS 是干净的默认值", () => {
    expect(DEFAULT_METRICS.latencyP50).toBe(0);
    expect(DEFAULT_METRICS.updatedAt).toBe("");
  });
});
