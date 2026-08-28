<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  FactStream — Fact 流时间线 (阶段 D.1.3)
-->
<!--
  依据: 设计文档/01_界面升级.txt §三.3 (大屏线框) + 03_大屏.md
        实施文档_界面升级_v1.0.md §D.1.3
  职责:
    - 审计链 Fact 流时间线, 每行 = 逻辑版本号(等宽) + 故事线(中文派生) + VerdictBadge
    - 点击 Fact → onfactclick 回调 (StateView 据此打开 AuditView 模态)
  边界标注 (00 §六):
    - 审计 Fact 是 evorule 确定性信号 (chain-verified/broken, 由核心仓验证)
    - 故事线文本是应用层推导 (metric, 不进审计链)
  Props:
    facts       CausalEntry[] (audit 端点返回的 entries)
    verified    审计链是否验证通过 (决定每行徽标 kind)
    onfactclick 点击 fact 回调 (参数: factId)
-->

<script lang="ts">
  import VerdictBadge from "$lib/kernel/components/VerdictBadge.svelte";
  import type { CausalEntry } from "$lib/kernel/backend/types";

  interface Props {
    facts: CausalEntry[];
    verified: boolean;
    onfactclick?: (factId: number) => void;
  }

  let { facts, verified, onfactclick }: Props = $props();

  /** fact_type → 中文故事线 (应用层推导, 非 evorule 确定性) */
  function storyLine(fact: CausalEntry): string {
    const t = fact.fact_type;
    const lt = fact.logical_time;
    const cause = fact.cause;
    const causeSuffix = cause != null ? ` (承继 #${cause})` : "";
    switch (t) {
      case "StateTransition":
        return `状态迁移至 t${lt}${causeSuffix}`;
      case "PayloadUpdate":
        return `载荷更新 t${lt}${causeSuffix}`;
      case "IoRequest":
        return `发起 IO 请求 t${lt}${causeSuffix}`;
      case "IoResponse":
        return `IO 响应回填 t${lt}${causeSuffix}`;
      case "Command":
        return `命令提交 t${lt}${causeSuffix}`;
      default:
        return `${t} t${lt}${causeSuffix}`;
    }
  }

  /** fact_type 简写标签 */
  function typeShort(t: string): string {
    return t
      .replace("StateTransition", "迁移")
      .replace("PayloadUpdate", "更新")
      .replace("IoRequest", "IO请求")
      .replace("IoResponse", "IO响应")
      .replace("Command", "命令");
  }
</script>

{#if facts.length === 0}
  <div class="fact-stream-empty">
    <span class="empty-icon">📭</span>
    <p>审计链为空</p>
    <p class="empty-hint">提交命令后,Fact 流将在此实时呈现</p>
  </div>
{:else}
  <ol class="fact-stream" role="list">
    {#each facts as fact (fact.fact_id)}
      <li>
        <button
          class="fact-row"
          onclick={() => onfactclick?.(fact.fact_id)}
          aria-label="查看 Fact #{fact.fact_id} 审计详情"
        >
          <span class="fact-version">t{fact.logical_time}</span>
          <span class="fact-id">#{fact.fact_id}</span>
          <span class="fact-type">{typeShort(fact.fact_type)}</span>
          <span class="fact-story">{storyLine(fact)}</span>
          <VerdictBadge
            kind={verified ? "chain-verified" : "chain-broken"}
            compact
            value={verified ? "链验证" : "链断裂"}
          />
        </button>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .fact-stream {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .fact-stream li {
    border-bottom: 1px solid var(--border);
  }

  .fact-stream li:last-child {
    border-bottom: none;
  }

  .fact-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    width: 100%;
    padding: var(--spacing-sm) var(--spacing-md);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-primary);
    transition: background var(--transition-fast);
  }

  .fact-row:hover {
    background: var(--bg-hover);
  }

  .fact-row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    z-index: 1;
  }

  .fact-version {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--brand);
    min-width: 44px;
  }

  .fact-id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    min-width: 56px;
  }

  .fact-type {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px var(--spacing-xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    background: var(--bg-primary);
    flex-shrink: 0;
  }

  .fact-story {
    flex: 1;
    color: var(--text-primary);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fact-stream-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-2xl);
    color: var(--text-secondary);
    text-align: center;
  }

  .empty-icon {
    font-size: 40px;
    margin-bottom: var(--spacing-sm);
  }

  .empty-hint {
    font-size: var(--text-xs);
    margin-top: var(--spacing-xs);
    color: var(--text-secondary);
  }

  @media (max-width: 700px) {
    .fact-story {
      font-size: var(--text-xs);
    }
    .fact-type {
      display: none;
    }
  }
</style>
