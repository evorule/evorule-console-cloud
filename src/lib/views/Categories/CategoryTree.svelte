<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:分类树组件(P03,设计 §6.1 + §8.4)
    - 递归渲染分类树(可展开/折叠)
    - 点击节点选中(触发 onSelect)
    - 显示每节点关联规则数
    - 支持节点操作按钮(编辑/新增子分类/删除)
  关联设计:P03_DATASET_DESIGN.md §6.1 + §4.3 + §8.4(树构建)
-->

<script lang="ts">
  import type { CategoryNode } from "$lib/stores/category";
  import { getRulesOfCategory } from "$lib/stores/rule-category";

  interface Props {
    nodes: CategoryNode[];
    selectedId?: string | null;
    onSelect?: (id: string) => void;
    onEdit?: (id: string) => void;
    onAddChild?: (parentId: string) => void;
    onDelete?: (id: string) => void;
  }

  let {
    nodes,
    selectedId = null,
    onSelect,
    onEdit,
    onAddChild,
    onDelete,
  }: Props = $props();

  let expanded = $state<Set<string>>(new Set());

  function toggle(id: string): void {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function handleClick(id: string): void {
    onSelect?.(id);
  }

  function handleEdit(e: MouseEvent, id: string): void {
    e.stopPropagation();
    onEdit?.(id);
  }

  function handleAddChild(e: MouseEvent, parentId: string): void {
    e.stopPropagation();
    onAddChild?.(parentId);
    // 自动展开父节点
    const next = new Set(expanded);
    next.add(parentId);
    expanded = next;
  }

  function handleDelete(e: MouseEvent, id: string): void {
    e.stopPropagation();
    onDelete?.(id);
  }
</script>

<div class="category-tree" role="tree">
  {#if nodes.length === 0}
    <div class="empty-tree">暂无分类</div>
  {:else}
    {#each nodes as node (node.id)}
      {@render renderNode(node, 0)}
    {/each}
  {/if}
</div>

{#snippet renderNode(node: CategoryNode, depth: number)}
  {@const hasChildren = node.children.length > 0}
  {@const isExpanded = expanded.has(node.id)}
  {@const isSelected = selectedId === node.id}
  {@const ruleCount = getRulesOfCategory(node.id).length}
  <div
    class="tree-node"
    role="treeitem"
    aria-selected={isSelected}
    style="padding-left: {depth * 16 + 4}px"
  >
    <div
      class="node-row"
      class:selected={isSelected}
      role="button"
      tabindex="0"
      onclick={() => handleClick(node.id)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(node.id);
        }
      }}
    >
      {#if hasChildren}
        <button
          type="button"
          class="toggle-btn"
          onclick={(e) => {
            e.stopPropagation();
            toggle(node.id);
          }}
          aria-label={isExpanded ? "折叠" : "展开"}
        >
          {isExpanded ? "▼" : "▶"}
        </button>
      {:else}
        <span class="toggle-placeholder"></span>
      {/if}
      <span class="node-icon">{node.icon ?? "📁"}</span>
      <span class="node-name">{node.name}</span>
      <span class="node-count" title="关联规则数">{ruleCount}</span>
      <div class="node-actions">
        <button
          type="button"
          class="action-btn"
          title="编辑"
          onclick={(e) => handleEdit(e, node.id)}
        >
          ✏️
        </button>
        <button
          type="button"
          class="action-btn"
          title="新增子分类"
          onclick={(e) => handleAddChild(e, node.id)}
        >
          ➕
        </button>
        <button
          type="button"
          class="action-btn action-danger"
          title="删除"
          onclick={(e) => handleDelete(e, node.id)}
        >
          🗑
        </button>
      </div>
    </div>
    {#if hasChildren && isExpanded}
      <div class="node-children" role="group">
        {#each node.children as child (child.id)}
          {@render renderNode(child, depth + 1)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .category-tree {
    font-size: 13px;
    user-select: none;
  }
  .empty-tree {
    padding: 16px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    font-size: 12px;
  }
  .tree-node {
    display: flex;
    flex-direction: column;
  }
  .node-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .node-row:hover {
    background: var(--color-gray-100, #f1f5f9);
  }
  .node-row.selected {
    background: #dbeafe;
    color: var(--color-primary, #2563eb);
    font-weight: 600;
  }
  .toggle-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 10px;
    width: 14px;
    color: var(--color-text-secondary, #64748b);
    padding: 0;
  }
  .toggle-placeholder {
    width: 14px;
    display: inline-block;
  }
  .node-icon {
    font-size: 12px;
  }
  .node-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .node-count {
    font-size: 10px;
    color: var(--color-text-secondary, #64748b);
    background: var(--color-gray-100, #f1f5f9);
    padding: 1px 6px;
    border-radius: 8px;
    min-width: 18px;
    text-align: center;
  }
  .node-row.selected .node-count {
    background: rgba(37, 99, 235, 0.15);
    color: var(--color-primary, #2563eb);
  }
  .node-actions {
    display: none;
    gap: 2px;
  }
  .node-row:hover .node-actions {
    display: inline-flex;
  }
  .action-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .action-btn:hover {
    background: var(--color-gray-200, #e2e8f0);
  }
  .action-danger:hover {
    background: var(--color-error-bg, #fef2f2);
  }
  .node-children {
    display: flex;
    flex-direction: column;
  }
</style>
