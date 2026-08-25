<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:异常告警面板(右上角,按级别折叠列表)
    - Critical / Error / Warning 三档
    - 按 level 折叠展示
    - 最新的在前
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.3(异常告警)
-->

<script lang="ts">
  import { get } from "svelte/store";
  import type { AnomalyData, AnomalyLevel } from "$lib/stores/sse-events";
  import {
    anomalyStore,
    anomalyCount,
    criticalAnomalyCount,
    clearAnomalies,
  } from "$lib/stores/anomaly";

  interface Props {
    maxShownPerLevel?: number;
  }
  let { maxShownPerLevel = 10 }: Props = $props();

  let expandCritical = $state(true);
  let expandError = $state(true);
  let expandWarning = $state(false);

  let all = $derived(get(anomalyStore));
  let total = $derived(get(anomalyCount));
  let criticalCount = $derived(get(criticalAnomalyCount));

  function byLevel(level: AnomalyLevel): AnomalyData[] {
    return all.filter((a) => a.level === level).slice(0, maxShownPerLevel);
  }

  type LevelCfg = {
    label: string;
    icon: string;
    cls: string;
    count: () => number;
  };
  let levelCfg: Record<AnomalyLevel, LevelCfg> = {
    critical: {
      label: "严重",
      icon: "🔴",
      cls: "critical",
      count: () => all.filter((a) => a.level === "critical").length,
    },
    error: {
      label: "错误",
      icon: "🟠",
      cls: "error",
      count: () => all.filter((a) => a.level === "error").length,
    },
    warning: {
      label: "警告",
      icon: "🟡",
      cls: "warning",
      count: () => all.filter((a) => a.level === "warning").length,
    },
  };

  function handleClearAll() {
    clearAnomalies();
  }

  function expandedOf(lv: AnomalyLevel): boolean {
    if (lv === "critical") return expandCritical;
    if (lv === "error") return expandError;
    return expandWarning;
  }
  function toggleExpand(lv: AnomalyLevel) {
    if (lv === "critical") expandCritical = !expandCritical;
    else if (lv === "error") expandError = !expandError;
    else expandWarning = !expandWarning;
  }
</script>

<div class="anomaly-panel">
  <header class="ap-header">
    <div class="ap-left">
      <h3 class="ap-title">🚨 异常告警</h3>
      <span class="ap-count" class:hot={criticalCount > 0}>{total}</span>
    </div>
    <button
      type="button"
      class="btn-clear"
      onclick={handleClearAll}
      disabled={total === 0}>清空</button
    >
  </header>

  {#if total === 0}
    <div class="ap-empty">
      <span class="ap-ok">✅</span>
      <p>暂无异常</p>
      <p class="ap-empty-sub">系统运行良好</p>
    </div>
  {:else}
    <div class="ap-levels">
      {#each ["critical", "error", "warning"] as const as lv (lv)}
        {@const cfg = levelCfg[lv]}
        {@const list = byLevel(lv)}
        {@const n = cfg.count()}
        {#if n > 0}
          <section class={`ap-level ap-${cfg.cls}`}>
            <button
              type="button"
              class="ap-level-head"
              onclick={() => toggleExpand(lv)}
            >
              <span class="ap-toggle">{expandedOf(lv) ? "▼" : "▶"}</span>
              <span class="ap-icon">{cfg.icon}</span>
              <span class="ap-label">{cfg.label}</span>
              <span class="ap-level-count">{n}</span>
            </button>
            {#if expandedOf(lv) && list.length > 0}
              <ul class="ap-list">
                {#each list as a (a.timestamp + a.rule_id + a.message)}
                  <li class="ap-item">
                    <div class="ap-item-head">
                      <span class="ap-rule">规则:<code>{a.rule_id}</code></span>
                      <span class="ap-time"
                        >{new Date(a.timestamp).toLocaleTimeString()}</span
                      >
                    </div>
                    <div class="ap-message">{a.message}</div>
                    {#if a.fact_id}
                      <div class="ap-fact">
                        关联 Fact:<code>{a.fact_id.slice(0, 18)}…</code>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .anomaly-panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
  }
  .ap-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    background: var(--color-gray-50, #f9fafb);
    flex-shrink: 0;
  }
  .ap-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .ap-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .ap-count {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 700;
    padding: 1px 8px;
    background: var(--color-gray-200, #e5e7eb);
    color: var(--color-text-secondary, #4b5563);
    border-radius: 10px;
  }
  .ap-count.hot {
    background: var(--color-error, #dc2626);
    color: white;
    animation: flash 1s ease-in-out infinite;
  }
  @keyframes flash {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.65;
    }
  }
  .btn-clear {
    font-size: 11px;
    padding: 3px 10px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    background: white;
    color: var(--color-text-secondary, #4b5563);
    cursor: pointer;
    font-family: inherit;
  }
  .btn-clear:hover:not(:disabled) {
    background: var(--color-gray-100, #f3f4f6);
  }
  .btn-clear:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ap-empty {
    padding: 28px 12px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .ap-ok {
    font-size: 24px;
    margin-bottom: 4px;
  }
  .ap-empty p {
    margin: 0;
    font-size: 13px;
  }
  .ap-empty-sub {
    font-size: 11px !important;
    opacity: 0.75;
  }
  .ap-levels {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px;
    gap: 4px;
  }
  .ap-level {
    border-radius: 6px;
    overflow: hidden;
  }
  .ap-critical {
    border: 1px solid #fecaca;
    background: var(--color-error-bg, #fef2f2);
  }
  .ap-error {
    border: 1px solid #fed7aa;
    background: #fff7ed;
  }
  .ap-warning {
    border: 1px solid var(--color-warning, #fde68a);
    background: var(--color-warning-bg, #fffbeb);
  }
  .ap-level-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }
  .ap-toggle {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    width: 12px;
  }
  .ap-icon {
    font-size: 12px;
  }
  .ap-label {
    font-size: 12px;
    font-weight: 700;
    flex: 1;
  }
  .ap-critical .ap-label {
    color: #b91c1c;
  }
  .ap-error .ap-label {
    color: #c2410c;
  }
  .ap-warning .ap-label {
    color: var(--color-warning, #b45309);
  }
  .ap-level-count {
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    font-size: 11px;
    padding: 0 6px;
    min-width: 18px;
    text-align: center;
    border-radius: 8px;
  }
  .ap-critical .ap-level-count {
    background: #fecaca;
    color: #7f1d1d;
  }
  .ap-error .ap-level-count {
    background: #fed7aa;
    color: #7c2d12;
  }
  .ap-warning .ap-level-count {
    background: var(--color-warning, #fde68a);
    color: var(--color-warning, #78350f);
  }
  .ap-list {
    list-style: none;
    margin: 0;
    padding: 4px 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ap-item {
    padding: 5px 8px;
    background: white;
    border-radius: 4px;
    border-left: 3px solid;
  }
  .ap-critical .ap-item {
    border-left-color: #dc2626;
  }
  .ap-error .ap-item {
    border-left-color: #ea580c;
  }
  .ap-warning .ap-item {
    border-left-color: #d97706;
  }
  .ap-item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }
  .ap-rule {
    font-size: 10px;
    color: var(--color-gray-600, #4b5563);
  }
  .ap-rule code {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    background: var(--color-gray-100, #f3f4f6);
    padding: 0 3px;
    border-radius: 3px;
  }
  .ap-time {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .ap-message {
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    line-height: 1.4;
  }
  .ap-fact {
    margin-top: 2px;
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .ap-fact code {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }
</style>
