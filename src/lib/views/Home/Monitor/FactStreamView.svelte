<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:Fact 流虚拟列表视图(中心区域,消费 factStreamStore)
    - 顶部:Fact 数统计 + 搜索/筛选(fact_type 下拉)
    - 主体:VirtualList 渲染 FactCard
    - 底部:自动滚动开关(新 Fact 追加模式)
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.2(Fact 流) + §8.2(虚拟列表性能)
-->

<script lang="ts">
  import { get } from "svelte/store";
  import type { FactData } from "$lib/stores/sse-events";
  import {
    factStreamStore,
    factCount,
    clearFacts,
  } from "$lib/stores/fact-stream";
  import VirtualList from "$lib/components/VirtualList.svelte";
  import FactCard from "./FactCard.svelte";

  interface Props {
    /** 最大渲染项高度(px),默认 88 */
    itemHeight?: number;
  }

  let { itemHeight = 88 }: Props = $props();

  let searchQuery = $state("");
  let typeFilter = $state<string>("all");
  let autoScroll = $state(true);
  let listRef = $state<{ scrollToBottom: () => void } | null>(null);

  let allFacts = $derived(get(factStreamStore));
  let total = $derived(get(factCount));

  let factTypeOptions = $derived.by<string[]>(() => {
    const set = new Set<string>();
    for (const f of allFacts) set.add(f.fact_type);
    return ["all", ...Array.from(set)];
  });

  let filtered = $derived.by<FactData[]>(() => {
    let result = allFacts;
    if (typeFilter !== "all") {
      result = result.filter((f) => f.fact_type === typeFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((f) => {
        if (f.fact_id.toLowerCase().includes(q)) return true;
        if (f.fact_type.toLowerCase().includes(q)) return true;
        const c = f.content;
        if (typeof c === "string") return c.toLowerCase().includes(q);
        if (typeof c === "object" && c !== null)
          return JSON.stringify(c).toLowerCase().includes(q);
        return false;
      });
    }
    return result;
  });

  let lastCount = $state(0);
  $effect(() => {
    const n = filtered.length;
    if (autoScroll && listRef && n > lastCount) {
      requestAnimationFrame(() => listRef?.scrollToBottom());
      lastCount = n;
    }
    if (n < lastCount) lastCount = n;
  });

  function handleClear() {
    clearFacts();
  }
</script>

<div class="fact-stream-view">
  <header class="fs-header">
    <div class="fs-left">
      <h3 class="fs-title">📡 Fact 流</h3>
      <span class="fs-count">{filtered.length} / {total}</span>
    </div>
    <div class="fs-right">
      <input
        type="search"
        class="fs-search"
        placeholder="搜索 Fact..."
        bind:value={searchQuery}
      />
      <select class="fs-type-filter" bind:value={typeFilter}>
        {#each factTypeOptions as opt (opt)}
          <option value={opt}>{opt === "all" ? "全部类型" : opt}</option>
        {/each}
      </select>
      <label class="fs-auto" title="新 Fact 自动滚动到底部">
        <input type="checkbox" bind:checked={autoScroll} />
        <span>自动滚动</span>
      </label>
      <button type="button" class="btn btn-clear" onclick={handleClear}
        >清空</button
      >
    </div>
  </header>

  <div class="fs-list">
    {#if filtered.length === 0}
      <div class="fs-empty">
        <div class="fs-empty-icon">🕳️</div>
        <p>暂无 Fact 数据</p>
        <p class="fs-empty-sub">
          {allFacts.length === 0
            ? "提交业务事件后 Fact 会出现在此处"
            : "当前筛选条件下无匹配结果"}
        </p>
      </div>
    {:else}
      <VirtualList
        bind:this={listRef}
        items={filtered}
        {itemHeight}
        height={0}
        overscan={5}
      >
        {#snippet renderItem(item: FactData, index: number)}
          <FactCard fact={item} seqNo={index + 1} />
        {/snippet}
      </VirtualList>
    {/if}
  </div>
</div>

<style>
  .fact-stream-view {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
    height: 100%;
  }
  .fs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    background: var(--color-gray-50, #f9fafb);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .fs-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .fs-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .fs-count {
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
    font-family: var(--font-mono, monospace);
  }
  .fs-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .fs-search,
  .fs-type-filter {
    font-size: 11px;
    padding: 4px 8px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    background: white;
    font-family: inherit;
  }
  .fs-search {
    min-width: 140px;
  }
  .fs-auto {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-gray-600, #4b5563);
    cursor: pointer;
  }
  .btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
  }
  .btn-clear {
    background: white;
    border: 1px solid var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .btn-clear:hover {
    background: var(--color-gray-100, #f3f4f6);
  }
  .fs-list {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .fs-list > :global(.virtual-list-scroll) {
    height: 100%;
  }
  .fs-list
    > :global(
      .virtual-list-scroll > .virtual-list-inner > .virtual-list-visible > div
    ) {
    padding: 4px 8px;
  }
  .fs-empty {
    padding: 48px 16px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .fs-empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }
  .fs-empty p {
    margin: 4px 0;
    font-size: 13px;
  }
  .fs-empty-sub {
    font-size: 11px;
    opacity: 0.8;
  }
</style>
