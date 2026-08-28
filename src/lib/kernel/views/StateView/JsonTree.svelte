<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console 通用 JSON 树根组件 — 展现"JSON-in/out 自解释" -->
<!--
  职责:渲染根级 JSON 树(带根标签),递归委托给 JsonNode。
  与 JsonNode 分离是因为 Svelte 不支持组件自递归 import。
-->

<script lang="ts">
  import JsonNode from "./JsonNode.svelte";

  interface Props {
    data: unknown;
    rootLabel?: string;
    defaultExpanded?: boolean;
  }

  let { data, rootLabel, defaultExpanded = true }: Props = $props();

  function getType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  function isContainer(value: unknown): boolean {
    return value !== null && typeof value === "object";
  }

  function countEntries(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object")
      return Object.keys(value as object).length;
    return 0;
  }
</script>

<div class="json-tree">
  {#if rootLabel !== undefined && isContainer(data)}
    <details open={defaultExpanded}>
      <summary class="tree-root">
        <span class="root-label">{rootLabel}</span>
        <span class="type-tag">{getType(data)}</span>
        <span class="count">({countEntries(data)})</span>
      </summary>
      <div class="tree-children">
        <JsonNode {data} level={1} />
      </div>
    </details>
  {:else}
    <JsonNode {data} level={0} />
  {/if}
</div>

<style>
  .json-tree {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--text-primary);
  }

  .tree-root {
    cursor: pointer;
    padding: 2px 0;
    user-select: none;
  }

  .root-label {
    color: var(--text-primary);
    font-weight: var(--font-semibold);
  }

  .type-tag {
    font-size: 10px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    margin-left: var(--spacing-xs);
  }

  .count {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    margin-left: var(--spacing-xs);
  }

  .tree-children {
    padding-left: var(--spacing-md);
    border-left: 1px dashed var(--border);
    margin-left: 4px;
  }

  :global(.tree-row) {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-xs);
  }

  :global(.tree-key) {
    color: var(--brand);
    font-weight: var(--font-medium);
  }

  :global(.primitive) {
    color: var(--text-primary);
  }

  :global(.val-string) {
    color: var(--success);
  }

  :global(.val-number) {
    color: var(--brand);
  }

  :global(.val-boolean) {
    color: var(--warning);
    font-weight: var(--font-semibold);
  }

  :global(.val-null) {
    color: var(--text-secondary);
    font-style: italic;
  }
</style>
