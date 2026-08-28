<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:分类管理主视图(P03,设计 §6.1)
    - 顶部工具栏:标题 + [新建根分类]
    - CategoryTree:树形展示(可展开/折叠/选中)
    - CategoryEditor:编辑/新建(名称 + 父级 + 图标)
  关联设计:P03_DATASET_DESIGN.md §6.1 + §4.3 + §5.4 + §8.4
-->

<script lang="ts">
  import { categoryTree, categoryStore } from "$lib/stores/category";
  import {
    createCategory,
    updateCategory,
    deleteCategory,
    moveCategory,
    getCategory,
    getCategoryAndDescendants,
  } from "$lib/stores/category";
  import { getRulesOfCategory } from "$lib/stores/rule-category";
  import { pushToast } from "$lib/stores/toast";
  import CategoryTree from "./CategoryTree.svelte";
  import EmptyState from "$lib/views/Feedback/EmptyState.svelte";

  type EditorMode = "hidden" | "new-root" | "new-child" | "edit";

  let editorMode = $state<EditorMode>("hidden");
  let editingId = $state<string | null>(null);
  let editorParentId = $state<string | null>(null);
  let editorName = $state("");
  let editorIcon = $state("");

  const PRESET_ICONS = ["📁", "🏥", "💰", "⚖️", "🚨", "📋", "🔧", "⚙️", "💊", "🩺"];

  function openNewRoot(): void {
    editorMode = "new-root";
    editingId = null;
    editorParentId = null;
    editorName = "";
    editorIcon = "";
  }

  function openNewChild(parentId: string): void {
    editorMode = "new-child";
    editingId = null;
    editorParentId = parentId;
    editorName = "";
    editorIcon = "";
  }

  function openEdit(id: string): void {
    const cat = getCategory(id);
    if (!cat) return;
    editorMode = "edit";
    editingId = id;
    editorParentId = cat.parentId;
    editorName = cat.name;
    editorIcon = cat.icon ?? "";
  }

  function closeEditor(): void {
    editorMode = "hidden";
    editingId = null;
    editorParentId = null;
    editorName = "";
    editorIcon = "";
  }

  function handleSave(): void {
    if (!editorName.trim()) {
      pushToast("分类名不能为空", "error");
      return;
    }
    const icon = editorIcon.trim() || undefined;

    if (editorMode === "new-root") {
      const id = createCategory(editorName.trim(), null, icon);
      pushToast(`根分类 "${editorName.trim()}" 已创建`, "success");
      closeEditor();
    } else if (editorMode === "new-child" && editorParentId) {
      const id = createCategory(editorName.trim(), editorParentId, icon);
      pushToast(`子分类 "${editorName.trim()}" 已创建`, "success");
      closeEditor();
    } else if (editorMode === "edit" && editingId) {
      const cat = getCategory(editingId);
      if (cat) {
        updateCategory(editingId, {
          name: editorName.trim(),
          icon,
          parentId: editorParentId,
        });
        pushToast("分类已更新", "success");
        closeEditor();
      }
    }
  }

  function handleDelete(id: string): void {
    const cat = getCategory(id);
    if (!cat) return;
    const descendants = getCategoryAndDescendants(id);
    const totalRules = descendants.reduce(
      (sum, cid) => sum + getRulesOfCategory(cid).length,
      0,
    );
    const msg =
      descendants.length > 1 || totalRules > 0
        ? `确认删除分类 "${cat.name}"?将递归删除 ${descendants.length} 个分类(含子分类),并解除 ${totalRules} 条规则的分类关联。`
        : `确认删除分类 "${cat.name}"?`;
    if (confirm(msg)) {
      deleteCategory(id);
      pushToast(`分类 "${cat.name}" 已删除`, "info");
      if (editingId === id) closeEditor();
    }
  }

  function handleMoveToRoot(id: string): void {
    moveCategory(id, null);
    pushToast("已移到根级", "info");
  }

  // 编辑器:可选父级(排除自身及子孙,防成环)
  const availableParents = $derived.by(() => {
    if (editorMode === "new-root" || editorMode === "new-child") {
      return $categoryStore;
    }
    if (editorMode === "edit" && editingId) {
      const forbidden = new Set(getCategoryAndDescendants(editingId));
      return $categoryStore.filter((c) => !forbidden.has(c.id));
    }
    return [];
  });

  const editorTitle = $derived.by(() => {
    if (editorMode === "new-root") return "新建根分类";
    if (editorMode === "new-child") {
      const p = editorParentId ? getCategory(editorParentId) : null;
      return p ? `在 "${p.name}" 下新建子分类` : "新建子分类";
    }
    if (editorMode === "edit") return "编辑分类";
    return "";
  });
</script>

<div class="category-manager">
  <div class="toolbar">
    <div class="toolbar-left">
      <h2>📂 分类管理</h2>
      <span class="count">{$categoryStore.length} 个分类</span>
    </div>
    <div class="toolbar-right">
      <button type="button" class="btn btn-primary" onclick={openNewRoot}>
        + 新建根分类
      </button>
    </div>
  </div>

  <div class="hint-banner">
    💡 分类管"纵向归属"(诊疗 > 急诊 > 发热),一条规则只能归一个分类。
    点击节点可选中,悬停显示编辑/新增子分类/删除按钮。
  </div>

  <div class="tree-container">
    {#if $categoryStore.length === 0}
      <EmptyState
        type="no_data"
        noun="分类"
        description="分类用于树形组织规则,支持多层级嵌套"
        ctaLabel="创建第一个分类"
        ctaAction={openNewRoot}
      />
    {:else}
      <CategoryTree
        nodes={$categoryTree}
        onEdit={openEdit}
        onAddChild={openNewChild}
        onDelete={handleDelete}
      />
    {/if}
  </div>

  {#if editorMode !== "hidden"}
    <div class="editor-modal" role="dialog" aria-modal="true">
      <div class="modal-card">
        <header class="modal-header">
          <h3>{editorTitle}</h3>
          <button type="button" class="btn-close" onclick={closeEditor}>✕</button>
        </header>
        <div class="modal-body">
          <label class="form-label">
            分类名
            <input
              type="text"
              class="form-input"
              placeholder="如:急诊"
              bind:value={editorName}
            />
          </label>

          {#if editorMode === "edit"}
            <label class="form-label">
              父级分类
              <select class="form-select" bind:value={editorParentId}>
                <option value={null}>(根级分类)</option>
                {#each availableParents as c (c.id)}
                  <option value={c.id}>{c.name}</option>
                {/each}
              </select>
            </label>
          {/if}

          <label class="form-label">
            图标(可选)
            <input
              type="text"
              class="form-input"
              placeholder="emoji,如 🏥"
              bind:value={editorIcon}
            />
          </label>
          <div class="preset-icons">
            <span class="preset-label">预设:</span>
            {#each PRESET_ICONS as icon (icon)}
              <button
                type="button"
                class="preset-icon"
                class:active={editorIcon === icon}
                onclick={() => (editorIcon = icon)}
              >
                {icon}
              </button>
            {/each}
          </div>
        </div>
        <footer class="modal-footer">
          {#if editorMode === "edit" && editingId}
            <button
              type="button"
              class="btn btn-text"
              onclick={() => { if (editingId) handleMoveToRoot(editingId); }}
            >
              移到根级
            </button>
          {/if}
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
  .category-manager {
    padding: 16px;
    max-width: 960px;
    margin: 0 auto;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
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
  }
  .btn {
    font-size: 13px;
    padding: 5px 12px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 4px;
    background: var(--bg-card);
    cursor: pointer;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: white;
  }
  .btn-text {
    border: none;
    background: transparent;
    color: var(--text-secondary, #64748b);
    padding: 5px 8px;
  }
  .btn-text:hover {
    color: var(--brand, #2563eb);
  }
  .hint-banner {
    padding: 8px 12px;
    background: var(--info-bg, #f0f9ff);
    color: var(--info, #2563eb);
    border-radius: 4px;
    font-size: 12px;
    margin-bottom: 12px;
  }
  .tree-container {
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    padding: 8px;
    background: var(--bg-card);
    min-height: 200px;
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
    background: var(--bg-card);
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
    border-bottom: 1px solid var(--border, #e2e8f0);
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
    color: var(--text-secondary, #64748b);
    padding: 0 4px;
  }
  .modal-body {
    padding: 16px;
  }
  .form-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary, #64748b);
    margin-bottom: 12px;
  }
  .form-input,
  .form-select {
    display: block;
    width: 100%;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    margin-top: 4px;
    box-sizing: border-box;
  }
  .preset-icons {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .preset-label {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }
  .preset-icon {
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 16px;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .preset-icon:hover {
    background: var(--bg-hover, #f1f5f9);
  }
  .preset-icon.active {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #dbeafe);
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border, #e2e8f0);
  }
</style>
