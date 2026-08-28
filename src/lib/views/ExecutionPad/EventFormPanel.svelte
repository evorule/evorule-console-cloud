<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:事件表单面板(左侧:模板选择 + 动态表单)
    - 模板选择:3 个内置模板卡片(医疗×2 + 财务×1)
    - 已选模板下:事件名称可编辑 + DynamicForm 渲染表单字段
  关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §6.1(布局) + §5.3(表单层)
-->

<script lang="ts">
  import { BUILTIN_TEMPLATES, getTemplate } from "$lib/stores/business-event-templates";
  import type { BusinessEventTemplate } from "$lib/stores/business-event-templates";
  import DynamicForm from "./DynamicForm.svelte";
  import type { Industry } from "$lib/stores/db";

  interface Props {
    templateId: string | null;
    onSelectTemplate: (templateId: string) => void;
    eventName: string;
    onChangeEventName: (name: string) => void;
    formData: Record<string, unknown>;
    onChangeFormData: (data: Record<string, unknown>) => void;
    industryFilter?: Industry | "all";
    disabled?: boolean;
  }

  let {
    templateId,
    onSelectTemplate,
    eventName,
    onChangeEventName,
    formData,
    onChangeFormData,
    industryFilter = "all",
    disabled = false,
  }: Props = $props();

  const visibleTemplates = $derived(
    industryFilter === "all"
      ? BUILTIN_TEMPLATES
      : BUILTIN_TEMPLATES.filter((t) => t.industry === industryFilter),
  );

  const selectedTemplate: BusinessEventTemplate | undefined = $derived(
    templateId ? getTemplate(templateId) : undefined,
  );
</script>

<div class="event-form-panel">
  <section class="section">
    <h3 class="section-title">📋 选择事件模板</h3>
    <div class="template-grid">
      {#each visibleTemplates as tpl (tpl.id)}
        <button
          type="button"
          class="template-card"
          class:selected={templateId === tpl.id}
          onclick={() => onSelectTemplate(tpl.id)}
          disabled={disabled}
        >
          <div class="template-icon">{tpl.icon}</div>
          <div class="template-body">
            <div class="template-name">{tpl.name}</div>
            <div class="template-desc">{tpl.description}</div>
          </div>
          <span class="template-industry industry-{tpl.industry}">
            {tpl.industry === "medical" ? "医疗" : "财务"}
          </span>
        </button>
      {/each}
    </div>
  </section>

  {#if selectedTemplate}
    <section class="section">
      <h3 class="section-title">
        ✍️ 填写事件数据
        <span class="section-sub">基于模板: {selectedTemplate.name}</span>
      </h3>

      <div class="event-name-row">
        <label class="name-label">
          事件名称
          <input
            type="text"
            class="name-input"
            value={eventName}
            disabled={disabled}
            oninput={(e) => onChangeEventName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>

      <DynamicForm
        fields={selectedTemplate.formSchema}
        formData={formData}
        onChange={onChangeFormData}
        disabled={disabled}
      />
    </section>
  {/if}
</div>

<style>
  .event-form-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
    overflow-y: auto;
    padding: 4px;
  }
  .section {
    padding: 12px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
  }
  .section-title {
    margin: 0 0 10px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .section-sub {
    font-size: 11px;
    font-weight: 400;
    color: var(--text-secondary, #64748b);
  }
  .template-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }
  .template-card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    background: var(--bg-card);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    font-family: inherit;
    position: relative;
  }
  .template-card:hover {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #eff6ff);
  }
  .template-card.selected {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #dbeafe);
    box-shadow: 0 0 0 1px var(--brand, #2563eb);
  }
  .template-card:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .template-icon {
    font-size: 20px;
    flex-shrink: 0;
  }
  .template-body {
    flex: 1;
    min-width: 0;
  }
  .template-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
    margin-bottom: 2px;
  }
  .template-desc {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    line-height: 1.4;
  }
  .template-industry {
    position: absolute;
    top: 6px;
    right: 6px;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    font-weight: 600;
  }
  .industry-medical {
    background: var(--success-bg, #d1fae5);
    color: var(--success, #065f46);
  }
  .industry-finance {
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
  }
  .event-name-row {
    margin-bottom: 12px;
  }
  .name-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary, #64748b);
  }
  .name-input {
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
  }
  .name-input:disabled {
    background: var(--bg-page, #f8fafc);
  }
</style>
