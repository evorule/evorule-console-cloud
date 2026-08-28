<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务预览组件(v0 新增,决策 §3.5)
    - 结构化层(本地计算):"如果 X 则 Y" + 术语高亮
    - LLM 自然语言层(可选,带缓存):explainRule 结果
    - LLM 不可用时只显示结构化层(降级)
  关联设计:P02_BUSINESS_LANGUAGE_V0_DESIGN.md §6.1 + §3.5 + §3.6
-->

<script lang="ts">
  import type { StructuredExplanation } from "$lib/stores/business-preview";

  let {
    structured,
    llmExplanation = "",
    isExplaining = false,
    fromCache = false,
    llmError = "",
  }: {
    structured: StructuredExplanation | null;
    llmExplanation?: string;
    isExplaining?: boolean;
    fromCache?: boolean;
    llmError?: string;
  } = $props();
</script>

{#if structured}
  <div class="business-preview">
    <h4 class="preview-title">📋 业务预览</h4>

    <!-- 结构化层(本地,100% 确定性) -->
    <div class="structured-layer">
      <div class="structured-line">
        <span class="keyword if">如果</span>
        <span class="content">{structured.ifPart}</span>
      </div>
      <div class="structured-line">
        <span class="keyword then">则</span>
        <span class="content">{structured.thenPart}</span>
      </div>
      {#if structured.elsePart}
        <div class="structured-line">
          <span class="keyword else">否则</span>
          <span class="content">{structured.elsePart}</span>
        </div>
      {/if}
    </div>

    <!-- 术语高亮 -->
    {#if structured.terms.length > 0}
      <div class="term-highlights">
        <span class="term-label">涉及术语:</span>
        {#each structured.terms as t (t.termId)}
          <span class="term-chip" title={t.matchedText}>{t.label}</span>
        {/each}
      </div>
    {/if}

    <!-- LLM 自然语言层(可选) -->
    <div class="llm-layer">
      {#if isExplaining}
        <div class="llm-loading">🤖 LLM 正在生成自然语言解释...</div>
      {:else if llmExplanation}
        <div class="llm-text">
          <span class="llm-badge" class:cached={fromCache}>
            {fromCache ? "🤖 LLM (缓存)" : "🤖 LLM"}
          </span>
          {llmExplanation}
        </div>
      {:else if llmError}
        <div class="llm-error">⚠ LLM 解释失败:{llmError}(仅显示结构化预览)</div>
      {/if}
    </div>
  </div>
{:else}
  <div class="business-preview empty">
    <p class="placeholder">填写表单或生成规则草案后,这里会显示业务预览</p>
  </div>
{/if}

<style>
  .business-preview {
    background: var(--bg-page, #f8fafc);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    padding: 16px;
    margin-top: 12px;
  }
  .business-preview.empty {
    text-align: center;
  }
  .preview-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: var(--text-primary, #1e293b);
  }
  .placeholder {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    margin: 0;
  }

  .structured-layer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--bg-card);
    border-radius: 6px;
    border-left: 3px solid var(--brand, #2563eb);
  }
  .structured-line {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .keyword {
    font-weight: 600;
    font-size: 13px;
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .keyword.if {
    color: var(--info, #1e40af);
    background: var(--info-bg, #dbeafe);
  }
  .keyword.then {
    color: var(--success, #166534);
    background: var(--success-bg, #dcfce7);
  }
  .keyword.else {
    color: var(--text-secondary, #64748b);
    background: var(--bg-hover, #f1f5f9);
  }
  .content {
    font-size: 14px;
    color: var(--text-primary, #1e293b);
  }

  .term-highlights {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    margin-top: 10px;
    font-size: 12px;
  }
  .term-label {
    color: var(--text-secondary, #64748b);
  }
  .term-chip {
    display: inline-block;
    padding: 1px 8px;
    background: var(--warning-bg, #fef3c7);
    color: var(--warning, #92400e);
    border-radius: 10px;
    font-size: 11px;
    cursor: help;
  }

  .llm-layer {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px dashed var(--border, #cbd5e1);
  }
  .llm-loading {
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    font-style: italic;
  }
  .llm-text {
    font-size: 13px;
    color: var(--text-primary, #1e293b);
    line-height: 1.5;
  }
  .llm-badge {
    display: inline-block;
    padding: 1px 6px;
    background: var(--brand-bg, #dbeafe);
    color: var(--brand, #2563eb);
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    margin-right: 6px;
  }
  .llm-badge.cached {
    background: var(--bg-hover, #f1f5f9);
    color: var(--text-secondary, #64748b);
  }
  .llm-error {
    font-size: 12px;
    color: var(--danger, #991b1b);
  }
</style>
