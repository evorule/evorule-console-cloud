<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务术语 overlay 面板(P06 §3.5 + §6.3)
    - 侧边栏:展示当前选中 fact 的业务化翻译(术语高亮)
    - 业务术语图例:列出当前行业激活术语
    - 不修改 ttd 内部 DOM(避免脆弱的 MutationObserver)
    - 通过 audit store 拉取当前 fact 的业务化转换
  设计决策(P0 简化):
    - ttd v1.0 是 vanilla JS 整体嵌入,DOM 结构可能变化
    - 用 MutationObserver 注入业务标签是脆弱的(P1 可加)
    - P0 改为"侧栏翻译面板":用户在 ttd 点 fact → 这里展示业务化版本
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §3.5 + §6.3 + §8.2
-->

<script lang="ts">
  import { get } from "svelte/store";
  import {
    currentSessionId,
    causalSelection,
  } from "$lib/kernel";
  import {
    businessCausalStore,
  } from "$lib/stores/business-causal";
  import {
    businessTermsStore,
    activeTermsByIndustry,
  } from "$lib/stores/business-terms";
  import { dbStore } from "$lib/stores/db";

  interface Props {
    /** 触发回滚请求(传递当前选中 fact_id 作为目标版本) */
    onRollbackRequest?: (factId: number) => void;
  }

  let { onRollbackRequest }: Props = $props();

  // === 派生 ===
  let causal = $derived($businessCausalStore);
  let selectedFactId = $derived($causalSelection?.factId ?? null);
  let sessionId = $derived($currentSessionId);
  let industry = $derived($dbStore.industry);
  let activeTerms = $derived($activeTermsByIndustry);
  let allTermsCount = $derived($businessTermsStore.length);
</script>

<aside class="term-overlay" aria-label="业务术语翻译面板">
  <header class="to-header">
    <h3 class="to-title">🏷 业务术语翻译</h3>
    {#if selectedFactId !== null}
      <span class="to-fact-tag">fact #{selectedFactId}</span>
    {/if}
  </header>

  {#if selectedFactId === null}
    <div class="to-empty">
      <div class="to-empty-icon">💡</div>
      <p class="to-empty-text">
        在左侧 ttd 视图中点击一个 Fact,这里会显示业务化翻译
      </p>
    </div>
  {:else if !causal}
    <div class="to-loading">⏳ 正在加载业务化翻译…</div>
  {:else}
    <section class="to-section">
      <div class="to-section-title">业务因果链</div>
      {#if causal.nodes.length === 0}
        <p class="to-hint">该 Fact 无前因(直接输入)</p>
      {:else}
        <ol class="to-causal-list">
          {#each causal.nodes as node, i (node.factId)}
            <li class="to-causal-item">
              <div class="to-node-head">
                <span class="to-node-idx">#{i + 1}</span>
                <span class="to-node-type">{node.factType}</span>
                <span class="to-node-time">t={node.logicalTime}</span>
              </div>
              <div class="to-node-desc">{node.businessDescription}</div>
              {#if node.causalExplanation}
                <div class="to-node-explain">↓ {node.causalExplanation}</div>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    {#if causal.summary}
      <section class="to-section">
        <div class="to-section-title">💡 LLM 因果总结</div>
        <p class="to-summary-text">{causal.summary}</p>
      </section>
    {/if}

    {#if onRollbackRequest && sessionId !== null}
      <section class="to-section">
        <button
          class="to-rollback-btn"
          onclick={() => onRollbackRequest(selectedFactId)}
          title={`回滚到 v${selectedFactId}(用旧规则产生新版本)`}
        >
          ↩ 回滚到此版本 (v{selectedFactId})
        </button>
      </section>
    {/if}
  {/if}

  <section class="to-section to-legend">
    <div class="to-section-title">
      术语图例({industry})
      <span class="to-count">{activeTerms.length}/{allTermsCount}</span>
    </div>
    {#if activeTerms.length === 0}
      <p class="to-hint">当前行业无激活术语</p>
    {:else}
      <ul class="to-term-list">
        {#each activeTerms as term (term.id)}
          <li class="to-term-item" title={term.description}>
            <span class="to-term-label">{term.label}</span>
            <code class="to-term-key">{term.key}</code>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</aside>

<style>
  .term-overlay {
    display: flex;
    flex-direction: column;
    width: 280px;
    min-width: 280px;
    background: var(--bg-card);
    border-left: 1px solid var(--border, #e5e7eb);
    overflow: auto;
    height: 100%;
  }
  .to-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    background: var(--bg-page, #f9fafb);
    flex-shrink: 0;
  }
  .to-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary, #111827);
    flex: 1;
  }
  .to-fact-tag {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--brand, #7c3aed);
    background: var(--info-bg, #f5f3ff);
    padding: 1px 6px;
    border-radius: 3px;
  }

  .to-empty {
    padding: 24px 16px;
    text-align: center;
  }
  .to-empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
    opacity: 0.6;
  }
  .to-empty-text {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
    line-height: 1.5;
    margin: 0;
  }

  .to-loading {
    padding: 16px;
    text-align: center;
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }

  .to-section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--bg-hover, #f3f4f6);
  }
  .to-section-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-primary, #374151);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .to-count {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
    font-weight: 400;
    text-transform: none;
  }

  .to-causal-list {
    margin: 0;
    padding-left: 16px;
    list-style: decimal;
  }
  .to-causal-item {
    margin-bottom: 6px;
    font-size: 11px;
  }
  .to-node-head {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: var(--text-secondary, #4b5563);
  }
  .to-node-type {
    font-family: var(--font-mono, monospace);
    color: var(--brand, #7c3aed);
    background: var(--info-bg, #f5f3ff);
    padding: 0 4px;
    border-radius: 2px;
  }
  .to-node-time {
    font-family: var(--font-mono, monospace);
  }
  .to-node-desc {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary, #111827);
    margin: 2px 0;
  }
  .to-node-explain {
    font-size: 10px;
    color: var(--brand, #2563eb);
  }

  .to-summary-text {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--warning, #92400e);
    background: #fefce8;
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid var(--warning, #fde68a);
  }

  .to-rollback-btn {
    width: 100%;
    font-size: 11px;
    padding: 6px 10px;
    background: var(--danger-bg, #fef2f2);
    color: var(--danger, #991b1b);
    border: 1px solid var(--danger, #fca5a5);
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    font-family: inherit;
  }
  .to-rollback-btn:hover {
    background: var(--danger-bg, #fee2e2);
  }

  .to-hint {
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
    margin: 0;
    font-style: italic;
  }

  .to-term-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .to-term-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 3px 6px;
    background: var(--bg-page, #f9fafb);
    border-radius: 3px;
    cursor: help;
  }
  .to-term-label {
    color: var(--text-primary, #111827);
    font-weight: 500;
    flex: 1;
    min-width: 0;
  }
  .to-term-key {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
    background: var(--bg-card);
    padding: 1px 4px;
    border-radius: 2px;
    border: 1px solid var(--border, #e5e7eb);
  }
</style>
