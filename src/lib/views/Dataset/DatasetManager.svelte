<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:数据集管理主视图(L2 Workspace 内)
    - 顶部工具栏:标题 + [新建数据集] + 状态筛选 + 搜索
    - DatasetCard 列表(按状态/搜索筛选)
    - 编辑模式:打开 DatasetEditor(新建 or 编辑)
  关联设计:P03_DATASET_DESIGN.md §6.1 + §6.2 + §8.5
-->

<script lang="ts">
  import { datasetStore } from "$lib/stores/dataset";
  import type { DatasetStatus } from "$lib/stores/dataset-types";
  import {
    deleteDataset,
    duplicateDataset,
    startTesting,
    markReady,
    revertToDraft,
    publishDataset,
  } from "$lib/stores/dataset";
  import { pushToast } from "$lib/stores/toast";
  import DatasetCard from "./DatasetCard.svelte";
  import DatasetEditor from "./DatasetEditor.svelte";
  import EmptyState from "$lib/views/Feedback/EmptyState.svelte";

  type StatusFilter = "all" | DatasetStatus;

  let showEditor = $state(false);
  let editingId = $state<string | null>(null);
  let statusFilter = $state<StatusFilter>("all");
  let searchQuery = $state("");

  // 筛选后的数据集
  const visibleDatasets = $derived.by(() => {
    let result = $datasetStore;
    if (statusFilter !== "all") {
      result = result.filter((ds) => ds.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (ds) =>
          ds.name.toLowerCase().includes(q) ||
          ds.description.toLowerCase().includes(q),
      );
    }
    return result;
  });

  const isEmpty = $derived($datasetStore.length === 0);

  function handleNew(): void {
    editingId = null;
    showEditor = true;
  }

  function handleEdit(id: string): void {
    editingId = id;
    showEditor = true;
  }

  function handleCloseEditor(): void {
    showEditor = false;
    editingId = null;
  }

  function handleTest(id: string): void {
    startTesting(id);
    pushToast("数据集已进入测试状态,可在沙盒中运行", "info");
  }

  function handleMarkReady(id: string): void {
    markReady(id);
    pushToast("数据集已标记为就绪,可发布到生产环境", "success");
  }

  function handlePublish(id: string): void {
    // P0 简化:直接发布(权限校验在调用方/上层)
    // publishDataset 需要版本号,这里用时间戳派生单调版本
    publishDataset(id, Math.floor(Date.now() / 1000));
    pushToast("数据集已发布到生产环境", "success");
  }

  function handleDuplicate(id: string): void {
    duplicateDataset(id);
    pushToast("数据集已复制(状态回退到草稿)", "info");
  }

  function handleDelete(id: string): void {
    if (confirm("确认删除该数据集?此操作不可撤销。")) {
      deleteDataset(id);
      pushToast("数据集已删除", "info");
    }
  }

  function handleRevertDraft(id: string): void {
    revertToDraft(id);
    pushToast("数据集已回退到草稿状态", "info");
  }

  function handleViewRuntime(): void {
    pushToast("跳转 L1 监控大屏(P05 待集成)", "info");
  }
</script>

<div class="dataset-manager">
  <div class="toolbar">
    <div class="toolbar-left">
      <h2>📦 数据集管理</h2>
      <span class="count">{$datasetStore.length} 个数据集</span>
    </div>
    <div class="toolbar-right">
      <input
        type="search"
        class="search-input"
        placeholder="搜索数据集..."
        bind:value={searchQuery}
      />
      <select class="status-select" bind:value={statusFilter}>
        <option value="all">全部状态</option>
        <option value="draft">草稿</option>
        <option value="testing">测试中</option>
        <option value="ready">就绪</option>
        <option value="published">已发布</option>
      </select>
      <button type="button" class="btn btn-primary" onclick={handleNew}>
        + 新建数据集
      </button>
    </div>
  </div>

  <div class="dataset-list">
    {#if isEmpty}
      <EmptyState
        type="no_data"
        noun="数据集"
        description="从规则库选择规则组合成可运行集"
        ctaLabel="创建第一个数据集"
        ctaAction={handleNew}
      />
    {:else if visibleDatasets.length === 0}
      <div class="no-match">
        <p>没有匹配的数据集</p>
        <button
          type="button"
          class="btn"
          onclick={() => {
            statusFilter = "all";
            searchQuery = "";
          }}
        >
          清除筛选
        </button>
      </div>
    {:else}
      {#each visibleDatasets as ds (ds.id)}
        <DatasetCard
          dataset={ds}
          onEdit={() => handleEdit(ds.id)}
          onTest={() => handleTest(ds.id)}
          onPublish={() => handlePublish(ds.id)}
          onDuplicate={() => handleDuplicate(ds.id)}
          onDelete={() => handleDelete(ds.id)}
          onViewRuntime={() => handleViewRuntime()}
          onMarkReady={() => handleMarkReady(ds.id)}
          onRevertDraft={() => handleRevertDraft(ds.id)}
        />
      {/each}
    {/if}
  </div>
</div>

{#if showEditor}
  <DatasetEditor datasetId={editingId} onClose={handleCloseEditor} />
{/if}

<style>
  .dataset-manager {
    padding: 16px;
    max-width: 960px;
    margin: 0 auto;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .toolbar-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .toolbar-left h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }
  .count {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .search-input,
  .status-select {
    font-size: 13px;
    padding: 5px 10px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 4px;
    background: var(--bg-page, #ffffff);
  }
  .btn {
    font-size: 13px;
    padding: 5px 12px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 4px;
    background: var(--bg-page, #ffffff);
    cursor: pointer;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: #ffffff;
  }
  .btn-primary:hover {
    background: var(--brand-hover, var(--brand, #1d4ed8));
  }
  .dataset-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .no-match {
    text-align: center;
    padding: 32px;
    color: var(--text-secondary, #6b7280);
  }
  .no-match p {
    margin-bottom: 8px;
  }
</style>
