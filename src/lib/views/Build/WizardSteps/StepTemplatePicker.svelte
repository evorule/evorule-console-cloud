<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:建库向导步骤 1 — 选择行业模板
    - blank:空白库,用户从零开始
    - finance:财务审批模板(预填术语 + schema + builtin 规则)
    - compliance:合规审计模板
  关联设计:P01_BUILD_SCHEMA_DESIGN.md §6.1 + §8.1(状态机)
-->

<script lang="ts">
  import type { BusinessTemplate } from "$lib/data/template-finance";
  import { FINANCE_TEMPLATE, COMPLIANCE_TEMPLATE } from "$lib/views/Build/templates";

  let {
    selected,
    onSelect,
  }: {
    selected: "blank" | "finance" | "compliance" | null;
    onSelect: (id: "blank" | "finance" | "compliance") => void;
  } = $props();

  const templates: Array<{
    id: "blank" | "finance" | "compliance";
    tpl: BusinessTemplate | null;
    icon: string;
    tag: string;
  }> = [
    { id: "blank", tpl: null, icon: "📄", tag: "从零开始" },
    { id: "finance", tpl: FINANCE_TEMPLATE, icon: "💰", tag: "推荐" },
    { id: "compliance", tpl: COMPLIANCE_TEMPLATE, icon: "🛡️", tag: "推荐" },
  ];
</script>

<div class="step-template-picker">
  <h2>步骤 1:选择行业模板</h2>
  <p class="step-desc">模板会预填业务术语、表单场景和示例规则,帮助快速起步。</p>

  <div class="template-grid">
    {#each templates as t (t.id)}
      <button
        class="template-card"
        class:selected={selected === t.id}
        onclick={() => onSelect(t.id)}
      >
        <div class="card-header">
          <span class="card-icon">{t.icon}</span>
          {#if t.tpl}
            <span class="card-tag">{t.tag}</span>
          {/if}
        </div>
        <h3>{t.tpl?.displayName ?? "空白库"}</h3>
        <p class="card-desc">{t.tpl?.description ?? "不预填任何内容,完全自定义"}</p>
        {#if t.tpl}
          <ul class="card-meta">
            <li>{t.tpl.builtinRules.length} 条示例规则</li>
            <li>{t.tpl.businessTerms.length} 个业务术语</li>
            <li>{t.tpl.formSchemas.length} 个表单场景</li>
          </ul>
        {:else}
          <ul class="card-meta">
            <li>无预填内容</li>
            <li>手动配置业务对象</li>
            <li>手动创建首条规则</li>
          </ul>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .step-template-picker {
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
    margin: 0 0 8px 0;
  }

  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .template-card {
    text-align: left;
    padding: 16px;
    background: var(--bg-card);
    border: 2px solid var(--border, #e2e8f0);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
  }
  .template-card:hover {
    border-color: var(--brand, #2563eb);
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.12);
  }
  .template-card.selected {
    border-color: var(--brand, #2563eb);
    background: var(--brand-bg, #eff6ff);
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .card-icon {
    font-size: 28px;
  }
  .card-tag {
    padding: 1px 8px;
    background: var(--success-bg, #dcfce7);
    color: var(--success, #166534);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .template-card h3 {
    font-size: 15px;
    margin: 0 0 4px 0;
    color: var(--text-primary, #1e293b);
  }
  .card-desc {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
    margin: 0 0 8px 0;
    line-height: 1.4;
  }
  .card-meta {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 11px;
    color: var(--text-secondary, #64748b);
  }
  .card-meta li {
    padding: 1px 0;
  }
</style>
