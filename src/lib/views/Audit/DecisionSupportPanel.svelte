<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:决策支持面板(P06 §6.1 + §6.2)
    - 展示 DecisionSuggestion:suggestions + risks + recommendedActions
    - 推荐操作含"回滚到 vN"时,渲染[↩ 回滚]按钮
    - 显示 LLM 模型 + 生成时间
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6.2 + §7.3
-->

<script lang="ts">
  import type { DecisionSuggestion } from "$lib/stores/decision-support";

  interface Props {
    decision: DecisionSuggestion;
    onRollback?: (targetVersion: number) => void;
    onClose?: () => void;
  }

  let { decision, onRollback, onClose }: Props = $props();

  let formattedTime = $derived.by(() => {
    try {
      return new Date(decision.generatedAt).toLocaleString("zh-CN");
    } catch {
      return decision.generatedAt;
    }
  });
</script>

<div class="decision-support-panel">
  <header class="dsp-header">
    <h3 class="title">💡 决策支持</h3>
    <div class="meta">
      <span class="meta-item">模型: {decision.model}</span>
      <span class="meta-item">{formattedTime}</span>
    </div>
    {#if onClose}
      <button class="close-btn" onclick={onClose} aria-label="关闭决策支持"
        >✕</button
      >
    {/if}
  </header>

  <div class="dsp-body">
    {#if decision.suggestions.length > 0}
      <section class="dsp-section suggestions">
        <div class="section-title">📋 决策建议</div>
        <ul class="section-list">
          {#each decision.suggestions as s, i}
            <li>{s}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if decision.risks.length > 0}
      <section class="dsp-section risks">
        <div class="section-title">⚠️ 风险提示</div>
        <ul class="section-list">
          {#each decision.risks as r}
            <li>{r}</li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if decision.recommendedActions.length > 0}
      <section class="dsp-section actions">
        <div class="section-title">🎯 推荐操作</div>
        <div class="action-list">
          {#each decision.recommendedActions as act}
            <div class="action-item">
              <span class="action-text">{act.action}</span>
              {#if act.targetVersion !== undefined && onRollback}
                <button
                  class="rollback-btn"
                  onclick={() => onRollback(act.targetVersion!)}
                >
                  ↩ 回滚到 v{act.targetVersion}
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if decision.suggestions.length === 0 && decision.risks.length === 0 && decision.recommendedActions.length === 0}
      <div class="dsp-empty">
        LLM 未返回有效建议,请尝试重新分析或调整审计段范围。
      </div>
    {/if}
  </div>
</div>

<style>
  .decision-support-panel {
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }
  .dsp-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: linear-gradient(135deg, var(--color-warning-bg, #fef3c7) 0%, var(--color-warning, #fde68a) 100%);
    border-bottom: 1px solid var(--color-warning, #fde68a);
    flex-wrap: wrap;
  }
  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-warning, #78350f);
    flex-shrink: 0;
  }
  .meta {
    display: flex;
    gap: 10px;
    font-size: 10px;
    color: var(--color-warning, #92400e);
    flex: 1;
    min-width: 0;
  }
  .meta-item {
    white-space: nowrap;
  }
  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--color-warning, #92400e);
    padding: 0 4px;
  }
  .close-btn:hover {
    color: var(--color-warning, #78350f);
  }

  .dsp-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .dsp-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-gray-700, #374151);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .section-list {
    margin: 0;
    padding-left: 20px;
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    line-height: 1.6;
  }
  .section-list li {
    margin-bottom: 2px;
  }

  .risks .section-title {
    color: var(--color-warning, #b45309);
  }
  .risks .section-list {
    color: var(--color-warning, #92400e);
  }

  .action-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .action-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--color-gray-50, #f9fafb);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 4px;
    flex-wrap: wrap;
  }
  .action-text {
    font-size: 12px;
    color: var(--color-text-primary, #111827);
    flex: 1;
    min-width: 0;
  }
  .rollback-btn {
    font-size: 11px;
    padding: 4px 10px;
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #991b1b);
    border: 1px solid var(--color-error, #fca5a5);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  .rollback-btn:hover {
    background: var(--color-error-bg, #fee2e2);
  }

  .dsp-empty {
    padding: 16px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    font-size: 12px;
  }
</style>
