<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:性能指标面板(右下角,5 项指标 + 迷你条形)
    - P50 / P99 延迟(ms)
    - 吞吐量(req/s)
    - 错误率(%)
    - 活跃 session 数
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.1 + §4.4(性能指标)
-->

<script lang="ts">
  import type { PerformanceMetricsData } from "$lib/stores/performance-metrics";

  interface Props { data: PerformanceMetricsData; }
  let { data }: Props = $props();

  const latencyP50Bar = $derived(Math.min(100, (data.latencyP50 / 500) * 100));
  const latencyP99Bar = $derived(Math.min(100, (data.latencyP99 / 2000) * 100));
  const throughputBar = $derived(Math.min(100, (data.throughput / 5000) * 100));
  const errorRateBar = $derived(Math.min(100, data.errorRate * 100));
  const sessionsBar = $derived(Math.min(100, (data.activeSessions / 100) * 100));
</script>

<div class="perf-panel">
  <header class="perf-header">
    <h3 class="perf-title">📊 性能指标</h3>
    {#if data.updatedAt}
      <span class="perf-updated">{new Date(data.updatedAt).toLocaleTimeString()}</span>
    {/if}
  </header>

  <div class="perf-grid">
    <!-- P50 -->
    <div class="perf-cell">
      <div class="perf-cell-head">
        <span class="perf-label">P50 延迟</span>
        <span class="perf-value ms">{data.latencyP50.toFixed(0)} <u>ms</u></span>
      </div>
      <div class="perf-bar-track"><div class="perf-bar perf-bar-info" style={`width: ${latencyP50Bar}%;`}></div></div>
    </div>
    <!-- P99 -->
    <div class="perf-cell">
      <div class="perf-cell-head">
        <span class="perf-label">P99 延迟</span>
        <span class="perf-value ms" class:hot={data.latencyP99 > 1000}>{data.latencyP99.toFixed(0)} <u>ms</u></span>
      </div>
      <div class="perf-bar-track"><div class="perf-bar perf-bar-warning" style={`width: ${latencyP99Bar}%;`}></div></div>
    </div>
    <!-- Throughput -->
    <div class="perf-cell">
      <div class="perf-cell-head">
        <span class="perf-label">吞吐量</span>
        <span class="perf-value">{data.throughput.toFixed(0)} <u>req/s</u></span>
      </div>
      <div class="perf-bar-track"><div class="perf-bar perf-bar-success" style={`width: ${throughputBar}%;`}></div></div>
    </div>
    <!-- Error rate -->
    <div class="perf-cell">
      <div class="perf-cell-head">
        <span class="perf-label">错误率</span>
        <span class="perf-value" class:danger={data.errorRate > 0.02}>{(data.errorRate * 100).toFixed(2)} <u>%</u></span>
      </div>
      <div class="perf-bar-track"><div class="perf-bar perf-bar-danger" style={`width: ${errorRateBar}%;`}></div></div>
    </div>
    <!-- Active sessions -->
    <div class="perf-cell cell-sessions">
      <div class="perf-cell-head">
        <span class="perf-label">活跃 Session</span>
        <span class="perf-value">{data.activeSessions} <u>个</u></span>
      </div>
      <div class="perf-bar-track"><div class="perf-bar perf-bar-primary" style={`width: ${sessionsBar}%;`}></div></div>
    </div>
  </div>
</div>

<style>
  .perf-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
  }
  .perf-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    background: var(--color-gray-50, #f9fafb);
    flex-shrink: 0;
  }
  .perf-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .perf-updated {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    font-family: var(--font-mono, monospace);
  }
  .perf-grid {
    padding: 8px 12px 12px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 14px;
  }
  .perf-cell.cell-sessions {
    grid-column: 1 / -1;
  }
  .perf-cell-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 3px;
  }
  .perf-label {
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
    font-weight: 500;
  }
  .perf-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .perf-value u {
    text-decoration: none;
    font-size: 10px;
    font-weight: 500;
    color: var(--color-gray-500, #6b7280);
  }
  .perf-value.ms.hot { color: #c2410c; }
  .perf-value.danger { color: var(--color-error, #dc2626); animation: flash 1.4s ease-in-out infinite; }
  @keyframes flash { 0%,100%{opacity:1;} 50%{opacity:0.6;} }
  .perf-bar-track {
    height: 5px;
    background: var(--color-gray-100, #f3f4f6);
    border-radius: 3px;
    overflow: hidden;
  }
  .perf-bar {
    height: 100%;
    border-radius: 3px;
    transition: width 0.3s ease;
  }
  .perf-bar-info    { background: #2563eb; }
  .perf-bar-warning { background: #f59e0b; }
  .perf-bar-success { background: var(--success, #10b981); }
  .perf-bar-danger  { background: var(--danger, #ef4444); }
  .perf-bar-primary { background: #6366f1; }
</style>
