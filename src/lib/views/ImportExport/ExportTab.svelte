<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 导出 Tab
    - 4 类对象选择
    - 对象多选(规则/数据集/表单)
    - 6 格式选择(JSON/YAML/TOML/CSV/XML/PDF)
    - 批量导出按钮(BatchExportDialog)
    - 单条导出按钮
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §9.1
-->

<script lang="ts">
  import {
    OBJECT_TYPE_LABELS,
    type ObjectType,
  } from "$lib/stores/import-export-types";
  import {
    ALL_FORMATS,
    FORMAT_LABELS,
    type UniversalFormat,
  } from "$lib/stores/format-converter";
  import { exportRuleUniversal, exportRulesBatch } from "$lib/stores/rule-import-export";
  import { exportDataset } from "$lib/stores/dataset-import-export";
  import { exportFormSchema } from "$lib/stores/form-import-export";
  import { exportLibrarySchema } from "$lib/stores/library-schema-import";
  import { getAllRules } from "@evorule/console";
  import { datasetStore } from "$lib/stores/dataset";
  import { businessFormSchemaStore } from "$lib/stores/business-form-schema";
  import BatchExportDialog from "./BatchExportDialog.svelte";
  import { toastSuccess, toastError } from "$lib/stores/toast";

  interface Props {
    presetType?: ObjectType;
  }

  let { presetType }: Props = $props();

  let selectedType = $state<ObjectType>(presetType ?? "rule");
  let selectedFormat = $state<UniversalFormat>("yaml");
  let selectedIds = $state<string[]>([]);
  let exporting = $state(false);
  let showBatchDialog = $state(false);

  const objectTypes: ObjectType[] = ["rule", "dataset", "form", "library_schema"];

  // 派生:当前类型的可选对象列表
  let availableObjects = $derived.by(() => {
    if (selectedType === "rule") {
      return getAllRules().map((r) => ({ id: r.id, label: r.description ?? r.id }));
    }
    if (selectedType === "dataset") {
      return $datasetStore.map((d) => ({ id: d.id, label: d.name }));
    }
    if (selectedType === "form") {
      return $businessFormSchemaStore.map((f) => ({
        id: f.id,
        label: `${f.id}(${f.scenario})`,
      }));
    }
    return [];
  });

  function toggleId(id: string) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((x) => x !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }
  }

  function selectAll() {
    selectedIds = availableObjects.map((o) => o.id);
  }

  function selectNone() {
    selectedIds = [];
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleExportSingle() {
    if (selectedIds.length === 0) {
      toastError("请至少选择 1 个对象");
      return;
    }
    exporting = true;
    try {
      // 单条导出(取第一个)
      const id = selectedIds[0];
      let blob: Blob;
      let ext: string;
      if (selectedType === "rule") {
        blob = await exportRuleUniversal(id, selectedFormat);
      } else if (selectedType === "dataset") {
        blob = await exportDataset(id, selectedFormat);
      } else if (selectedType === "form") {
        blob = await exportFormSchema(id, selectedFormat);
      } else {
        blob = await exportLibrarySchema(selectedFormat);
      }
      ext = selectedFormat === "yaml" ? "yaml" : selectedFormat === "toml" ? "toml" : selectedFormat === "csv" ? "csv" : selectedFormat === "xml" ? "xml" : selectedFormat === "pdf" ? "html" : "json";
      downloadBlob(blob, `${selectedType}-${id}.${ext}`);
      toastSuccess(`已导出 ${OBJECT_TYPE_LABELS[selectedType]}:${id}`);
    } catch (e) {
      toastError(`导出失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      exporting = false;
    }
  }

  async function handleExportBatch() {
    if (selectedIds.length < 2) {
      toastError("批量导出至少选 2 个对象");
      return;
    }
    showBatchDialog = true;
  }

  async function confirmBatchExport(format: UniversalFormat) {
    showBatchDialog = false;
    exporting = true;
    try {
      if (selectedType === "rule") {
        const blob = await exportRulesBatch(selectedIds, format);
        downloadBlob(blob, `rules-batch-${Date.now().toString(36)}.evorule-batch.json`);
        toastSuccess(`已批量导出 ${selectedIds.length} 条规则`);
      } else {
        toastError("P0 仅支持规则批量导出,其他类型请逐条导出");
      }
    } catch (e) {
      toastError(`批量导出失败:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      exporting = false;
    }
  }
</script>

<div class="export-tab">
  <!-- 对象类型 -->
  <section class="et-section">
    <h3 class="et-sec-title">1. 选择导出对象类型</h3>
    <div class="et-type-grid">
      {#each objectTypes as t (t)}
        <button
          class="et-type-btn"
          class:active={selectedType === t}
          onclick={() => {
            selectedType = t;
            selectedIds = [];
          }}
        >
          <span class="et-type-icon">
            {t === "rule" ? "📋" : t === "dataset" ? "📊" : t === "form" ? "📝" : "📚"}
          </span>
          <span>{OBJECT_TYPE_LABELS[t]}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- 格式选择 -->
  <section class="et-section">
    <h3 class="et-sec-title">2. 选择导出格式</h3>
    <div class="et-format-grid">
      {#each ALL_FORMATS as f (f)}
        <button
          class="et-format-btn"
          class:active={selectedFormat === f}
          onclick={() => (selectedFormat = f)}
        >
          {FORMAT_LABELS[f]}
        </button>
      {/each}
    </div>
  </section>

  <!-- 对象多选 -->
  {#if selectedType !== "library_schema"}
    <section class="et-section">
      <h3 class="et-sec-title">
        3. 选择对象({availableObjects.length} 个可选,已选 {selectedIds.length})
      </h3>
      <div class="et-bulk-actions">
        <button class="et-link-btn" onclick={selectAll}>全选</button>
        <button class="et-link-btn" onclick={selectNone}>清空</button>
      </div>
      {#if availableObjects.length === 0}
        <div class="et-empty">暂无{OBJECT_TYPE_LABELS[selectedType]}可导出</div>
      {:else}
        <div class="et-object-list">
          {#each availableObjects as obj (obj.id)}
            <label class="et-object-item">
              <input
                type="checkbox"
                checked={selectedIds.includes(obj.id)}
                onchange={() => toggleId(obj.id)}
              />
              <span>{obj.label}</span>
              <code class="et-object-id">{obj.id}</code>
            </label>
          {/each}
        </div>
      {/if}
    </section>
  {:else}
    <div class="et-info">
      📚 库 Schema 导出会导出整个库的规则 + 数据集 + 表单 + 术语,无需选择对象
    </div>
  {/if}

  <!-- 操作按钮 -->
  <section class="et-actions">
    <button
      class="et-btn primary"
      disabled={selectedIds.length === 0 || exporting}
      onclick={handleExportSingle}
    >
      {exporting ? "导出中..." : "📤 导出选中"}
    </button>
    {#if selectedType === "rule" && selectedIds.length >= 2}
      <button class="et-btn secondary" disabled={exporting} onclick={handleExportBatch}>
        📦 批量导出(ZIP manifest)
      </button>
    {/if}
  </section>
</div>

<BatchExportDialog
  open={showBatchDialog}
  count={selectedIds.length}
  onConfirm={confirmBatchExport}
  onCancel={() => (showBatchDialog = false)}
/>

<style>
  .export-tab {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .et-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .et-sec-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-secondary, #4b5563);
  }
  .et-type-grid,
  .et-format-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }
  .et-format-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .et-type-btn,
  .et-format-btn {
    padding: 10px 8px;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    transition: all 0.15s;
  }
  .et-type-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .et-type-btn:hover,
  .et-format-btn:hover {
    border-color: var(--color-primary, #2563eb);
  }
  .et-type-btn.active,
  .et-format-btn.active {
    background: #eff6ff;
    border-color: var(--color-primary, #2563eb);
    color: var(--color-primary, #2563eb);
  }
  .et-type-icon {
    font-size: 18px;
  }
  .et-bulk-actions {
    display: flex;
    gap: 12px;
  }
  .et-link-btn {
    background: none;
    border: none;
    color: var(--color-primary, #2563eb);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }
  .et-empty {
    padding: 20px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    font-size: 13px;
    background: #f9fafb;
    border-radius: 6px;
  }
  .et-object-list {
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    padding: 6px;
  }
  .et-object-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }
  .et-object-item:hover {
    background: #f9fafb;
  }
  .et-object-id {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    background: #f3f4f6;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .et-info {
    padding: 12px;
    background: #eff6ff;
    border: 1px solid #93c5fd;
    border-radius: 6px;
    font-size: 12px;
    color: #1e40af;
  }
  .et-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .et-btn {
    padding: 8px 18px;
    border: 1px solid;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
  }
  .et-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .et-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .et-btn.secondary {
    background: white;
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
</style>
