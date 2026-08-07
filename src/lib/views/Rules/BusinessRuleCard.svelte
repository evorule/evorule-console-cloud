<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务规则卡片(v0 新增,决策 §6.1)
    - 展示单条规则的业务视角(描述 + 业务场景 + 术语标签 + schema 标签)
    - 无业务元数据时降级为内核 rule-item 样式(描述 + source + version)
    - 选中高亮,点击触发 onSelect
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §6.1 + §4.3
-->

<script lang="ts">
  import type { Rule } from "@evorule/console";
  import type { RuleBusinessMeta } from "$lib/stores/rule-business-meta";
  import { getTermsByIds } from "$lib/stores/business-terms";

  let {
    rule,
    meta = null,
    selected = false,
    onSelect,
  }: {
    rule: Rule;
    meta?: RuleBusinessMeta | null;
    selected?: boolean;
    onSelect: () => void;
  } = $props();

  // 关联术语(用于 chips 展示,响应式)
  const terms = $derived(meta ? getTermsByIds(meta.businessTermIds) : []);
</script>

<button
  type="button"
  class="rule-card"
  class:selected
  class:has-meta={!!meta}
  onclick={onSelect}
>
  <div class="card-desc">{rule.description}</div>

  {#if meta}
    <div class="card-scenario">{meta.scenarioContext}</div>
    <div class="card-terms">
      {#if meta.schemaId}
        <span class="badge badge-schema" title="业务表单 schema">{meta.schemaId}</span>
      {/if}
      {#each terms as t (t.id)}
        <span class="badge badge-term" title={t.description}>{t.label}</span>
      {/each}
    </div>
  {:else}
    <div class="card-hint">无业务元数据(开发者模式可编辑 JSON)</div>
  {/if}

  <div class="card-footer">
    <span class="badge badge-{rule.source}">
      {rule.source === "builtin" ? "内置" : "用户"}
    </span>
    <span class="version">v{rule.version}</span>
  </div>
</button>

<style>
  .rule-card {
    display: block;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--color-gray-100, #f1f5f9);
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .rule-card:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .rule-card.selected {
    background: #eef2ff;
    border-left: 3px solid var(--color-primary, #2563eb);
    padding-left: 9px;
  }
  .card-desc {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
    margin-bottom: 4px;
    line-height: 1.4;
  }
  .card-scenario {
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    margin-bottom: 6px;
    line-height: 1.3;
  }
  .card-terms {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .card-hint {
    font-size: 11px;
    color: var(--color-text-secondary, #64748b);
    font-style: italic;
    margin-bottom: 4px;
  }
  .card-footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
  }
  .badge-schema {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info-text, #1e40af);
  }
  .badge-term {
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning-text, #92400e);
  }
  .badge-builtin {
    background: var(--color-gray-200, #e2e8f0);
    color: var(--color-gray-700, #334155);
  }
  .badge-user {
    background: #d1fae5;
    color: #065f46;
  }
  .version {
    font-size: 10px;
    color: var(--color-gray-500, #64748b);
  }
</style>
