<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:数据集操作按钮(按 status 显示不同按钮)
    - draft:    [测试] [编辑] [复制] [删除]
    - testing:  [查看测试] [标记就绪] [回草稿]
    - ready:    [发布] [编辑] [回草稿]
    - published:[查看运行时] [回草稿]
  关联设计:P03_DATASET_DESIGN.md §6.3(DatasetActions 按状态显示)
-->

<script lang="ts">
  import type { DatasetStatus } from "$lib/stores/dataset-types";

  let {
    status,
    onEdit,
    onTest,
    onPublish,
    onDuplicate,
    onDelete,
    onViewRuntime,
    onMarkReady,
    onRevertDraft,
  }: {
    status: DatasetStatus;
    onEdit: () => void;
    onTest: () => void;
    onPublish: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onViewRuntime: () => void;
    onMarkReady: () => void;
    onRevertDraft: () => void;
  } = $props();
</script>

<div class="dataset-actions">
  {#if status === "draft"}
    <button type="button" class="btn btn-primary" onclick={onTest}>🧪 测试</button>
    <button type="button" class="btn" onclick={onEdit}>✏️ 编辑</button>
    <button type="button" class="btn" onclick={onDuplicate}>📋 复制</button>
    <button type="button" class="btn btn-danger" onclick={onDelete}>🗑 删除</button>
  {:else if status === "testing"}
    <button type="button" class="btn" onclick={onViewRuntime}>👁 查看测试</button>
    <button type="button" class="btn btn-primary" onclick={onMarkReady}>✅ 标记就绪</button>
    <button type="button" class="btn" onclick={onRevertDraft}>↩ 回草稿</button>
  {:else if status === "ready"}
    <button type="button" class="btn btn-primary" onclick={onPublish}>🚀 发布</button>
    <button type="button" class="btn" onclick={onEdit}>✏️ 编辑</button>
    <button type="button" class="btn" onclick={onRevertDraft}>↩ 回草稿</button>
  {:else if status === "published"}
    <button type="button" class="btn" onclick={onViewRuntime}>📊 查看运行时</button>
    <button type="button" class="btn" onclick={onRevertDraft}>↩ 回草稿</button>
  {/if}
</div>

<style>
  .dataset-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--color-gray-100, #f1f5f9);
  }
  .btn {
    font-size: 12px;
    padding: 4px 10px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    background: var(--color-bg-primary, #ffffff);
    color: var(--color-text-primary, #1e293b);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn:hover {
    background: var(--color-gray-50, #f9fafb);
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: #ffffff;
  }
  .btn-primary:hover {
    background: var(--color-primary-dark, var(--brand, #1d4ed8));
  }
  .btn-danger {
    color: var(--color-error, #dc2626);
    border-color: var(--color-error-bg, #fecaca);
  }
  .btn-danger:hover {
    background: var(--color-error-bg, #fef2f2);
  }
</style>
