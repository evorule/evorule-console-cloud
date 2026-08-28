<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console JSON 树递归节点 — 与 JsonTree 配合,支持自递归 -->
<!--
  职责:递归渲染 JSON 节点。容器(对象/数组)用 <details> 折叠。
  自引用自身处理嵌套。
-->

<script lang="ts">
  import JsonNode from "./JsonNode.svelte";

  interface Props {
    data: unknown;
    level?: number;
    key?: string;
  }

  let { data, level = 0, key }: Props = $props();

  function getType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function isContainer(value: unknown): boolean {
    return value !== null && typeof value === "object";
  }

  function getEntries(value: unknown): Array<[string, unknown]> {
    if (Array.isArray(value)) {
      return value.map((v, i) => [String(i), v]);
    }
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>);
    }
    return [];
  }

  function formatPrimitive(value: unknown): string {
    if (typeof value === "string") return `"${value}"`;
    if (value === null) return "null";
    return String(value);
  }

  function primitiveClass(value: unknown): string {
    if (typeof value === "string") return "val-string";
    if (typeof value === "number") return "val-number";
    if (typeof value === "boolean") return "val-boolean";
    if (value === null) return "val-null";
    return "";
  }
</script>

{#if isContainer(data)}
  <!-- level 0-2 默认展开,更深层默认折叠;直接用 level < 3 避免 const 捕获初始值的 warning -->
  <details open={level < 3}>
    <summary class="tree-summary">
      {#if key !== undefined}
        <span class="tree-key">{key}:</span>
      {/if}
      <span class="type-tag">{getType(data)}</span>
      <span class="count">({getEntries(data).length})</span>
    </summary>
    <div class="tree-children">
      {#each getEntries(data) as [k, value] (k)}
        <JsonNode data={value} level={level + 1} key={k} />
      {/each}
    </div>
  </details>
{:else}
  <div class="tree-row">
    {#if key !== undefined}
      <span class="tree-key">{key}:</span>
    {/if}
    <span class="primitive {primitiveClass(data)}">{formatPrimitive(data)}</span
    >
  </div>
{/if}

<style>
  .tree-summary {
    cursor: pointer;
    padding: 1px 0;
    user-select: none;
  }

  .tree-children {
    padding-left: var(--spacing-md);
    border-left: 1px dashed var(--border);
    margin-left: 4px;
  }

  .tree-row {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-xs);
    padding: 1px 0;
  }

  .tree-key {
    color: var(--brand);
    font-weight: var(--font-medium);
  }

  .type-tag {
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
  }

  .count {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .primitive {
    color: var(--text-primary);
  }

  .val-string {
    color: var(--success);
  }

  .val-number {
    color: var(--brand);
  }

  .val-boolean {
    color: var(--warning);
    font-weight: var(--font-semibold);
  }

  .val-null {
    color: var(--text-secondary);
    font-style: italic;
  }
</style>
