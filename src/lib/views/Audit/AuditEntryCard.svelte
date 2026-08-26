<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:单条业务化审计条目卡片(P06 §8.3)
    - 顶部:业务时间 + 业务动作 + hash 截断 + 验证状态徽标
    - 中部:触发的规则(若有)+ 业务结果(若有)
    - 底部:可展开的业务化 payload(JSON 树)
  交互:
    - 点击:触发 onSelect(factId)
    - 范围选择(Shift+Click):触发 onSelectRange
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6.1 + §8.3
-->

<script lang="ts">
  import type { BusinessAuditEntry } from "$lib/stores/business-audit";

  interface Props {
    entry: BusinessAuditEntry;
    selected?: boolean;
    inRange?: boolean;
    onSelect?: (factId: number) => void;
    onSelectRange?: (factId: number) => void;
  }

  let {
    entry,
    selected = false,
    inRange = false,
    onSelect,
    onSelectRange,
  }: Props = $props();

  let expanded = $state(false);

  function handleClick(e: MouseEvent): void {
    // Shift+Click 触发范围选择
    if (e.shiftKey && onSelectRange) {
      e.preventDefault();
      onSelectRange(entry.factId);
      return;
    }
    onSelect?.(entry.factId);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(entry.factId);
    } else if (e.key === "Shift" && onSelectRange) {
      // Shift 单独按下不触发,只在组合点击时
    }
  }
</script>

<div
  class="audit-entry-card"
  class:selected
  class:in-range={inRange}
  class:verified={entry.verified}
  class:broken={!entry.verified}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeydown}
  aria-pressed={selected}
>
  <div class="header">
    <span class="time">{entry.businessTime}</span>
    <span class="action">{entry.businessAction}</span>
    <span class="hash" title={entry.hash}
      >{entry.hash ? `${entry.hash.slice(0, 8)}…` : "-"}</span
    >
    <span
      class="verified-badge"
      class:ok={entry.verified}
      class:fail={!entry.verified}
      title={entry.verified ? "链验证通过" : "链断裂(可能被篡改)"}
    >
      {entry.verified ? "✅" : "🔴"}
    </span>
  </div>

  {#if entry.triggeredRule}
    <div class="triggered">
      <span class="arrow">→</span>
      <span class="label">触发:</span>
      <span class="rule">{entry.triggeredRule}</span>
    </div>
  {/if}

  {#if entry.businessResult}
    <div class="result">{entry.businessResult}</div>
  {/if}

  {#if Object.keys(entry.businessPayload).length > 0}
    <details
      class="payload"
      ontoggle={(e) => (expanded = e.currentTarget.open)}
    >
      <summary
        >业务数据({Object.keys(entry.businessPayload).length} 字段)</summary
      >
      <pre>{JSON.stringify(entry.businessPayload, null, 2)}</pre>
    </details>
  {/if}
</div>

<style>
  .audit-entry-card {
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    transition: all 0.12s ease;
    border-left: 3px solid var(--color-gray-300, #d1d5db);
  }
  .audit-entry-card:hover {
    border-color: var(--color-gray-300, #d1d5db);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  .audit-entry-card.selected {
    border-left-color: var(--color-primary, #2563eb);
    background: var(--color-info-bg, #eff6ff);
  }
  .audit-entry-card.in-range {
    border-left-color: var(--color-info, #93c5fd);
    background: var(--color-info-bg, #f0f7ff);
  }
  .audit-entry-card.verified {
    border-left-color: var(--success, #10b981);
  }
  .audit-entry-card.broken {
    border-left-color: var(--danger, #ef4444);
    background: var(--color-error-bg, #fef2f2);
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .time {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--color-gray-600, #4b5563);
    flex-shrink: 0;
  }
  .action {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hash {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--brand, #7c3aed);
    background: var(--color-info-bg, #f5f3ff);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .verified-badge {
    font-size: 12px;
    flex-shrink: 0;
  }

  .triggered {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--color-gray-700, #374151);
  }
  .triggered .arrow {
    color: var(--color-primary, #2563eb);
    font-weight: 700;
  }
  .triggered .label {
    color: var(--color-gray-500, #6b7280);
  }
  .triggered .rule {
    font-weight: 500;
  }

  .result {
    margin-top: 3px;
    font-size: 11px;
    color: var(--color-gray-600, #4b5563);
  }

  .payload {
    margin-top: 6px;
    font-size: 11px;
  }
  .payload summary {
    cursor: pointer;
    color: var(--color-gray-500, #6b7280);
    user-select: none;
  }
  .payload summary:hover {
    color: var(--color-gray-700, #374151);
  }
  .payload pre {
    margin: 4px 0 0;
    padding: 6px;
    background: var(--color-gray-50, #f9fafb);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-gray-700, #374151);
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
