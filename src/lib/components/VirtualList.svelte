<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:虚拟列表(自实现,轻量高性能)
    - 只渲染可视区域内的 DOM 节点(约 20-50 条),1000+ Fact/秒不卡
    - 固定行高或估算行高
    - 滚动到顶部/底部支持
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.2 + §8.2(虚拟列表性能)
-->

<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  interface Props {
    /** 完整列表数据 */
    items: T[];
    /** 每条数据的渲染 snippet */
    renderItem: Snippet<[T, number]>;
    /** 行高(px),0 = 动态测量(首屏渲染后估算) */
    itemHeight?: number;
    /** 可视区域上方/下方额外渲染的缓冲条数(避免快速滚动白屏) */
    overscan?: number;
    /** 容器高度(px),0 = 100% 填充父容器 */
    height?: number;
    /** 外层滚动元素 class */
    class?: string;
  }

  let {
    items,
    renderItem,
    itemHeight = 0,
    overscan = 5,
    height = 0,
    class: className = "",
  }: Props = $props();

  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let containerHeight = $state(0);
  let measuredItemHeight = $state(0);

  // === 测量动态行高(首屏渲染后取样) ===
  function measureFirstItem(): void {
    if (!scrollContainer || itemHeight > 0) return;
    const firstEl = scrollContainer.querySelector<HTMLElement>(
      "[data-virtual-item]",
    );
    if (firstEl) {
      measuredItemHeight = firstEl.offsetHeight || 60;
    }
  }

  const effectiveItemHeight = $derived(
    itemHeight > 0 ? itemHeight : measuredItemHeight || 60,
  );

  // === 可视区域计算 ===
  const visibleStart = $derived(
    Math.max(0, Math.floor(scrollTop / effectiveItemHeight) - overscan),
  );
  const visibleCount = $derived(
    Math.ceil((containerHeight || 400) / effectiveItemHeight) + overscan * 2,
  );
  const visibleEnd = $derived(
    Math.min(items.length, visibleStart + visibleCount),
  );

  const visibleItems = $derived(
    items.slice(visibleStart, visibleEnd).map((item, i) => ({
      item,
      index: visibleStart + i,
      offset: (visibleStart + i) * effectiveItemHeight,
    })),
  );

  const totalHeight = $derived(items.length * effectiveItemHeight);
  const offsetY = $derived(visibleStart * effectiveItemHeight);

  // === 滚动事件(throttled via rAF) ===
  let rafPending = false;
  function onScroll(): void {
    if (!scrollContainer || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      scrollTop = scrollContainer!.scrollTop;
      rafPending = false;
    });
  }

  // === 测量容器高度 ===
  function measureContainer(): void {
    if (!scrollContainer) return;
    containerHeight = scrollContainer.clientHeight;
    measureFirstItem();
  }

  $effect(() => {
    if (!scrollContainer) return;
    measureContainer();
    const ro = new ResizeObserver(() => measureContainer());
    ro.observe(scrollContainer);
    return () => ro.disconnect();
  });

  // === 公开方法:滚动到底部/顶部 ===
  export function scrollToBottom(): void {
    if (!scrollContainer) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }
  export function scrollToTop(): void {
    if (!scrollContainer) return;
    scrollContainer.scrollTop = 0;
  }
  export function scrollToIndex(index: number): void {
    if (!scrollContainer) return;
    scrollContainer.scrollTop = Math.max(0, index) * effectiveItemHeight;
  }
</script>

<div
  bind:this={scrollContainer}
  class={`virtual-list-scroll ${className}`}
  onscroll={onScroll}
  style={height > 0 ? `height: ${height}px;` : ""}
>
  <div class="virtual-list-inner" style={`height: ${totalHeight}px;`}>
    <div
      class="virtual-list-visible"
      style={`transform: translateY(${offsetY}px);`}
    >
      {#each visibleItems as vi (vi.index)}
        <div data-virtual-item style={`min-height: ${effectiveItemHeight}px;`}>
          {@render renderItem(vi.item, vi.index)}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .virtual-list-scroll {
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    width: 100%;
    scroll-behavior: auto;
    -webkit-overflow-scrolling: touch;
  }
  .virtual-list-inner {
    position: relative;
    width: 100%;
  }
  .virtual-list-visible {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    will-change: transform;
  }
</style>
