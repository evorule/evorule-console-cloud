<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:影响预览面板(右侧:前端规则匹配结果)
    - 匹配统计:命中 / 未命中 / 总规则数
    - 命中规则列表(绿色):显示匹配字段 + 预计 Fact 类型
    - 未命中规则列表(灰色,折叠)
    - 置信度提示(前端简单匹配=低置信度)
  关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §5.4 + §7.3(影响预览流)
-->

<script lang="ts">
  import type { ImpactPreview, RuleMatchResult } from "$lib/stores/impact-preview";

  interface Props {
    preview: ImpactPreview | null;
  }

  let { preview }: Props = $props();

  let showUnmatched = $state(false);

  const matchedRules = $derived(
    preview ? preview.matches.filter((m) => m.matched) : [],
  );
  const unmatchedRules = $derived(
    preview ? preview.matches.filter((m) => !m.matched) : [],
  );

  const confidenceInfo = $derived.by(() => {
    if (!preview) return { text: "-", cls: "", tip: "" };
    switch (preview.confidence) {
      case "high":
        return {
          text: "高置信度",
          cls: "conf-high",
          tip: "完整 dry-run 模拟结果",
        };
      case "medium":
        return {
          text: "中置信度",
          cls: "conf-medium",
          tip: "部分模拟,仅供参考",
        };
      case "low":
      default:
        return {
          text: "低置信度",
          cls: "conf-low",
          tip: "前端简单字段匹配,实际命中以运行为准",
        };
    }
  });
</script>

<div class="impact-preview-panel">
  <header class="panel-header">
    <h3 class="panel-title">🔍 影响预览</h3>
    {#if preview}
      <span
        class={`confidence-badge ${confidenceInfo.cls}`}
        title={confidenceInfo.tip}
      >
        {confidenceInfo.text}
      </span>
    {/if}
  </header>

  {#if !preview}
    <div class="empty-hint">
      <div class="empty-icon">📡</div>
      <p>暂无可预览内容</p>
      <p class="hint-sub">
        翻译为 instruction 后,此处显示可能触发的规则。
      </p>
    </div>
  {:else}
    <!-- 统计卡 -->
    <div class="stats-grid">
      <div class="stat-card stat-total">
        <div class="stat-value">{preview.matches.length}</div>
        <div class="stat-label">总规则</div>
      </div>
      <div class="stat-card stat-matched">
        <div class="stat-value">{preview.matchedCount}</div>
        <div class="stat-label">命中</div>
      </div>
      <div class="stat-card stat-unmatched">
        <div class="stat-value">{preview.unmatchedCount}</div>
        <div class="stat-label">未命中</div>
      </div>
    </div>

    <div class="generated-at">
      生成时间:{new Date(preview.generatedAt).toLocaleTimeString()}
    </div>

    <!-- 命中规则 -->
    <section class="result-section">
      <div class="section-header">
        <h4 class="section-title matched">✅ 命中规则({matchedRules.length})</h4>
      </div>
      {#if matchedRules.length === 0}
        <div class="no-results muted">当前 instruction 未命中任何规则</div>
      {:else}
        <ul class="rule-list">
          {#each matchedRules as rule (rule.ruleId)}
            {@render renderRuleItem(rule, true)}
          {/each}
        </ul>
      {/if}
    </section>

    <!-- 未命中规则(折叠) -->
    <section class="result-section">
      <button
        type="button"
        class="section-toggle"
        onclick={() => (showUnmatched = !showUnmatched)}
      >
        <span class="toggle-icon">{showUnmatched ? "▼" : "▶"}</span>
        <h4 class="section-title unmatched">
          ⏹ 未命中规则({unmatchedRules.length})
        </h4>
      </button>
      {#if showUnmatched}
        {#if unmatchedRules.length === 0}
          <div class="no-results muted">没有未命中的规则</div>
        {:else}
          <ul class="rule-list">
            {#each unmatchedRules as rule (rule.ruleId)}
              {@render renderRuleItem(rule, false)}
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}
</div>

{#snippet renderRuleItem(rule: RuleMatchResult, matched: boolean)}
  <li class="rule-item" class:matched={matched}>
    <div class="rule-head">
      <span class="rule-desc">{rule.ruleDescription || rule.ruleId}</span>
      {#if matched}
        <span class="expected-fact-type">{rule.expectedFactType}</span>
      {/if}
    </div>
    <div class="rule-meta">
      <code class="rule-id">{rule.ruleId}</code>
      {#if matched && rule.matchedFields.length > 0}
        <span class="matched-fields">
          命中字段:
          {#each rule.matchedFields as fld (fld)}
            <code class="field-chip">{fld}</code>
          {/each}
        </span>
      {/if}
    </div>
  </li>
{/snippet}

<style>
  .impact-preview-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    height: 100%;
    overflow-y: auto;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .panel-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .confidence-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .conf-high {
    background: var(--color-success-bg, #d1fae5);
    color: var(--color-success, #065f46);
  }
  .conf-medium {
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning, #92400e);
  }
  .conf-low {
    background: var(--color-error-bg, #fee2e2);
    color: var(--color-error, #991b1b);
  }
  .empty-hint {
    padding: 32px 16px;
    text-align: center;
    color: var(--color-text-secondary, #64748b);
    border: 1px dashed var(--color-gray-300, #cbd5e1);
    border-radius: 6px;
    background: var(--color-gray-50, #f8fafc);
  }
  .empty-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }
  .empty-hint p {
    margin: 4px 0;
    font-size: 13px;
  }
  .hint-sub {
    font-size: 11px;
    opacity: 0.8;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .stat-card {
    padding: 8px;
    border-radius: 6px;
    text-align: center;
  }
  .stat-total {
    background: var(--color-gray-50, #f8fafc);
    border: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .stat-matched {
    background: var(--color-success-bg, #d1fae5);
    border: 1px solid #6ee7b7;
  }
  .stat-unmatched {
    background: var(--color-gray-100, #f1f5f9);
    border: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text-primary, #1e293b);
    line-height: 1.2;
  }
  .stat-label {
    font-size: 10px;
    color: var(--color-text-secondary, #64748b);
    margin-top: 2px;
  }
  .generated-at {
    font-size: 10px;
    color: var(--color-text-secondary, #64748b);
    text-align: right;
  }
  .result-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 4px 0;
    cursor: pointer;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }
  .section-title {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
  }
  .section-title.matched {
    color: var(--color-success, #065f46);
  }
  .section-title.unmatched {
    color: var(--color-text-secondary, #64748b);
  }
  .toggle-icon {
    font-size: 10px;
    color: var(--color-text-secondary, #64748b);
  }
  .no-results {
    padding: 8px 10px;
    font-size: 11px;
    border-radius: 4px;
    background: var(--color-gray-50, #f8fafc);
  }
  .muted {
    color: var(--color-text-secondary, #64748b);
  }
  .rule-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 280px;
    overflow-y: auto;
  }
  .rule-item {
    padding: 6px 8px;
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 4px;
    background: var(--bg-card);
  }
  .rule-item.matched {
    border-color: #6ee7b7;
    background: #ecfdf5;
  }
  .rule-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 3px;
  }
  .rule-desc {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-primary, #1e293b);
  }
  .expected-fact-type {
    font-size: 10px;
    padding: 1px 6px;
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info, #1e40af);
    border-radius: 8px;
    font-weight: 600;
  }
  .rule-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 10px;
  }
  .rule-id {
    font-family: var(--font-mono, monospace);
    color: var(--color-text-secondary, #64748b);
  }
  .matched-fields {
    color: var(--color-text-secondary, #64748b);
  }
  .field-chip {
    font-family: var(--font-mono, monospace);
    background: var(--color-gray-100, #f1f5f9);
    padding: 0 4px;
    border-radius: 3px;
    color: var(--color-success, #065f46);
    margin: 0 2px;
    font-size: 10px;
  }
</style>
