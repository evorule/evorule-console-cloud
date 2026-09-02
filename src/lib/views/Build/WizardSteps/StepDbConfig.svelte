<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:建库向导步骤 2 — 配置库元数据(库名 + 业务对象)
    - 选模板后预填业务对象(可改)
    - 确认时调 onConfirm(dbName, businessObjects)
  关联设计:P01_BUILD_SCHEMA_DESIGN.md §6.1 + §8.2(状态转换矩阵)
-->

<script lang="ts">
  import type { BusinessTemplate } from "$lib/data/template-finance";

  let {
    template,
    dbName = $bindable(),
    businessObjects = $bindable(),
    onConfirm,
    onBack,
  }: {
    template: BusinessTemplate | null;
    dbName: string;
    businessObjects: string[];
    onConfirm: () => void;
    onBack: () => void;
  } = $props();

  // 模板预填
  $effect(() => {
    if (template && businessObjects.length === 0) {
      businessObjects = [...template.defaultBusinessObjects];
    }
  });

  let businessObjectInput = $state("");

  function addBusinessObject() {
    const v = businessObjectInput.trim();
    if (!v) return;
    if (businessObjects.includes(v)) {
      businessObjectInput = "";
      return;
    }
    businessObjects = [...businessObjects, v];
    businessObjectInput = "";
  }

  function removeBusinessObject(idx: number) {
    businessObjects = businessObjects.filter((_, i) => i !== idx);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addBusinessObject();
    }
  }

  const canConfirm = $derived(dbName.trim().length > 0 && businessObjects.length > 0);
</script>

<div class="step-db-config">
  <h2>步骤 2:配置库元数据</h2>
  <p class="step-desc">
    {#if template}
      基于「{template.displayName}」模板,可调整库名与业务对象。
    {:else}
      为你的库命名并添加业务对象(如:订单、用户、报销单)。
    {/if}
  </p>

  <div class="form-row">
    <label for="db-name">库名</label>
    <input
      id="db-name"
      type="text"
      bind:value={dbName}
      placeholder="例如:财务审批库"
    />
  </div>

  <div class="form-row">
    <label for="biz-obj">业务对象</label>
    <div class="biz-obj-input">
      <input
        id="biz-obj"
        type="text"
        bind:value={businessObjectInput}
        onkeydown={handleKeydown}
        placeholder="输入业务对象名,回车添加"
      />
      <button type="button" onclick={addBusinessObject}>添加</button>
    </div>
    <div class="biz-obj-list">
      {#each businessObjects as obj, idx}
        <span class="biz-obj-chip">
          {obj}
          <button
            type="button"
            class="chip-remove"
            onclick={() => removeBusinessObject(idx)}
            aria-label="移除"
          >×</button>
        </span>
      {:else}
        <span class="empty-hint">尚未添加业务对象</span>
      {/each}
    </div>
  </div>

  <div class="actions">
    <button class="btn-ghost" onclick={onBack}>上一步</button>
    <button class="btn-primary" onclick={onConfirm} disabled={!canConfirm}>
      确认并继续
    </button>
  </div>
</div>

<style>
  .step-db-config {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    font-size: 18px;
    margin: 0;
    color: var(--text-primary, #1e293b);
  }
  .step-desc {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    margin: 0;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  input {
    padding: 8px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 6px;
    font-size: 14px;
  }
  .biz-obj-input {
    display: flex;
    gap: 8px;
  }
  .biz-obj-input input {
    flex: 1;
  }
  .biz-obj-input button {
    padding: 8px 14px;
    border: 1px solid var(--border, #cbd5e1);
    background: var(--bg-card);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }

  .biz-obj-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 28px;
    align-items: center;
  }
  .biz-obj-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--info-bg, #dbeafe);
    color: var(--info, #1e40af);
    border-radius: 12px;
    font-size: 12px;
  }
  .chip-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }
  .empty-hint {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
    font-style: italic;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 12px;
  }
  .btn-primary,
  .btn-ghost {
    padding: 8px 20px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: none;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
</style>
