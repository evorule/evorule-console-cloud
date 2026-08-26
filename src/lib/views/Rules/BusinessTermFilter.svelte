<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务术语筛选器(v0 新增,决策 §3.1 + §4.5)
    - 展示当前行业激活术语(activeTermsByIndustry 派生 store)
    - 搜索框:前缀匹配(matchTerms,带行业优先级)
    - 术语 chips:点击可筛选关联规则(通过 ruleBusinessMeta.businessTermIds)
    - 选中术语高亮,清空按钮重置
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §6.1 + §4.5.2
-->

<script lang="ts">
  import { activeTermsByIndustry, matchTerms } from "$lib/stores/business-terms";
  import type { BusinessTerm } from "$lib/stores/business-terms";

  let {
    selectedTermId = $bindable(),
  }: {
    /** 选中的术语 ID(null = 不筛选) */
    selectedTermId: string | null;
  } = $props();

  let query = $state("");

  // 搜索结果(有 query 时用 matchTerms,否则用全部激活术语)
  const displayTerms = $derived(
    query.trim()
      ? matchTerms(query, undefined, 20)
      : $activeTermsByIndustry,
  );

  function toggleTerm(termId: string): void {
    selectedTermId = selectedTermId === termId ? null : termId;
  }

  function clearFilter(): void {
    selectedTermId = null;
    query = "";
  }
</script>

<div class="term-filter">
  <div class="filter-header">
    <span class="filter-title">🏷️ 业务术语</span>
    {#if selectedTermId}
      <button type="button" class="clear-btn" onclick={clearFilter}>
        清除筛选 ✕
      </button>
    {/if}
  </div>

  <input
    type="text"
    class="search-input"
    placeholder="搜索术语...（如：金额、审批、报销）"
    bind:value={query}
  />

  <div class="term-chips">
    {#if displayTerms.length === 0}
      <span class="empty-hint">
        {query ? "无匹配术语" : "当前行业无激活术语"}
      </span>
    {:else}
      {#each displayTerms as term (term.id)}
        <button
          type="button"
          class="term-chip"
          class:selected={selectedTermId === term.id}
          onclick={() => toggleTerm(term.id)}
          title={term.description}
        >
          {term.label}
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .term-filter {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 8px;
  }
  .filter-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .filter-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .clear-btn {
    background: none;
    border: none;
    color: var(--color-error, #dc2626);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 6px;
  }
  .search-input {
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 6px;
    font-size: 13px;
    background: var(--bg-card);
  }
  .search-input:focus {
    outline: none;
    border-color: var(--color-primary, #2563eb);
    box-shadow: 0 0 0 2px var(--color-primary-bg, #dbeafe);
  }
  .term-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 120px;
    overflow-y: auto;
  }
  .term-chip {
    padding: 3px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 12px;
    background: var(--bg-card);
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .term-chip:hover {
    border-color: var(--color-primary, #2563eb);
    color: var(--color-primary, #2563eb);
  }
  .term-chip.selected {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .empty-hint {
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    font-style: italic;
  }
</style>
