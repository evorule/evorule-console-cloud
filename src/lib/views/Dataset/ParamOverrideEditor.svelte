<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:参数覆盖编辑器(P03 数据集编辑器子组件,设计 §6.2 + §4.6)
    - 展示选中规则的原 JSON(只读)
    - 可视化编辑 JSON Patch 操作(replace/add/remove)
    - 实时预览应用 patch 后的规则 JSON
    - 校验 patch 路径合法性(JSON Pointer 格式)
  关联设计:P03_DATASET_DESIGN.md §4.6 + §4.7 + §8.3
-->

<script lang="ts">
  import type { Rule } from "@evorule/console";
  import type { JsonPatch, JsonPatchOp } from "$lib/types/json-patch";
  import { applyJsonPatch } from "$lib/utils/json-patch";

  interface Props {
    rule: Rule;
    patch: JsonPatch[];
    onChange: (patch: JsonPatch[]) => void;
  }

  let { rule, patch, onChange }: Props = $props();

  // === 新增 patch 行的输入态 ===
  let newOp = $state<JsonPatchOp>("replace");
  let newPath = $state("");
  let newValue = $state("");

  // === 原始规则 JSON(解析后供预览) ===
  const originalJson = $derived.by(() => {
    try {
      return JSON.parse(rule.content);
    } catch {
      return null;
    }
  });

  // === 应用 patch 后的预览 ===
  const patchedPreview = $derived.by(() => {
    if (patch.length === 0) return rule.content;
    try {
      return applyJsonPatch(rule.content, patch);
    } catch (err) {
      return `// 应用失败:${err instanceof Error ? err.message : String(err)}`;
    }
  });

  // === 校验单个 patch 路径 ===
  function validatePath(path: string): string | null {
    if (!path) return "路径不能为空";
    if (!path.startsWith("/")) return "路径必须以 / 开头(JSON Pointer 格式)";
    return null;
  }

  // === 校验整个 patch 列表(返回错误信息数组,空 = 全部合法) ===
  const patchErrors = $derived(
    patch.map((p) => ({
      index: patch.indexOf(p),
      pathError: validatePath(p.path),
      valueError:
        p.op !== "remove" && p.value === undefined
          ? `${p.op} 操作需要 value`
          : null,
    })),
  );

  const hasError = $derived(patchErrors.some((e) => e.pathError || e.valueError));

  function addPatch(): void {
    if (validatePath(newPath)) return;

    let parsedValue: unknown = newValue;
    // 尝试解析为 JSON(支持对象/数组/数字/布尔)
    if (newOp !== "remove" && newValue.trim()) {
      try {
        parsedValue = JSON.parse(newValue);
      } catch {
        // 解析失败当作字符串
        parsedValue = newValue;
      }
    }

    const entry: JsonPatch = {
      op: newOp,
      path: newPath,
      ...(newOp !== "remove" ? { value: parsedValue } : {}),
    };

    onChange([...patch, entry]);
    // 重置输入
    newPath = "";
    newValue = "";
  }

  function removePatch(index: number): void {
    onChange(patch.filter((_, i) => i !== index));
  }

  function movePatch(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= patch.length) return;
    const next = [...patch];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function clearAll(): void {
    onChange([]);
  }
</script>

<div class="param-override-editor">
  <header class="editor-header">
    <div class="title-group">
      <h3>⚙ 参数覆盖</h3>
      <span class="rule-id">{rule.id}</span>
    </div>
    {#if patch.length > 0}
      <button type="button" class="btn btn-text" onclick={clearAll}>
        清空({patch.length})
      </button>
    {/if}
  </header>

  {#if originalJson === null}
    <div class="warn-box">
      ⚠ 规则 JSON 解析失败,无法编辑参数覆盖。请先修复规则 content。
    </div>
  {:else}
    <!-- 已有 patch 列表 -->
    {#if patch.length > 0}
      <div class="patch-list">
        {#each patch as p, i (i)}
          {@const err = patchErrors[i]}
          <div class="patch-row" class:error={err.pathError || err.valueError}>
            <span class="patch-op op-{p.op}">{p.op}</span>
            <code class="patch-path">{p.path}</code>
            {#if p.op !== "remove"}
              <code class="patch-value">
                {typeof p.value === "string" ? `"${p.value}"` : JSON.stringify(p.value)}
              </code>
            {/if}
            <div class="patch-actions">
              <button
                type="button"
                class="btn-icon"
                title="上移"
                onclick={() => movePatch(i, -1)}
                disabled={i === 0}
              >
                ↑
              </button>
              <button
                type="button"
                class="btn-icon"
                title="下移"
                onclick={() => movePatch(i, 1)}
                disabled={i === patch.length - 1}
              >
                ↓
              </button>
              <button
                type="button"
                class="btn-icon btn-danger"
                title="删除"
                onclick={() => removePatch(i)}
              >
                ✕
              </button>
            </div>
            {#if err.pathError}
              <div class="patch-error">⚠ {err.pathError}</div>
            {:else if err.valueError}
              <div class="patch-error">⚠ {err.valueError}</div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-patch">
        无参数覆盖。该规则将使用原始参数运行。
      </div>
    {/if}

    <!-- 新增 patch 输入 -->
    <div class="patch-form">
      <select bind:value={newOp} class="op-select">
        <option value="replace">replace</option>
        <option value="add">add</option>
        <option value="remove">remove</option>
      </select>
      <input
        type="text"
        class="path-input"
        placeholder="/params/threshold"
        bind:value={newPath}
      />
      {#if newOp !== "remove"}
        <input
          type="text"
          class="value-input"
          placeholder='值(JSON 或字符串,如 38.5 或 "发热")'
          bind:value={newValue}
        />
      {/if}
      <button
        type="button"
        class="btn btn-primary"
        onclick={addPatch}
        disabled={!!validatePath(newPath)}
      >
        + 添加
      </button>
    </div>

    {#if hasError}
      <div class="error-banner">
        ⚠ 存在 {patchErrors.filter((e) => e.pathError || e.valueError).length} 个无效 patch,运行前请修正
      </div>
    {/if}

    <!-- 实时预览 -->
    <details class="preview-details">
      <summary>预览应用 patch 后的规则 JSON</summary>
      <pre class="json-preview">{patchedPreview}</pre>
    </details>
  {/if}
</div>

<style>
  .param-override-editor {
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 6px;
    padding: 12px;
    background: white;
  }
  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .title-group {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .title-group h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .rule-id {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
  }
  .btn {
    font-size: 12px;
    padding: 4px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    background: white;
    border-radius: 3px;
    cursor: pointer;
  }
  .btn-text {
    border: none;
    background: transparent;
    color: var(--color-text-secondary, #64748b);
    padding: 2px 6px;
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .warn-box {
    padding: 12px;
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning, #92400e);
    border-radius: 4px;
    font-size: 13px;
  }
  .patch-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .patch-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 6px;
    align-items: center;
    padding: 6px 8px;
    background: var(--color-gray-50, #f8fafc);
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 4px;
    font-size: 12px;
  }
  .patch-row.error {
    border-color: var(--color-error, #dc2626);
    background: var(--color-error-bg, #fef2f2);
  }
  .patch-op {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .op-replace {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info, #1e40af);
  }
  .op-add {
    background: var(--color-success-bg, #d1fae5);
    color: var(--color-success, #065f46);
  }
  .op-remove {
    background: var(--color-error-bg, #fee2e2);
    color: var(--color-error, #991b1b);
  }
  .patch-path {
    font-family: var(--font-mono, monospace);
    color: var(--color-text-primary, #1e293b);
  }
  .patch-value {
    font-family: var(--font-mono, monospace);
    color: var(--color-text-secondary, #64748b);
    font-size: 11px;
  }
  .patch-actions {
    display: inline-flex;
    gap: 2px;
  }
  .btn-icon {
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--color-text-secondary, #64748b);
  }
  .btn-icon:hover:not(:disabled) {
    background: var(--color-gray-100, #f1f5f9);
  }
  .btn-icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .btn-danger:hover {
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #dc2626);
  }
  .patch-error {
    grid-column: 1 / -1;
    color: var(--color-error, #dc2626);
    font-size: 11px;
  }
  .empty-patch {
    padding: 16px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    font-size: 12px;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 4px;
    margin-bottom: 12px;
  }
  .patch-form {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .op-select,
  .path-input,
  .value-input {
    font-size: 12px;
    padding: 4px 8px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 3px;
    background: white;
  }
  .path-input {
    font-family: var(--font-mono, monospace);
    flex: 1;
    min-width: 120px;
  }
  .value-input {
    font-family: var(--font-mono, monospace);
    flex: 1;
    min-width: 120px;
  }
  .error-banner {
    margin-top: 8px;
    padding: 6px 10px;
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #dc2626);
    border-radius: 4px;
    font-size: 12px;
  }
  .preview-details {
    margin-top: 12px;
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 4px;
    background: var(--color-gray-50, #f8fafc);
  }
  .preview-details summary {
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    font-weight: 500;
  }
  .json-preview {
    margin: 0;
    padding: 8px 10px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-primary, #1e293b);
    background: var(--color-gray-900, #0f172a);
    color: #e2e8f0;
    overflow-x: auto;
    max-height: 240px;
    overflow-y: auto;
  }
</style>
