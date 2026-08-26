<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:数据集编辑器(P03 主视图子组件,设计 §6.2)
    - 模式:新建(datasetId=null)/ 编辑(datasetId 非 null)
    - 三个区域:基本信息(名称/描述/标签/分类) + RulePicker + ParamOverrideEditor + DatasetPreview
    - 保存:createDataset 或 updateDataset
    - 取消:onClose
  关联设计:P03_DATASET_DESIGN.md §6.2 + §7.1(创建数据集流)
-->

<script lang="ts">
  import { getAllRules } from "@evorule/console";
  import type { Rule } from "@evorule/console";
  import {
    createDataset,
    updateDataset,
    getDataset,
  } from "$lib/stores/dataset";
  import type { DatasetParamOverride } from "$lib/stores/dataset-types";
  import { tagStore, createTag } from "$lib/stores/tag";
  import { categoryTree } from "$lib/stores/category";
  import type { CategoryNode } from "$lib/stores/category";
  import { pushToast } from "$lib/stores/toast";
  import type { JsonPatch } from "$lib/types/json-patch";
  import RulePicker from "./RulePicker.svelte";
  import ParamOverrideEditor from "./ParamOverrideEditor.svelte";
  import DatasetPreview from "./DatasetPreview.svelte";

  interface Props {
    /** null = 新建模式;非 null = 编辑模式 */
    datasetId: string | null;
    onClose: () => void;
    onSaved?: (id: string) => void;
  }

  let { datasetId, onClose, onSaved }: Props = $props();

  const isNew = $derived(datasetId === null);

  // === 基本信息态 ===
  let name = $state("");
  let description = $state("");
  let selectedTagIds = $state<string[]>([]);
  let selectedCategoryId = $state<string | null>(null);

  // === 规则选择态 ===
  let selectedRuleIds = $state<string[]>([]);

  // === 参数覆盖态 ===
  let paramOverrides = $state<DatasetParamOverride[]>([]);
  let editingOverrideRuleId = $state<string | null>(null);

  // === 新建标签的输入态 ===
  let showNewTagForm = $state(false);
  let newTagName = $state("");
  let newTagColor = $state("#6b7280");

  // 初始化(编辑模式预填)
  const existing = $derived(datasetId ? getDataset(datasetId) : undefined);

  $effect(() => {
    if (existing) {
      name = existing.name;
      description = existing.description;
      selectedTagIds = [...existing.tagIds];
      selectedCategoryId = existing.categoryId;
      selectedRuleIds = [...existing.ruleIds];
      paramOverrides = existing.paramOverrides.map((p) => ({ ...p }));
    }
  });

  // === 当前编辑参数覆盖的规则 ===
  const editingRule = $derived.by<Rule | undefined>(() => {
    if (!editingOverrideRuleId) return undefined;
    return getAllRules().find((r) => r.id === editingOverrideRuleId);
  });

  const editingPatch = $derived.by<JsonPatch[]>(() => {
    if (!editingOverrideRuleId) return [];
    return (
      paramOverrides.find((p) => p.ruleId === editingOverrideRuleId)?.patch ?? []
    );
  });

  // === 预览用的 Dataset 对象 ===
  const previewDataset = $derived({
    id: datasetId ?? "__preview__",
    name,
    description,
    ruleIds: selectedRuleIds,
    paramOverrides,
    tagIds: selectedTagIds,
    categoryId: selectedCategoryId,
    status: "draft" as const,
    workspaceId: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastTestedAt: null,
    publishedVersion: null,
  });

  // === 处理函数 ===
  function toggleRuleSelect(ruleId: string): void {
    if (selectedRuleIds.includes(ruleId)) {
      selectedRuleIds = selectedRuleIds.filter((r) => r !== ruleId);
      // 同时移除该规则的参数覆盖
      paramOverrides = paramOverrides.filter((p) => p.ruleId !== ruleId);
      if (editingOverrideRuleId === ruleId) {
        editingOverrideRuleId = null;
      }
    } else {
      selectedRuleIds = [...selectedRuleIds, ruleId];
    }
  }

  function editOverride(ruleId: string): void {
    editingOverrideRuleId = editingOverrideRuleId === ruleId ? null : ruleId;
  }

  function handlePatchChange(patch: JsonPatch[]): void {
    if (!editingOverrideRuleId) return;
    const exists = paramOverrides.some(
      (p) => p.ruleId === editingOverrideRuleId,
    );
    if (exists) {
      paramOverrides = paramOverrides.map((p) =>
        p.ruleId === editingOverrideRuleId ? { ...p, patch } : p,
      );
    } else {
      paramOverrides = [
        ...paramOverrides,
        { ruleId: editingOverrideRuleId, patch },
      ];
    }
  }

  function toggleTag(id: string): void {
    if (selectedTagIds.includes(id)) {
      selectedTagIds = selectedTagIds.filter((t) => t !== id);
    } else {
      selectedTagIds = [...selectedTagIds, id];
    }
  }

  function handleCreateTag(): void {
    if (!newTagName.trim()) return;
    const id = createTag(newTagName.trim(), newTagColor);
    selectedTagIds = [...selectedTagIds, id];
    newTagName = "";
    newTagColor = "#6b7280";
    showNewTagForm = false;
    pushToast("标签已创建", "success");
  }

  function handleSave(): void {
    if (!name.trim()) {
      pushToast("数据集名称不能为空", "error");
      return;
    }
    if (selectedRuleIds.length === 0) {
      pushToast("至少选择 1 条规则", "warning");
      return;
    }

    // 过滤掉未选规则的参数覆盖
    const validOverrides = paramOverrides.filter((p) =>
      selectedRuleIds.includes(p.ruleId),
    );

    if (isNew) {
      const id = createDataset(
        name.trim(),
        description.trim(),
        selectedRuleIds,
        selectedTagIds,
        selectedCategoryId,
      );
      // 新建后,若有参数覆盖,需要 update
      if (validOverrides.length > 0) {
        updateDataset(id, { paramOverrides: validOverrides });
      }
      pushToast("数据集已创建", "success");
      onSaved?.(id);
    } else if (datasetId) {
      updateDataset(datasetId, {
        name: name.trim(),
        description: description.trim(),
        ruleIds: selectedRuleIds,
        paramOverrides: validOverrides,
        tagIds: selectedTagIds,
        categoryId: selectedCategoryId,
      });
      pushToast("数据集已保存", "success");
      onSaved?.(datasetId);
    }
    onClose();
  }

  function handleCancel(): void {
    onClose();
  }
</script>

<div class="dataset-editor">
  <header class="editor-header">
    <h2>{isNew ? "➕ 新建数据集" : "✏️ 编辑数据集"}</h2>
    <div class="header-actions">
      <button type="button" class="btn" onclick={handleCancel}>取消</button>
      <button type="button" class="btn btn-primary" onclick={handleSave}>
        💾 保存
      </button>
    </div>
  </header>

  <div class="editor-body">
    <!-- 1. 基本信息 -->
    <section class="section basic-info">
      <h3>基本信息</h3>
      <div class="form-row">
        <label class="form-label">
          名称 <span class="required">*</span>
          <input
            type="text"
            class="form-input"
            placeholder="如:心内科核心规则集 v1"
            bind:value={name}
          />
        </label>
      </div>
      <div class="form-row">
        <label class="form-label">
          描述
          <textarea
            class="form-textarea"
            rows="2"
            placeholder="数据集用途说明"
            bind:value={description}
          ></textarea>
        </label>
      </div>

      <div class="form-row">
        <div class="form-label">
          标签
          <div class="tag-picker">
            {#each $tagStore as tag (tag.id)}
              <label
                class="tag-chip"
                style="border-color: {tag.color}"
                class:selected={selectedTagIds.includes(tag.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedTagIds.includes(tag.id)}
                  onchange={() => toggleTag(tag.id)}
                />
                <span class="dot" style="background: {tag.color}"></span>
                <span>{tag.name}</span>
              </label>
            {/each}
            {#if !showNewTagForm}
              <button
                type="button"
                class="btn-add-tag"
                onclick={() => (showNewTagForm = true)}
              >
                + 新标签
              </button>
            {:else}
              <div class="new-tag-form">
                <input
                  type="text"
                  class="new-tag-name"
                  placeholder="标签名"
                  bind:value={newTagName}
                />
                <input
                  type="color"
                  class="new-tag-color"
                  bind:value={newTagColor}
                />
                <button type="button" class="btn btn-primary btn-sm" onclick={handleCreateTag}>
                  确定
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  onclick={() => (showNewTagForm = false)}
                >
                  取消
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <div class="form-row">
        <label class="form-label">
          分类
          <select class="form-select" bind:value={selectedCategoryId}>
            <option value={null}>未分类</option>
            {@render renderCategoryOptions($categoryTree, 0)}
          </select>
        </label>
      </div>
    </section>

    <!-- 2. 规则选择 -->
    <section class="section">
      <h3>规则选择 <span class="section-hint">已选 {selectedRuleIds.length} 条</span></h3>
      <RulePicker
        selectedIds={selectedRuleIds}
        onToggleSelect={toggleRuleSelect}
        onEditOverride={editOverride}
        editingOverrideId={editingOverrideRuleId}
      />
    </section>

    <!-- 3. 参数覆盖(条件渲染) -->
    {#if editingRule}
      <section class="section">
        <h3>参数覆盖</h3>
        <ParamOverrideEditor
          rule={editingRule}
          patch={editingPatch}
          onChange={handlePatchChange}
        />
      </section>
    {:else}
      <section class="section param-hint">
        <h3>参数覆盖</h3>
        <div class="hint-box">
          从右侧"已选规则"列表点击规则项,可编辑该规则的参数覆盖(JSON Patch)。
        </div>
      </section>
    {/if}

    <!-- 4. 运行前检查 -->
    <section class="section">
      <h3>运行前检查</h3>
      <DatasetPreview dataset={previewDataset} />
    </section>
  </div>
</div>

{#snippet renderCategoryOptions(nodes: CategoryNode[], depth: number)}
  {#each nodes as node (node.id)}
    <option value={node.id}>
      {"　".repeat(depth)}{node.icon ?? ""} {node.name}
    </option>
    {@render renderCategoryOptions(node.children, depth + 1)}
  {/each}
{/snippet}

<style>
  .dataset-editor {
    position: fixed;
    inset: 0;
    background: var(--bg-card);
    z-index: 100;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
    background: var(--color-gray-50, #f8fafc);
    flex-shrink: 0;
  }
  .editor-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .header-actions {
    display: flex;
    gap: 8px;
  }
  .btn {
    font-size: 13px;
    padding: 6px 14px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    background: var(--bg-card);
    border-radius: 4px;
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
  .editor-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    max-width: 1100px;
    width: 100%;
    margin: 0 auto;
  }
  .section {
    margin-bottom: 24px;
  }
  .section h3 {
    margin: 0 0 10px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .section-hint {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
    font-weight: 400;
  }
  .form-row {
    margin-bottom: 12px;
  }
  .form-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-secondary, #64748b);
    margin-bottom: 4px;
  }
  .required {
    color: var(--color-error, #dc2626);
  }
  .form-input,
  .form-textarea,
  .form-select {
    display: block;
    width: 100%;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--color-text-primary, #1e293b);
    margin-top: 4px;
    font-family: inherit;
  }
  .form-textarea {
    resize: vertical;
    min-height: 40px;
  }
  .tag-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin-top: 4px;
  }
  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 3px 8px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 12px;
    cursor: pointer;
    background: var(--bg-card);
  }
  .tag-chip.selected {
    background: var(--color-gray-100, #f1f5f9);
  }
  .tag-chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .tag-chip input {
    margin: 0;
  }
  .btn-add-tag {
    font-size: 11px;
    padding: 3px 8px;
    border: 1px dashed var(--color-gray-400, #94a3b8);
    background: transparent;
    border-radius: 12px;
    cursor: pointer;
    color: var(--color-text-secondary, #64748b);
  }
  .new-tag-form {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .new-tag-name {
    font-size: 11px;
    padding: 3px 6px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 3px;
    width: 80px;
  }
  .new-tag-color {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
  }
  .param-hint .hint-box {
    padding: 16px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 6px;
    color: var(--color-text-secondary, #64748b);
    font-size: 12px;
    text-align: center;
  }
</style>
