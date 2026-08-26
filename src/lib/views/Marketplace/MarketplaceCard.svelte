<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 单个模板卡片
    - 显示模板名称/描述/作者/版本/下载次数/标签
    - 来源徽标(builtin/user/official)
    - 下载按钮(调用 downloadTemplate)
    - 删除按钮(仅 user 来源)
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7.2
-->

<script lang="ts">
  import {
    downloadTemplate,
    deleteTemplate,
  } from "$lib/stores/marketplace";
  import {
    OBJECT_TYPE_LABELS,
    TEMPLATE_CATEGORY_LABELS,
    type MarketTemplate,
  } from "$lib/stores/import-export-types";
  import { FORMAT_LABELS } from "$lib/stores/format-converter";
  import { toastSuccess, toastInfo } from "$lib/stores/toast";

  interface Props {
    template: MarketTemplate;
  }

  let { template }: Props = $props();

  const sourceLabels: Record<MarketTemplate["source"], string> = {
    builtin: "内置",
    user: "用户",
    official: "官方",
  };

  const sourceColors: Record<MarketTemplate["source"], string> = {
    builtin: "var(--color-info-bg, #dbeafe)",
    user: "#f3e8ff",
    official: "var(--color-success-bg, #dcfce7)",
  };

  async function handleDownload() {
    try {
      const blob = await downloadTemplate(template.id);
      // P0:下载的是模板元数据 JSON(实际内容需通过 export 接口取)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${template.id}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toastSuccess(`已下载模板:${template.name}`);
    } catch (e) {
      toastInfo(
        `下载失败:${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function handleDelete() {
    if (!confirm(`确认删除模板「${template.name}」?`)) return;
    await deleteTemplate(template.id);
    toastSuccess("模板已删除");
  }
</script>

<div class="mc-card">
  <header class="mc-header">
    <div class="mc-title-row">
      <span class="mc-type-icon">
        {template.type === "rule"
          ? "📋"
          : template.type === "dataset"
            ? "📊"
            : template.type === "form"
              ? "📝"
              : "📚"}
      </span>
      <h4 class="mc-title">{template.name}</h4>
    </div>
    <div class="mc-badges">
      <span
        class="mc-source-badge"
        style="background: {sourceColors[template.source]}"
      >
        {sourceLabels[template.source]}
      </span>
      <span class="mc-type-badge">{OBJECT_TYPE_LABELS[template.type]}</span>
    </div>
  </header>

  <p class="mc-desc">{template.description}</p>

  <div class="mc-meta">
    <span class="mc-meta-item">👤 {template.author.displayName}</span>
    <span class="mc-meta-item">🏷 v{template.version}</span>
    <span class="mc-meta-item">📥 {template.download_count}</span>
    <span class="mc-meta-item">{FORMAT_LABELS[template.format]}</span>
  </div>

  {#if template.tags.length > 0}
    <div class="mc-tags">
      {#each template.tags as tag (tag)}
        <span class="mc-tag">#{tag}</span>
      {/each}
    </div>
  {/if}

  <footer class="mc-footer">
    <span class="mc-category">
      {TEMPLATE_CATEGORY_LABELS[template.category]}
    </span>
    <div class="mc-actions">
      <button class="mc-btn primary" onclick={handleDownload}>📥 下载</button>
      {#if template.source === "user"}
        <button class="mc-btn danger" onclick={handleDelete}>🗑 删除</button>
      {/if}
    </div>
  </footer>
</div>

<style>
  .mc-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    transition: all 0.15s;
  }
  .mc-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    border-color: var(--color-gray-300, #d1d5db);
  }
  .mc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .mc-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .mc-type-icon {
    font-size: 16px;
  }
  .mc-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mc-badges {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .mc-source-badge,
  .mc-type-badge {
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 600;
  }
  .mc-type-badge {
    background: var(--color-gray-100, #f3f4f6);
    color: var(--color-text-secondary, #4b5563);
  }
  .mc-desc {
    margin: 0;
    font-size: 11px;
    color: var(--color-text-secondary, #4b5563);
    line-height: 1.4;
    min-height: 30px;
  }
  .mc-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .mc-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .mc-tag {
    padding: 1px 6px;
    background: var(--color-info-bg, #eff6ff);
    color: var(--color-info, #1e40af);
    border-radius: 8px;
    font-size: 10px;
  }
  .mc-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px dashed var(--color-gray-200, #e5e7eb);
  }
  .mc-category {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .mc-actions {
    display: flex;
    gap: 4px;
  }
  .mc-btn {
    padding: 3px 8px;
    border: 1px solid;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 10px;
    font-weight: 600;
  }
  .mc-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .mc-btn.danger {
    background: var(--bg-card);
    border-color: var(--color-error, #fca5a5);
    color: var(--color-error, #991b1b);
  }
</style>
