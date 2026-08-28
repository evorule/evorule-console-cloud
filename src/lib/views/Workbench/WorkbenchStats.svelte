<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Region 2 — 4 个统计卡
    规则 / Sessions / 待审 / 最近 Fact
    点击 → 跳对应详情页
-->

<script lang="ts">
  interface Stats {
    ruleCount: number;
    builtInCount: number;
    customCount: number;
    sessionCount: number;
    pendingCount: number;
    lastFactAt: number | null;
    lastFactType: string | null;
  }

  interface Props {
    stats: Stats;
    onOpenRules: () => void;
    onOpenExecution: () => void;
    onOpenPublishQueue: () => void;
    onOpenAudit: () => void;
  }

  let { stats, onOpenRules, onOpenExecution, onOpenPublishQueue, onOpenAudit }: Props =
    $props();

  function fmtFactAt(lt: number | null): string {
    if (lt === null) return "—";
    // logical_time 可能是 sequence number 或 unix ms,这里以当前时间估算(简化)
    return `fact #${lt}`;
  }
</script>

<div class="region-stats">
  <button class="stat-card" onclick={onOpenRules} title="打开规则库">
    <div class="stat-icon">📐</div>
    <div class="stat-label">规则</div>
    <div class="stat-value">{stats.ruleCount}<span class="unit">条</span></div>
    <div class="stat-meta">
      内置 {stats.builtInCount} + 自建 {stats.customCount}
      <span class="link">打开规则库 →</span>
    </div>
  </button>

  <button class="stat-card" onclick={onOpenExecution} title="打开执行台">
    <div class="stat-icon">▶</div>
    <div class="stat-label">Sessions</div>
    <div class="stat-value">{stats.sessionCount}<span class="unit">active</span></div>
    <div class="stat-meta">
      {#if stats.sessionCount === 0}暂无执行
      {:else}最近活跃中
      {/if}
      <span class="link">打开执行台 →</span>
    </div>
  </button>

  <button class="stat-card" onclick={onOpenPublishQueue} title="打开发布队列">
    <div class="stat-icon">📥</div>
    <div class="stat-label">待审</div>
    <div class="stat-value">
      {stats.pendingCount}
      {#if stats.pendingCount > 0}<span class="stat-badge">待处理</span>{/if}
    </div>
    <div class="stat-meta">
      {#if stats.pendingCount === 0}无待审 · 全部已发布
      {:else}需要审批 / 回滚
      {/if}
      <span class="link">去审批 →</span>
    </div>
  </button>

  <button class="stat-card" onclick={onOpenAudit} title="打开审计">
    <div class="stat-icon">🔍</div>
    <div class="stat-label">最近 Fact</div>
    <div class="stat-value">
      {fmtFactAt(stats.lastFactAt)}
    </div>
    <div class="stat-meta">
      type: {stats.lastFactType ?? "—"}
      <span class="link">打开审计 →</span>
    </div>
  </button>
</div>

<style>
  .region-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }
  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .stat-card:hover {
    border-color: var(--primary, #2563eb);
    transform: translateY(-1px);
  }
  .stat-icon {
    font-size: 22px;
    margin-bottom: 4px;
  }
  .stat-label {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .stat-value .unit {
    font-size: 14px;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .stat-meta {
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 6px;
  }
  .stat-meta .link {
    color: var(--primary, #2563eb);
    text-decoration: none;
    cursor: pointer;
    margin-left: 4px;
  }
  .stat-meta .link:hover {
    text-decoration: underline;
  }
  .stat-badge {
    display: inline-block;
    padding: 2px 8px;
    font-size: 11px;
    background: var(--warning, #ea580c);
    color: white;
    border-radius: 10px;
    margin-left: 6px;
    vertical-align: middle;
  }
  @media (max-width: 1024px) {
    .region-stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
