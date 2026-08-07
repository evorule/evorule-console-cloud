<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:标签管理主视图(P03,设计 §6.1)
    - 顶部工具栏:标题 + [新建标签] + 搜索
    - TagList:标签卡片(颜色 + 名称 + 关联规则数)
    - TagEditor:编辑/新建(名称 + 颜色)
  关联设计:P03_DATASET_DESIGN.md §6.1 + §4.2 + §5.3
-->

<script lang="ts">
  import { tagStore } from "$lib/stores/tag";
  import { createTag, updateTag, deleteTag } from "$lib/stores/tag";
  import { getRulesOfTag } from "$lib/stores/rule-tag";
  import { pushToast } from "$lib/stores/toast";
  import EmptyState from "$lib/views/Feedback/EmptyState.svelte";

  type EditorMode = "hidden" | "new" | "edit";

  let editorMode = $state<EditorMode>("hidden");
  let editingId = $state<string | null>(null);
  let editorName = $state("");
  let editorColor = $state("#6b7280");
  let searchQuery = $state("");

  const visibleTags = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return $tagStore;
    return $tagStore.filter((t) => t.name.toLowerCase().includes(q));
  });

  function openNew(): void {
    editorMode = "new";
    editingId = null;
    editorName = "";
    editorColor = "#6b7280";
  }

  function openEdit(id: string): void {
    const tag = $tagStore.find((t) => t.id === id);
    if (!tag) return;
    editorMode = "edit";
    editingId = id;
    editorName = tag.name;
    editorColor = tag.color;
  }

  function closeEditor(): void {
    editorMode = "hidden";
    editingId = null;
  }

  function handleSave(): void {
    if (!editorName.trim()) {
      pushToast("标签名不能为空", "error");
      return;
    }
    if (editorMode === "new") {
      const id = createTag(editorName.trim(), editorColor);
      pushToast(`标签 "${editorName.trim()}" 已创建`, "success");
      closeEditor();
    } else if (editorMode === "edit" && editingId) {
      updateTag(editingId, { name: editorName.trim(), color: editorColor });
      pushToast("标签已更新", "success");
      closeEditor();
    }
  }

  function handleDelete(id: string): void {
    const tag = $tagStore.find((t) => t.id === id);
    if (!tag) return;
    const ruleCount = getRulesOfTag(id).length;
    const msg =
      ruleCount > 0
        ? `确认删除标签 "${tag.name}"?该标签关联了 ${ruleCount} 条规则,删除后将解除所有关联。`
        : `确认删除标签 "${tag.name}"?`;
    if (confirm(msg)) {
      deleteTag(id);
      pushToast(`标签 "${tag.name}" 已删除`, "info");
      if (editingId === id) closeEditor();
    }
  }
</script>

<div class="tag-manager">
  <div class="toolbar">
    <div class="toolbar-left">
      <h2>🏷 标签管理</h2>
      <span class="count">{$tagStore.length} 个标签</span>
    </div>
    <div class="toolbar-right">
      <input
        type="search"
        class="search-input"
        placeholder="搜索标签..."
        bind:value={searchQuery}
      />
      <button type="button" class="btn btn-primary" onclick={openNew}>
        + 新建标签
      </button>
    </div>
  </div>

  <div class="tag-content">
    {#if $tagStore.length === 0}
      <EmptyState
        type="no_data"
        noun="标签"
        description="标签用于横向特征标注(紧急/高风险/需审批),一条规则可有多个标签"
        ctaLabel="创建第一个标签"
        ctaAction={openNew}
      />
    {:else if visibleTags.length === 0}
      <div class="no-match">
        <p>没有匹配的标签</p>
        <button type="button" class="btn" onclick={() => (searchQuery = "")}>
          清除搜索
        </button>
      </div>
    {:else}
      <div class="tag-grid">
        {#each visibleTags as tag (tag.id)}
          {@const ruleCount = getRulesOfTag(tag.id).length}
          <div class="tag-card" style="border-left-color: {tag.color}">
            <div class="card-head">
              <span class="dot" style="background: {tag.color}"></span>
              <span class="name">{tag.name}</span>
            </div>
            <div class="card-meta">
              <span class="meta-item" title="关联规则数">📋 {ruleCount} 条规则</span>
            </div>
            <div class="card-actions">
              <button type="button" class="btn btn-sm" onclick={() => openEdit(tag.id)}>
                ✏️ 编辑
              </button>
              <button
                type="button"
                class="btn btn-sm btn-danger"
                onclick={() => handleDelete(tag.id)}
              >
                🗑 删除
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if editorMode !== "hidden"}
    <div class="editor-modal" role="dialog" aria-modal="true">
      <div class="modal-card">
        <header class="modal-header">
          <h3>{editorMode === "new" ? "新建标签" : "编辑标签"}</h3>
          <button type="button" class="btn-close" onclick={closeEditor}>✕</button>
        </header>
        <div class="modal-body">
          <label class="form-label">
            标签名
            <input
              type="text"
              class="form-input"
              placeholder="如:紧急"
              bind:value={editorName}
            />
          </label>
          <label class="form-label">
            颜色
            <div class="color-row">
              <input type="color" class="color-picker" bind:value={editorColor} />
              <input type="text" class="color-text" bind:value={editorColor} />
              <div class="color-preview" style="background: {editorColor}"></div>
            </div>
          </label>
          <div class="preset-colors">
            <span class="preset-label">预设:</span>
            {#each ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280"] as c (c)}
              <button
                type="button"
                class="preset-dot"
                style="background: {c}"
                class:active={editorColor.toLowerCase() === c.toLowerCase()}
                onclick={() => (editorColor = c)}
                aria-label={`选择颜色 ${c}`}
              ></button>
            {/each}
          </div>
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn" onclick={closeEditor}>取消</button>
          <button type="button" class="btn btn-primary" onclick={handleSave}>
            保存
          </button>
        </footer>
      </div>
    </div>
  {/if}
</div>

<style>
  .tag-manager {
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
    color: var(--color-gray-500, #6b7280);
  }
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .search-input {
    font-size: 13px;
    padding: 5px 10px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    background: white;
  }
  .btn {
    font-size: 13px;
    padding: 5px 12px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    background: white;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .btn-sm {
    font-size: 11px;
    padding: 3px 8px;
  }
  .btn-danger {
    color: var(--color-error, #dc2626);
    border-color: var(--color-error-bg, #fecaca);
  }
  .btn-danger:hover {
    background: var(--color-error-bg, #fef2f2);
  }
  .no-match {
    text-align: center;
    padding: 32px;
    color: var(--color-gray-500, #6b7280);
  }
  .no-match p {
    margin-bottom: 8px;
  }
  .tag-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .tag-card {
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-left-width: 4px;
    border-radius: 6px;
    padding: 10px 12px;
    background: white;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .name {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .card-meta {
    margin-bottom: 8px;
  }
  .meta-item {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .card-actions {
    display: flex;
    gap: 4px;
  }
  .editor-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .modal-card {
    background: white;
    border-radius: 8px;
    width: 90%;
    max-width: 420px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .modal-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .btn-close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--color-text-secondary, #64748b);
    padding: 0 4px;
  }
  .modal-body {
    padding: 16px;
  }
  .form-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-secondary, #64748b);
    margin-bottom: 12px;
  }
  .form-input {
    display: block;
    width: 100%;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    background: white;
    margin-top: 4px;
    box-sizing: border-box;
  }
  .color-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }
  .color-picker {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    cursor: pointer;
    background: transparent;
  }
  .color-text {
    flex: 1;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
  }
  .color-preview {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
  }
  .preset-colors {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .preset-label {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .preset-dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .preset-dot.active {
    border-color: var(--color-text-primary, #1e293b);
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--color-gray-200, #e2e8f0);
  }
</style>
