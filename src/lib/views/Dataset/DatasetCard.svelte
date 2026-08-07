<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:数据集卡片(列表项)
    - 展示名称 + 状态徽标 + 描述 + 规则数 + 标签 chips + 分类路径
    - 最后测试时间 + 发布版本
    - 操作按钮(DatasetActions,按状态显示)
  关联设计:P03_DATASET_DESIGN.md §6.2(DatasetCard)
-->

<script lang="ts">
  import type { Dataset } from "$lib/stores/dataset-types";
  import { getTag } from "$lib/stores/tag";
  import { ancestorsOf } from "$lib/stores/category";
  import StatusBadge from "$lib/views/Feedback/StatusBadge.svelte";
  import DatasetActions from "./DatasetActions.svelte";

  let {
    dataset,
    onEdit,
    onTest,
    onPublish,
    onDuplicate,
    onDelete,
    onViewRuntime,
    onMarkReady,
    onRevertDraft,
  }: {
    dataset: Dataset;
    onEdit: () => void;
    onTest: () => void;
    onPublish: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onViewRuntime: () => void;
    onMarkReady: () => void;
    onRevertDraft: () => void;
  } = $props();

  // 关联标签(响应式读取)
  const tags = $derived(
    dataset.tagIds.map((id) => getTag(id)).filter((t) => t !== undefined),
  );

  // 分类路径(祖先链,面包屑用)
  const categoryPath = $derived(
    dataset.categoryId ? ancestorsOf(dataset.categoryId).map((c) => c.name) : [],
  );

  // 规则数
  const ruleCount = $derived(dataset.ruleIds.length);
</script>

<div class="dataset-card">
  <div class="card-header">
    <span class="card-name">{dataset.name}</span>
    <StatusBadge status={dataset.status} size="sm" />
  </div>

  {#if dataset.description}
    <p class="card-desc">{dataset.description}</p>
  {/if}

  <div class="card-meta">
    <span class="meta-item" title="规则数">📋 {ruleCount} 条规则</span>
    {#if dataset.publishedVersion !== null}
      <span class="meta-item" title="发布版本">v{dataset.publishedVersion}</span>
    {/if}
    {#if dataset.lastTestedAt}
      <span class="meta-item" title="最后测试时间">
        🧪 {new Date(dataset.lastTestedAt).toLocaleDateString()}
      </span>
    {/if}
  </div>

  {#if tags.length > 0 || categoryPath.length > 0}
    <div class="card-tags">
      {#if categoryPath.length > 0}
        <span class="chip chip-category" title="分类路径">
          📂 {categoryPath.join(" / ")}
        </span>
      {/if}
      {#each tags as tag (tag.id)}
        <span class="chip" style="border-color: {tag.color}; color: {tag.color}">
          #{tag.name}
        </span>
      {/each}
    </div>
  {/if}

  <DatasetActions
    status={dataset.status}
    {onEdit}
    {onTest}
    {onPublish}
    {onDuplicate}
    {onDelete}
    {onViewRuntime}
    {onMarkReady}
    {onRevertDraft}
  />
</div>

<style>
  .dataset-card {
    padding: 14px 16px;
    background: var(--color-bg-primary, #ffffff);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    transition: box-shadow 0.15s ease;
  }
  .dataset-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .card-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .card-desc {
    font-size: 13px;
    color: var(--color-text-secondary, #64748b);
    margin: 0 0 8px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 8px;
  }
  .meta-item {
    font-size: 12px;
    color: var(--color-gray-600, #4b5563);
  }
  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }
  .chip {
    display: inline-block;
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 10px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    color: var(--color-gray-600, #4b5563);
    background: var(--color-gray-50, #f9fafb);
  }
  .chip-category {
    border-color: var(--color-info, #2563eb);
    color: var(--color-info, #2563eb);
    background: var(--color-info-bg, #f0f9ff);
  }
</style>
