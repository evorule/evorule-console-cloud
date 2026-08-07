<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务化审计时间线(P06 §6.1 + §6.2)
    - 渲染 BusinessAuditEntry[] 列表
    - 支持单选(查看因果)+ 范围选择(决策分析)
    - 顶部摘要:总数 / 已验证 / 断裂 / 规则触发数
    - 筛选:fact_type 下拉
  交互:
    - 点击:单选 → 触发 onSelectFact
    - Shift+Click:范围选择 → 触发 onSelectRange
    - 清空选择按钮
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6.2 + §7.1
-->

<script lang="ts">
  import type {
    BusinessAuditEntry,
    BusinessAuditSummary,
  } from "$lib/stores/business-audit";
  import AuditEntryCard from "./AuditEntryCard.svelte";
  import EmptyState from "../Feedback/EmptyState.svelte";

  interface Props {
    entries: BusinessAuditEntry[];
    summary?: BusinessAuditSummary;
    selectedFactId?: number | null;
    selectedRange?: { from: number; to: number } | null;
    onSelectFact?: (factId: number) => void;
    onSelectRange?: (range: { from: number; to: number } | null) => void;
  }

  let {
    entries,
    summary,
    selectedFactId = null,
    selectedRange = null,
    onSelectFact,
    onSelectRange,
  }: Props = $props();

  // === 筛选状态 ===
  let filterType = $state<string>("");
  let filterRuleOnly = $state(false);

  // === 派生:筛选后条目 ===
  let filteredEntries = $derived(
    entries.filter((e) => {
      if (filterType && e.factType !== filterType) return false;
      if (filterRuleOnly && e.ruleId === null) return false;
      return true;
    }),
  );

  // === 派生:可选 fact_type 列表(来自当前 entries) ===
  let factTypes = $derived(
    Array.from(new Set(entries.map((e) => e.factType))).sort(),
  );

  // === 范围选择辅助 ===
  // Shift+Click 时,以 selectedFactId 为锚点,新点击的 factId 为终点
  // 范围以 entries 数组下标计算(不是 factId 数值)
  function handleEntryClick(factId: number): void {
    onSelectFact?.(factId);
  }

  function handleEntryRangeClick(factId: number): void {
    if (!onSelectRange) return;
    // 无锚点 → 锚点设为当前
    if (selectedFactId === null) {
      onSelectFact?.(factId);
      return;
    }
    // 找锚点和当前 factId 在 filteredEntries 中的下标
    const anchorIdx = filteredEntries.findIndex(
      (e) => e.factId === selectedFactId,
    );
    const currIdx = filteredEntries.findIndex((e) => e.factId === factId);
    if (anchorIdx === -1 || currIdx === -1) {
      onSelectFact?.(factId);
      return;
    }
    const from = Math.min(anchorIdx, currIdx);
    const to = Math.max(anchorIdx, currIdx);
    onSelectRange({ from, to });
  }

  function clearSelection(): void {
    onSelectFact?.(-1); // -1 表示清空(组件层处理)
    onSelectRange?.(null);
  }

  // 判断某条目是否在范围内
  function isInRange(idx: number): boolean {
    if (!selectedRange) return false;
    return idx >= selectedRange.from && idx <= selectedRange.to;
  }
</script>

<div class="audit-timeline">
  <header class="timeline-header">
    <div class="header-row">
      <h3 class="title">📜 业务审计时间线</h3>
      {#if summary}
        <div class="summary">
          <span class="sum-item">共 <strong>{summary.total}</strong></span>
          <span class="sum-item ok">✅ {summary.verified}</span>
          {#if summary.broken > 0}
            <span class="sum-item fail">🔴 {summary.broken}</span>
          {/if}
          <span class="sum-item">规则触发 {summary.ruleTriggered}</span>
        </div>
      {/if}
    </div>

    <div class="filters">
      <select bind:value={filterType} aria-label="按 Fact 类型筛选">
        <option value="">全部类型 ({entries.length})</option>
        {#each factTypes as ft}
          <option value={ft}>{ft}</option>
        {/each}
      </select>
      <label class="filter-check">
        <input type="checkbox" bind:checked={filterRuleOnly} />
        <span>仅规则触发</span>
      </label>
      {#if (selectedFactId !== null && selectedFactId >= 0) || selectedRange}
        <button class="clear-btn" onclick={clearSelection}>✕ 清除选择</button>
      {/if}
    </div>

    {#if selectedRange}
      <div class="range-hint">
        已选范围:第 {selectedRange.from + 1} – {selectedRange.to + 1} 条 ({selectedRange.to -
          selectedRange.from +
          1} 条),可点[💡 决策建议]分析
      </div>
    {/if}
  </header>

  <div class="timeline-list">
    {#if filteredEntries.length === 0}
      <EmptyState
        type="no_data"
        noun="审计条目"
        description={entries.length === 0
          ? "当前 session 还没有 Fact 流入,审计链为空"
          : "当前筛选条件下无匹配条目,请调整筛选"}
      />
    {:else}
      {#each filteredEntries as entry, i (entry.factId)}
        <AuditEntryCard
          {entry}
          selected={entry.factId === selectedFactId}
          inRange={isInRange(i)}
          onSelect={handleEntryClick}
          onSelectRange={handleEntryRangeClick}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .audit-timeline {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
  }
  .timeline-header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    background: var(--color-gray-50, #f9fafb);
    flex-shrink: 0;
  }
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .summary {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--color-gray-600, #4b5563);
  }
  .sum-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .sum-item.ok {
    color: #10b981;
  }
  .sum-item.fail {
    color: #ef4444;
    font-weight: 600;
  }
  .sum-item strong {
    color: var(--color-text-primary, #111827);
  }

  .filters {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .filters select {
    font-size: 11px;
    padding: 3px 6px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    background: white;
    font-family: inherit;
  }
  .filter-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-gray-600, #4b5563);
    cursor: pointer;
  }
  .filter-check input {
    margin: 0;
  }
  .clear-btn {
    font-size: 11px;
    padding: 3px 8px;
    background: white;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-gray-600, #4b5563);
  }
  .clear-btn:hover {
    background: var(--color-gray-50, #f9fafb);
  }

  .range-hint {
    margin-top: 6px;
    padding: 4px 8px;
    background: #eff6ff;
    border: 1px solid #93c5fd;
    border-radius: 4px;
    font-size: 11px;
    color: #1e40af;
  }

  .timeline-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }
</style>
