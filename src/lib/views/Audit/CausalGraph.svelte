<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务化因果图(P06 §6.1 + §8.4)
    - 接收 BusinessCausalChain,渲染节点列表 + 因果箭头
    - 每个节点:业务描述 + 因果解释 + hash
    - 顶部:LLM 总结(若有)
    - 空态:未选中 fact 时提示"点击左侧审计条目查看因果链"
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §6.2 + §7.1
-->

<script lang="ts">
  import type { BusinessCausalChain } from "$lib/stores/business-causal";
  import EmptyState from "../Feedback/EmptyState.svelte";

  interface Props {
    chain: BusinessCausalChain | null;
    loading?: boolean;
    onClose?: () => void;
  }

  let { chain, loading = false, onClose }: Props = $props();
</script>

<div class="causal-graph">
  <header class="cg-header">
    <h3 class="title">🔗 业务因果图</h3>
    {#if chain}
      <span class="fact-tag">fact #{chain.factId}</span>
    {/if}
    {#if onClose}
      <button class="close-btn" onclick={onClose} aria-label="关闭因果图">✕</button>
    {/if}
  </header>

  {#if loading}
    <div class="cg-loading">⏳ 正在拉取因果链…</div>
  {:else if !chain}
    <EmptyState
      type="no_data"
      noun="因果链"
      description="点击左侧审计条目,查看该 Fact 的因果追溯链"
    />
  {:else if chain.nodes.length === 0}
    <EmptyState
      type="no_data"
      noun="因果链"
      description="该 Fact 无前因(直接输入)"
    />
  {:else}
    {#if chain.summary}
      <div class="cg-summary">
        <div class="summary-label">💡 LLM 因果总结</div>
        <div class="summary-text">{chain.summary}</div>
      </div>
    {/if}

    <div class="nodes-list">
      {#each chain.nodes as node, i (node.factId)}
        <div class="causal-node" class:root={node.parentIds.length === 0}>
          <div class="node-header">
            <span class="node-index">#{i + 1}</span>
            <span class="node-type">{node.factType}</span>
            <span class="node-time">t={node.logicalTime}</span>
            <span
              class="node-hash"
              title={node.hash}
            >{node.hash ? node.hash.slice(0, 6) : "-"}…</span>
          </div>
          <div class="node-description">{node.businessDescription}</div>
          {#if node.causalExplanation}
            <div class="node-explanation">
              <span class="arrow">↓</span>
              <span>{node.causalExplanation}</span>
            </div>
          {/if}
          {#if node.confidence < 100}
            <div class="node-confidence">
              信心: {node.confidence}%
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .causal-graph {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
  }
  .cg-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    background: var(--color-gray-50, #f9fafb);
    flex-shrink: 0;
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
    flex: 1;
  }
  .fact-tag {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--brand, #7c3aed);
    background: var(--color-info-bg, #f5f3ff);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--color-gray-500, #6b7280);
    padding: 0 4px;
  }
  .close-btn:hover {
    color: var(--color-gray-700, #374151);
  }

  .cg-loading {
    padding: 24px;
    text-align: center;
    color: var(--color-gray-500, #6b7280);
    font-size: 12px;
  }

  .cg-summary {
    margin: 8px;
    padding: 8px 10px;
    background: #fefce8;
    border: 1px solid var(--color-warning, #fde68a);
    border-radius: 6px;
    flex-shrink: 0;
  }
  .summary-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--color-warning, #92400e);
    margin-bottom: 4px;
  }
  .summary-text {
    font-size: 12px;
    color: var(--color-warning, #78350f);
    line-height: 1.5;
  }

  .nodes-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }
  .causal-node {
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    padding: 8px 10px;
    position: relative;
    border-left: 3px solid var(--color-primary, #2563eb);
  }
  .causal-node.root {
    border-left-color: var(--success, #10b981);
  }
  .causal-node + .causal-node::before {
    content: "│";
    position: absolute;
    left: 14px;
    top: -14px;
    color: var(--color-gray-400, #9ca3af);
    font-size: 14px;
    line-height: 1;
  }

  .node-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    margin-bottom: 4px;
  }
  .node-index {
    font-weight: 700;
    color: var(--color-gray-600, #4b5563);
  }
  .node-type {
    font-family: var(--font-mono, monospace);
    color: var(--brand, #7c3aed);
    background: var(--color-info-bg, #f5f3ff);
    padding: 0 5px;
    border-radius: 3px;
  }
  .node-time {
    font-family: var(--font-mono, monospace);
    color: var(--color-gray-500, #6b7280);
  }
  .node-hash {
    font-family: var(--font-mono, monospace);
    color: var(--color-gray-500, #6b7280);
    margin-left: auto;
  }

  .node-description {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
    margin-bottom: 4px;
  }
  .node-explanation {
    display: flex;
    gap: 4px;
    font-size: 11px;
    color: var(--color-gray-700, #374151);
  }
  .node-explanation .arrow {
    color: var(--color-primary, #2563eb);
    font-weight: 700;
  }
  .node-confidence {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    margin-top: 4px;
  }
</style>
