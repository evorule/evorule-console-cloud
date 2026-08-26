<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 冲突处理 UI(4 策略 + 批量设置 + 逐个选择)
    - 显示冲突列表(对象 ID / 本地版本 / 导入版本)
    - 4 策略:skip/overwrite/rename/merge
    - 批量设置按钮(全部跳过/覆盖/重命名/合并)
    - 派发 resolve 事件(返回 ConflictResolution[])
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §9.2
-->

<script lang="ts">
  import {
    CONFLICT_RESOLUTION_LABELS,
    type ImportConflict,
    type ConflictResolution,
  } from "$lib/stores/import-export-types";

  interface Props {
    conflicts: ImportConflict[];
    defaultResolution: ConflictResolution;
    onresolve: (resolutions: ConflictResolution[]) => void;
  }

  let { conflicts, defaultResolution, onresolve }: Props = $props();

  // 每个冲突的策略(初始用 defaultResolution)
  let resolutions = $state<Record<string, ConflictResolution>>({});

  // 当 conflicts 变化时,重置 resolutions
  $effect(() => {
    const next: Record<string, ConflictResolution> = {};
    for (const c of conflicts) {
      next[`${c.objectType}:${c.objectId}`] = c.resolution ?? defaultResolution;
    }
    resolutions = next;
  });

  function setAll(resolution: ConflictResolution) {
    const next: Record<string, ConflictResolution> = {};
    for (const c of conflicts) {
      next[`${c.objectType}:${c.objectId}`] = resolution;
    }
    resolutions = next;
  }

  function handleResolve() {
    const result: ConflictResolution[] = conflicts.map(
      (c) => resolutions[`${c.objectType}:${c.objectId}`] ?? defaultResolution,
    );
    onresolve(result);
  }

  const resolutionOptions: ConflictResolution[] = [
    "skip",
    "overwrite",
    "rename",
    "merge",
  ];
</script>

{#if conflicts.length > 0}
  <div class="cr-panel">
    <header class="cr-header">
      <h3 class="cr-title">⚠️ 检测到 {conflicts.length} 个冲突</h3>
      <div class="cr-bulk">
        <span class="cr-bulk-label">批量设置:</span>
        {#each resolutionOptions as r (r)}
          <button class="cr-bulk-btn" onclick={() => setAll(r)}>
            {CONFLICT_RESOLUTION_LABELS[r]}
          </button>
        {/each}
      </div>
    </header>

    <table class="cr-table">
      <thead>
        <tr>
          <th>对象 ID</th>
          <th>类型</th>
          <th>本地版本</th>
          <th>导入版本</th>
          <th>处理方式</th>
        </tr>
      </thead>
      <tbody>
        {#each conflicts as c (c.objectId)}
          <tr>
            <td><code>{c.objectId}</code></td>
            <td>{c.objectType}</td>
            <td>v{c.existingVersion}</td>
            <td>v{c.importVersion}</td>
            <td>
              <select
                class="cr-select"
                value={resolutions[`${c.objectType}:${c.objectId}`] ?? defaultResolution}
                onchange={(e) => {
                  resolutions = {
                    ...resolutions,
                    [`${c.objectType}:${c.objectId}`]: (e.target as HTMLSelectElement).value as ConflictResolution,
                  };
                }}
              >
                {#each resolutionOptions as r (r)}
                  <option value={r}>{CONFLICT_RESOLUTION_LABELS[r]}</option>
                {/each}
              </select>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="cr-actions">
      <button class="cr-btn primary" onclick={handleResolve}>
        确认处理
      </button>
    </div>
  </div>
{/if}

<style>
  .cr-panel {
    background: var(--color-warning-bg, #fffbeb);
    border: 1px solid var(--color-warning, #fde68a);
    border-radius: 6px;
    padding: 12px;
    margin-top: 12px;
  }
  .cr-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .cr-title {
    margin: 0;
    font-size: 14px;
    color: var(--color-warning, #92400e);
  }
  .cr-bulk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .cr-bulk-label {
    font-size: 11px;
    color: var(--color-warning, #92400e);
  }
  .cr-bulk-btn {
    padding: 3px 8px;
    background: var(--bg-card);
    border: 1px solid var(--color-warning, #fde68a);
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    color: var(--color-warning, #92400e);
  }
  .cr-bulk-btn:hover {
    background: var(--color-warning-bg, #fef3c7);
  }
  .cr-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    background: var(--bg-card);
  }
  .cr-table th,
  .cr-table td {
    border: 1px solid var(--color-gray-200, #e5e7eb);
    padding: 6px 8px;
    text-align: left;
  }
  .cr-table th {
    background: #f9fafb;
    font-weight: 600;
  }
  .cr-select {
    padding: 3px 6px;
    border: 1px solid var(--color-gray-300, #d1d5db);
    border-radius: 3px;
    font-family: inherit;
    font-size: 11px;
  }
  .cr-actions {
    margin-top: 10px;
    text-align: right;
  }
  .cr-btn {
    padding: 6px 16px;
    border: 1px solid;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
  }
  .cr-btn.primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
</style>
