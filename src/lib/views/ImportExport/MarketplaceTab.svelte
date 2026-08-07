<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 模板市场 Tab
    - 搜索框 + 类型/分类/来源筛选
    - 模板卡片网格(MarketplaceCard)
    - 上传模板按钮(弹窗)
    - 官方规则集快速导入(RulesetImporter)
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7.2
-->

<script lang="ts">
  import {
    filteredTemplates,
    searchQuery,
    filterType,
    filterCategory,
    filterSource,
    uploadTemplate,
    resetMarketplace,
  } from "$lib/stores/marketplace";
  import {
    OBJECT_TYPE_LABELS,
    TEMPLATE_CATEGORY_LABELS,
    type ObjectType,
    type TemplateCategory,
    type TemplateSource,
  } from "$lib/stores/import-export-types";
  import MarketplaceCard from "../Marketplace/MarketplaceCard.svelte";
  import RulesetImporter from "../Marketplace/RulesetImporter.svelte";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  let showUploadDialog = $state(false);
  let showRulesetImporter = $state(false);

  // 上传表单状态
  let uploadName = $state("");
  let uploadDesc = $state("");
  let uploadType = $state<ObjectType>("rule");
  let uploadCategory = $state<TemplateCategory>("general");
  let uploadVersion = $state("1.0.0");
  let uploadFile = $state<File | null>(null);

  const typeOptions: (ObjectType | "all")[] = [
    "all",
    "rule",
    "dataset",
    "form",
    "library_schema",
  ];
  const categoryOptions: (TemplateCategory | "all")[] = [
    "all",
    "medical",
    "finance",
    "compliance",
    "general",
    "education",
    "retail",
  ];
  const sourceOptions: (TemplateSource | "all")[] = [
    "all",
    "builtin",
    "user",
    "official",
  ];

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    uploadFile = input.files?.[0] ?? null;
  }

  async function handleUpload() {
    if (!uploadName.trim() || !uploadFile) {
      toastError("请填写名称并选择文件");
      return;
    }
    const result = await uploadTemplate(
      {
        type: uploadType,
        name: uploadName,
        description: uploadDesc,
        category: uploadCategory,
        tags: [],
        author: { id: "self", displayName: "我" },
        version: uploadVersion,
        format: "json",
        content_hash: "user-upload",
        download_url: `user://${uploadFile.name}`,
      },
      uploadFile,
    );
    if (result.success) {
      toastSuccess("模板上传成功");
      showUploadDialog = false;
      uploadName = "";
      uploadDesc = "";
      uploadFile = null;
    } else {
      toastError(`上传失败:${result.error}`);
    }
  }
</script>

<div class="mt-tab">
  <!-- 搜索 + 筛选 -->
  <section class="mt-filters">
    <input
      class="mt-search"
      type="text"
      placeholder="🔍 搜索模板名称/描述/标签..."
      bind:value={$searchQuery}
    />
    <div class="mt-filter-row">
      <label class="mt-filter-label">
        类型:
        <select bind:value={$filterType}>
          {#each typeOptions as t (t)}
            <option value={t}>
              {t === "all" ? "全部" : OBJECT_TYPE_LABELS[t as ObjectType]}
            </option>
          {/each}
        </select>
      </label>
      <label class="mt-filter-label">
        分类:
        <select bind:value={$filterCategory}>
          {#each categoryOptions as c (c)}
            <option value={c}>
              {c === "all" ? "全部" : TEMPLATE_CATEGORY_LABELS[c as TemplateCategory]}
            </option>
          {/each}
        </select>
      </label>
      <label class="mt-filter-label">
        来源:
        <select bind:value={$filterSource}>
          {#each sourceOptions as s (s)}
            <option value={s}>
              {s === "all" ? "全部" : s === "builtin" ? "内置" : s === "user" ? "用户" : "官方"}
            </option>
          {/each}
        </select>
      </label>
    </div>
  </section>

  <!-- 操作栏 -->
  <div class="mt-actions">
    <span class="mt-count">共 {$filteredTemplates.length} 个模板</span>
    <div class="mt-action-buttons">
      <button class="mt-btn" onclick={() => (showRulesetImporter = true)}>
        📥 导入官方规则集
      </button>
      <button class="mt-btn primary" onclick={() => (showUploadDialog = true)}>
        ⬆️ 上传模板
      </button>
    </div>
  </div>

  <!-- 模板卡片网格 -->
  {#if $filteredTemplates.length === 0}
    <div class="mt-empty">
      📭 未找到匹配的模板
    </div>
  {:else}
    <div class="mt-grid">
      {#each $filteredTemplates as tpl (tpl.id)}
        <MarketplaceCard template={tpl} />
      {/each}
    </div>
  {/if}
</div>

<!-- 上传弹窗 -->
{#if showUploadDialog}
  <div
    class="mt-overlay"
    role="presentation"
    onclick={(e) => {
      if (e.currentTarget === e.target) showUploadDialog = false;
    }}
  >
    <div class="mt-dialog" role="dialog" aria-modal="true">
      <header class="mt-dialog-header">
        <h3>⬆️ 上传模板</h3>
        <button class="mt-close" onclick={() => (showUploadDialog = false)}>×</button>
      </header>
      <div class="mt-dialog-body">
        <label class="mt-field">
          名称:
          <input type="text" bind:value={uploadName} placeholder="如:我的报销规则" />
        </label>
        <label class="mt-field">
          描述:
          <textarea bind:value={uploadDesc} rows="2" placeholder="模板用途说明"></textarea>
        </label>
        <div class="mt-field-row">
          <label class="mt-field">
            类型:
            <select bind:value={uploadType}>
              {#each Object.entries(OBJECT_TYPE_LABELS) as [key, label] (key)}
                <option value={key}>{label}</option>
              {/each}
            </select>
          </label>
          <label class="mt-field">
            分类:
            <select bind:value={uploadCategory}>
              {#each Object.entries(TEMPLATE_CATEGORY_LABELS) as [key, label] (key)}
                <option value={key}>{label}</option>
              {/each}
            </select>
          </label>
        </div>
        <label class="mt-field">
          版本:
          <input type="text" bind:value={uploadVersion} placeholder="1.0.0" />
        </label>
        <label class="mt-field">
          文件:
          <input type="file" onchange={handleFileChange} />
        </label>
      </div>
      <footer class="mt-dialog-footer">
        <button class="mt-btn" onclick={() => (showUploadDialog = false)}>取消</button>
        <button class="mt-btn primary" onclick={handleUpload}>上传</button>
      </footer>
    </div>
  </div>
{/if}

<RulesetImporter open={showRulesetImporter} onClose={() => (showRulesetImporter = false)} />

<style>
  .mt-tab {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .mt-filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mt-search {
    padding: 8px 12px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 6px;
    font-family: inherit;
    font-size: 13px;
  }
  .mt-filter-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .mt-filter-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-text-secondary, #4b5563);
  }
  .mt-filter-label select {
    padding: 4px 8px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    font-family: inherit;
    font-size: 11px;
  }
  .mt-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mt-count {
    font-size: 12px;
    color: var(--color-gray-500, #6b7280);
  }
  .mt-action-buttons {
    display: flex;
    gap: 8px;
  }
  .mt-btn {
    padding: 6px 12px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    background: white;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-secondary, #4b5563);
  }
  .mt-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .mt-empty {
    padding: 40px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    font-size: 14px;
    background: #f9fafb;
    border-radius: 6px;
  }
  .mt-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .mt-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .mt-dialog {
    background: white;
    border-radius: 8px;
    width: 520px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
  }
  .mt-dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .mt-dialog-header h3 {
    margin: 0;
    font-size: 15px;
  }
  .mt-close {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--color-gray-500, #6b7280);
  }
  .mt-dialog-body {
    padding: 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .mt-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-secondary, #4b5563);
  }
  .mt-field input,
  .mt-field textarea,
  .mt-field select {
    padding: 6px 8px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
  }
  .mt-field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .mt-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
  }
</style>
