<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务表单 schema 选择器(v0 新增,决策 §3.10)
    - 按 industry + businessObject 筛选可用 schema
    - 下拉展示 schema.scenario
    - 选中后通过 bind:selectedId 双向绑定
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §6.1 + §3.10
-->

<script lang="ts">
  import type { BusinessFormSchema } from "$lib/stores/business-form-schema";

  let {
    schemas,
    selectedId = $bindable(),
    disabled = false,
  }: {
    schemas: BusinessFormSchema[];
    selectedId: string | null;
    disabled?: boolean;
  } = $props();

  function handleChange(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    selectedId = v || null;
  }
</script>

<div class="schema-selector">
  <label for="schema-select">业务场景</label>
  <select
    id="schema-select"
    {disabled}
    value={selectedId ?? ""}
    onchange={handleChange}
  >
    {#if schemas.length === 0}
      <option value="">(无可用场景)</option>
    {:else}
      <option value="">请选择业务场景...</option>
      {#each schemas as schema (schema.id)}
        <option value={schema.id}>{schema.scenario}</option>
      {/each}
    {/if}
  </select>
  {#if schemas.length === 0}
    <small class="hint">当前行业/业务对象下无内置场景,可直接在下方填表或切到 LLM 辅助</small>
  {/if}
</div>

<style>
  .schema-selector {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  label {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  select {
    padding: 8px 10px;
    border: 1px solid var(--color-gray-300, #cbd5e1);
    border-radius: 6px;
    font-size: 14px;
    background: var(--bg-card);
    cursor: pointer;
  }
  select:disabled {
    background: var(--color-gray-100, #f1f5f9);
    cursor: not-allowed;
  }
  .hint {
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
  }
</style>
