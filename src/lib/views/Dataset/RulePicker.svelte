<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:规则选择器(P03 数据集编辑器子组件,设计 §6.2)
    - 左侧筛选区:分类树(单选含子孙)+ 标签多选(AND/OR)+ 来源筛选 + 搜索
    - 中间规则列表:checkbox 多选,已选高亮,显示业务元数据 chips
    - 右侧已选规则列表:可移除 + 触发参数覆盖编辑
  关联设计:P03_DATASET_DESIGN.md §6.2 + §7.4(标签/分类筛选规则流)
-->

<script lang="ts">
  import { rules, isRuleReadonly } from "$lib/kernel";
  import type { Rule } from "$lib/kernel";
  import { tagStore } from "$lib/stores/tag";
  import { categoryTree } from "$lib/stores/category";
  import type { CategoryNode } from "$lib/stores/category";
  import { getTagsOfRule } from "$lib/stores/rule-tag";
  import { getCategoryOfRule } from "$lib/stores/rule-category";
  import { getCategoryAndDescendants } from "$lib/stores/category";
  import { applyFilter } from "$lib/stores/rule-filter";
  import type { RuleFilter, RuleSourceFilter } from "$lib/stores/rule-filter";
  import { getMeta } from "$lib/stores/rule-business-meta";

  interface Props {
    /** 已选规则 ID 列表(双向绑定) */
    selectedIds: string[];
    /** 选中规则时触发参数覆盖编辑回调 */
    onToggleSelect: (ruleId: string) => void;
    /** 点击已选规则项触发参数覆盖编辑 */
    onEditOverride?: (ruleId: string) => void;
    /** 当前正在编辑参数覆盖的规则 ID(高亮) */
    editingOverrideId?: string | null;
  }

  let {
    selectedIds = [],
    onToggleSelect,
    onEditOverride,
    editingOverrideId = null,
  }: Props = $props();

  // === 筛选状态 ===
  let searchQuery = $state("");
  let sourceFilter = $state<RuleSourceFilter>("all");
  let selectedTagIds = $state<string[]>([]);
  let tagMode = $state<"AND" | "OR">("OR");
  let selectedCategoryId = $state<string | null>(null);

  // === 分类树展开状态 ===
  let expandedCategories = $state<Set<string>>(new Set());

  const filter: RuleFilter = $derived({
    tagIds: selectedTagIds,
    tagMode,
    categoryId: selectedCategoryId,
    searchQuery,
    status: sourceFilter,
  });

  // 应用筛选后的规则
  const filteredRules = $derived(applyFilter($rules, filter));

  // 已选规则详情(从内核 rules store 查询)
  const selectedRules = $derived(
    selectedIds
      .map((id) => $rules.find((r) => r.id === id))
      .filter((r): r is Rule => !!r),
  );

  function toggleCategory(id: string): void {
    const next = new Set(expandedCategories);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedCategories = next;
  }

  function toggleTag(id: string): void {
    if (selectedTagIds.includes(id)) {
      selectedTagIds = selectedTagIds.filter((t) => t !== id);
    } else {
      selectedTagIds = [...selectedTagIds, id];
    }
  }

  function selectCategory(id: string | null): void {
    selectedCategoryId = selectedCategoryId === id ? null : id;
  }

  function clearFilters(): void {
    searchQuery = "";
    sourceFilter = "all";
    selectedTagIds = [];
    tagMode = "OR";
    selectedCategoryId = null;
  }

  const hasActiveFilter = $derived(
    !!searchQuery.trim() ||
      sourceFilter !== "all" ||
      selectedTagIds.length > 0 ||
      selectedCategoryId !== null,
  );
</script>

<div class="rule-picker">
  <!-- 左侧:筛选区 -->
  <aside class="picker-sidebar">
    <div class="filter-section">
      <div class="section-title">📂 分类</div>
      <div class="category-tree">
        <button
          type="button"
          class="cat-item cat-root"
          class:selected={selectedCategoryId === null}
          onclick={() => selectCategory(null)}
        >
          全部分类
        </button>
        {#each $categoryTree as node (node.id)}
          {@render renderCategory(node)}
        {/each}
      </div>
    </div>

    <div class="filter-section">
      <div class="section-title">
        🏷 标签
        {#if selectedTagIds.length > 0}
          <div class="tag-mode-toggle">
            <button
              type="button"
              class="mode-btn"
              class:active={tagMode === "OR"}
              onclick={() => (tagMode = "OR")}
            >
              OR
            </button>
            <button
              type="button"
              class="mode-btn"
              class:active={tagMode === "AND"}
              onclick={() => (tagMode = "AND")}
            >
              AND
            </button>
          </div>
        {/if}
      </div>
      <div class="tag-list">
        {#if $tagStore.length === 0}
          <div class="empty-hint">暂无标签</div>
        {:else}
          {#each $tagStore as tag (tag.id)}
            <label class="tag-chip" style="border-color: {tag.color}">
              <input
                type="checkbox"
                checked={selectedTagIds.includes(tag.id)}
                onchange={() => toggleTag(tag.id)}
              />
              <span class="dot" style="background: {tag.color}"></span>
              <span class="tag-name">{tag.name}</span>
            </label>
          {/each}
        {/if}
      </div>
    </div>
  </aside>

  <!-- 中间:规则列表 -->
  <section class="picker-main">
    <div class="main-header">
      <input
        type="search"
        class="search-input"
        placeholder="搜索规则 ID 或描述..."
        bind:value={searchQuery}
      />
      <select class="source-select" bind:value={sourceFilter}>
        <option value="all">全部来源</option>
        <option value="builtin">内置</option>
        <option value="user">用户</option>
      </select>
      {#if hasActiveFilter}
        <button type="button" class="btn-clear" onclick={clearFilters}>
          清除筛选
        </button>
      {/if}
      <span class="result-count">
        {filteredRules.length} / {$rules.length} 条
      </span>
    </div>

    <div class="rule-list">
      {#if filteredRules.length === 0}
        <div class="empty-rules">
          <p>{hasActiveFilter ? "没有匹配的规则" : "规则库为空"}</p>
        </div>
      {:else}
        {#each filteredRules as rule (rule.id)}
          {@const checked = selectedIds.includes(rule.id)}
          {@const meta = getMeta(rule.id)}
          {@const ruleTags = getTagsOfRule(rule.id)}
          {@const catId = getCategoryOfRule(rule.id)}
          <button
            type="button"
            class="rule-row"
            class:checked
            onclick={() => onToggleSelect(rule.id)}
          >
            <span class="checkbox" class:checked>{checked ? "✓" : ""}</span>
            <div class="rule-info">
              <div class="rule-desc">{rule.description}</div>
              <div class="rule-meta">
                <span class="rule-id">{rule.id}</span>
                <span class="badge badge-{isRuleReadonly(rule) ? 'builtin' : 'user'}">
                  {isRuleReadonly(rule) ? "内置" : "用户"}
                </span>
                {#if catId}
                  <span class="badge badge-cat">📂</span>
                {/if}
                {#each ruleTags as tid (tid)}
                  {@const t = $tagStore.find((x) => x.id === tid)}
                  {#if t}
                    <span class="badge badge-tag" style="color: {t.color}">
                      #{t.name}
                    </span>
                  {/if}
                {/each}
                {#if meta?.schemaId}
                  <span class="badge badge-schema">{meta.schemaId}</span>
                {/if}
              </div>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </section>

  <!-- 右侧:已选规则列表 -->
  <aside class="picker-selected">
    <div class="selected-header">
      已选规则({selectedRules.length})
    </div>
    <div class="selected-list">
      {#if selectedRules.length === 0}
        <div class="empty-selected">
          <p>从中间列表勾选规则</p>
          <p class="hint">勾选后可配置参数覆盖</p>
        </div>
      {:else}
        {#each selectedRules as rule (rule.id)}
          {@const hasOverride = false}
          <div
            class="selected-row"
            class:editing={editingOverrideId === rule.id}
          >
            <div
              class="selected-info"
              role="button"
              tabindex="0"
              onclick={() => onEditOverride?.(rule.id)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onEditOverride?.(rule.id);
                }
              }}
            >
              <div class="selected-desc">{rule.description}</div>
              <div class="selected-id">{rule.id}</div>
            </div>
            <button
              type="button"
              class="btn-remove"
              title="移除"
              onclick={() => onToggleSelect(rule.id)}
            >
              ✕
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </aside>
</div>

{#snippet renderCategory(node: CategoryNode)}
  <div class="cat-node">
    <div class="cat-row">
      {#if node.children.length > 0}
        <button
          type="button"
          class="cat-toggle"
          onclick={() => toggleCategory(node.id)}
        >
          {expandedCategories.has(node.id) ? "▼" : "▶"}
        </button>
      {:else}
        <span class="cat-toggle-placeholder"></span>
      {/if}
      {#if node.icon}{node.icon}{/if}
      <button
        type="button"
        class="cat-item"
        class:selected={selectedCategoryId === node.id}
        title="点击筛选此分类(含子分类)"
        onclick={() => selectCategory(node.id)}
      >
        {node.name}
      </button>
    </div>
    {#if node.children.length > 0 && expandedCategories.has(node.id)}
      <div class="cat-children">
        {#each node.children as child (child.id)}
          {@render renderCategory(child)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .rule-picker {
    display: grid;
    grid-template-columns: 200px 1fr 220px;
    gap: 8px;
    height: 420px;
    min-height: 0;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-card);
  }
  .picker-sidebar {
    border-right: 1px solid var(--border, #e2e8f0);
    overflow-y: auto;
    padding: 8px;
    background: var(--bg-page, #f8fafc);
  }
  .filter-section {
    margin-bottom: 16px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #64748b);
    text-transform: uppercase;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tag-mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 3px;
    overflow: hidden;
  }
  .mode-btn {
    font-size: 10px;
    padding: 1px 6px;
    border: none;
    background: var(--bg-card);
    color: var(--text-secondary, #64748b);
    cursor: pointer;
  }
  .mode-btn.active {
    background: var(--brand, #2563eb);
    color: white;
  }
  .category-tree {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cat-item {
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 3px;
    color: var(--text-primary, #1e293b);
  }
  .cat-item:hover {
    background: var(--bg-hover, #f1f5f9);
  }
  .cat-item.selected {
    background: var(--info-bg, #dbeafe);
    color: var(--brand, #2563eb);
    font-weight: 600;
  }
  .cat-root {
    font-weight: 600;
  }
  .cat-node {
    display: flex;
    flex-direction: column;
  }
  .cat-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .cat-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 10px;
    width: 14px;
    color: var(--text-secondary, #64748b);
  }
  .cat-toggle-placeholder {
    width: 14px;
  }
  .cat-children {
    margin-left: 14px;
  }
  .tag-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 2px 6px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 10px;
    cursor: pointer;
    background: var(--bg-card);
  }
  .tag-chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .tag-chip input {
    margin: 0;
  }
  .empty-hint {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    padding: 4px 0;
  }
  .picker-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .main-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border, #e2e8f0);
    background: var(--bg-page, #f8fafc);
  }
  .search-input,
  .source-select {
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 3px;
    background: var(--bg-card);
  }
  .search-input {
    flex: 1;
    min-width: 0;
  }
  .btn-clear {
    font-size: 11px;
    padding: 4px 8px;
    border: 1px solid var(--border, #cbd5e1);
    background: var(--bg-card);
    border-radius: 3px;
    cursor: pointer;
    color: var(--text-secondary, #64748b);
  }
  .result-count {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    white-space: nowrap;
  }
  .rule-list {
    flex: 1;
    overflow-y: auto;
  }
  .empty-rules {
    padding: 32px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 13px;
  }
  .rule-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--bg-hover, #f1f5f9);
    text-align: left;
    cursor: pointer;
  }
  .rule-row:hover {
    background: var(--bg-page, #f8fafc);
  }
  .rule-row.checked {
    background: var(--info-bg, #eff6ff);
  }
  .checkbox {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid var(--text-secondary, #94a3b8);
    border-radius: 3px;
    font-size: 11px;
    color: white;
    background: var(--bg-card);
    flex-shrink: 0;
    margin-top: 1px;
  }
  .checkbox.checked {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
  }
  .rule-info {
    flex: 1;
    min-width: 0;
  }
  .rule-desc {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary, #1e293b);
    margin-bottom: 3px;
    line-height: 1.3;
  }
  .rule-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .rule-id {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-secondary, #64748b);
  }
  .badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 8px;
    font-weight: 600;
  }
  .badge-builtin {
    background: var(--bg-hover, #e2e8f0);
    color: var(--text-primary, #334155);
  }
  .badge-user {
    background: var(--success-bg, #d1fae5);
    color: var(--success, #065f46);
  }
  .badge-cat {
    background: var(--bg-hover, #f1f5f9);
  }
  .badge-tag {
    background: transparent;
  }
  .badge-schema {
    background: var(--info-bg, #dbeafe);
    color: var(--info, #1e40af);
  }
  .picker-selected {
    border-left: 1px solid var(--border, #e2e8f0);
    display: flex;
    flex-direction: column;
    background: var(--bg-page, #f8fafc);
  }
  .selected-header {
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #64748b);
    text-transform: uppercase;
    border-bottom: 1px solid var(--border, #e2e8f0);
    background: var(--bg-card);
  }
  .selected-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }
  .empty-selected {
    padding: 16px 8px;
    text-align: center;
    color: var(--text-secondary, #64748b);
    font-size: 12px;
  }
  .empty-selected .hint {
    font-size: 11px;
    margin-top: 4px;
  }
  .selected-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: 4px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e2e8f0);
    margin-bottom: 4px;
  }
  .selected-row.editing {
    border-color: var(--brand, #2563eb);
    box-shadow: 0 0 0 1px var(--brand, #2563eb);
  }
  .selected-info {
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .selected-desc {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary, #1e293b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selected-id {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-secondary, #64748b);
  }
  .btn-remove {
    background: transparent;
    border: none;
    color: var(--text-secondary, #64748b);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 12px;
    border-radius: 3px;
  }
  .btn-remove:hover {
    background: var(--danger-bg, #fef2f2);
    color: var(--danger, #dc2626);
  }
  @media (max-width: 900px) {
    .rule-picker {
      grid-template-columns: 1fr;
      height: auto;
    }
    .picker-sidebar,
    .picker-selected {
      max-height: 200px;
      border: none;
      border-bottom: 1px solid var(--border, #e2e8f0);
    }
  }
</style>
