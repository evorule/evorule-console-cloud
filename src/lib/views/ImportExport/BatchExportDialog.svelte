<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 批量导出对话框(选格式 + 确认)
    - 显示选中数量
    - 格式选择(JSON/YAML/TOML,P0 批量只支持结构化格式)
    - 确认 → 调用 onConfirm(format)
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §3.4
-->

<script lang="ts">
  import {
    FORMAT_LABELS,
    type UniversalFormat,
  } from "$lib/stores/format-converter";

  interface Props {
    open: boolean;
    count: number;
    onConfirm: (format: UniversalFormat) => void;
    onCancel: () => void;
  }

  let { open, count, onConfirm, onCancel }: Props = $props();

  let selectedFormat = $state<UniversalFormat>("yaml");
  const batchFormats: UniversalFormat[] = ["json", "yaml", "toml"];

  function handleConfirm() {
    onConfirm(selectedFormat);
  }
</script>

{#if open}
  <div
    class="be-overlay"
    role="presentation"
    onclick={(e) => {
      if (e.currentTarget === e.target) onCancel();
    }}
  >
    <div class="be-dialog" role="dialog" aria-modal="true">
      <header class="be-header">
        <h3 class="be-title">📦 批量导出</h3>
        <button class="be-close" onclick={onCancel} aria-label="关闭">×</button>
      </header>

      <div class="be-body">
        <p class="be-info">
          将导出 <strong>{count}</strong> 个对象,打包为 manifest.json 单文件
          (P0 简化:不打包 ZIP,改用 JSON 包裹)。
        </p>

        <label class="be-label">
          批量格式:
          <div class="be-format-grid">
            {#each batchFormats as f (f)}
              <button
                class="be-format-btn"
                class:active={selectedFormat === f}
                onclick={() => (selectedFormat = f)}
              >
                {FORMAT_LABELS[f]}
              </button>
            {/each}
          </div>
        </label>

        <div class="be-notice">
          ℹ️ 批量导出会生成 .evorule-batch.json 文件,包含 manifest + 所有对象内容(base64 嵌入)。
        </div>
      </div>

      <footer class="be-footer">
        <button class="be-btn cancel" onclick={onCancel}>取消</button>
        <button class="be-btn primary" onclick={handleConfirm}>
          确认导出
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .be-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .be-dialog {
    background: white;
    border-radius: 8px;
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }
  .be-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .be-title {
    margin: 0;
    font-size: 15px;
    color: var(--color-text-primary, #111827);
  }
  .be-close {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: var(--color-gray-500, #6b7280);
  }
  .be-body {
    padding: 16px;
    overflow-y: auto;
  }
  .be-info {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--color-text-secondary, #4b5563);
  }
  .be-label {
    display: block;
    font-size: 12px;
    color: var(--color-text-secondary, #4b5563);
    margin-bottom: 12px;
  }
  .be-format-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: 6px;
  }
  .be-format-btn {
    padding: 8px;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
  }
  .be-format-btn.active {
    background: #eff6ff;
    border-color: var(--color-primary, #2563eb);
    color: var(--color-primary, #2563eb);
  }
  .be-notice {
    margin-top: 12px;
    padding: 8px;
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: 4px;
    font-size: 11px;
    color: #166534;
  }
  .be-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .be-btn {
    padding: 6px 14px;
    border: 1px solid;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
  }
  .be-btn.cancel {
    background: white;
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .be-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
</style>
