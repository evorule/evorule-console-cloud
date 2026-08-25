<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:单条 Fact 卡片(FactStreamView 的列表项)
    - 展示 fact_id / fact_type / logical_time / timestamp
    - 展示 content(JSON 折叠展开)
    - 根据 fact_type 着色 chip
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.2(Fact 流展示)
-->

<script lang="ts">
  import type { FactData } from "$lib/stores/sse-events";

  interface Props {
    fact: FactData;
    /** 顺序号(显示用,非 fact_id) */
    seqNo?: number;
  }

  let { fact, seqNo }: Props = $props();

  let expanded = $state(false);

  const contentStr = $derived(
    typeof fact.content === "string"
      ? fact.content
      : JSON.stringify(fact.content, null, 2),
  );

  const timeStr = $derived(new Date(fact.timestamp).toLocaleTimeString());

  const typeColor = $derived(typeToColor(fact.fact_type));

  function typeToColor(type: string): { bg: string; fg: string } {
    const t = type.toLowerCase();
    if (t.includes("rule_triggered") || t.includes("trigger")) {
      return { bg: "var(--color-success-bg, #dcfce7)", fg: "var(--color-success, #166534)" };
    }
    if (t.includes("patient") || t.includes("visit")) {
      return { bg: "var(--color-info-bg, #dbeafe)", fg: "var(--color-info, #1e40af)" };
    }
    if (t.includes("drug") || t.includes("prescribe")) {
      return { bg: "#fce7f3", fg: "#9d174d" };
    }
    if (t.includes("io_request") || t.includes("io")) {
      return { bg: "var(--color-warning-bg, #fef3c7)", fg: "var(--color-warning, #92400e)" };
    }
    if (t.includes("error") || t.includes("violation")) {
      return { bg: "var(--color-error-bg, #fee2e2)", fg: "var(--color-error, #991b1b)" };
    }
    return { bg: "#f3f4f6", fg: "#374151" };
  }
</script>

<div class="fact-card" data-fact-id={fact.fact_id}>
  <header class="fact-head" role="button" tabindex="0"
    onclick={() => (expanded = !expanded)}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        expanded = !expanded;
      }
    }}
  >
    <div class="head-left">
      {#if seqNo !== undefined}
        <span class="seq-no">#{seqNo}</span>
      {/if}
      <span
        class="type-chip"
        style={`background: ${typeColor.bg}; color: ${typeColor.fg};`}
      >
        {fact.fact_type}
      </span>
      <span class="logical-time">t={fact.logical_time}</span>
    </div>
    <div class="head-right">
      <span class="fact-time">{timeStr}</span>
      <span class="expand-icon">{expanded ? "▲" : "▼"}</span>
    </div>
  </header>

  <div class="fact-id" title={fact.fact_id}>
    ID: <code>{fact.fact_id.slice(0, 16)}…</code>
  </div>

  {#if expanded}
    <details open class="fact-content">
      <summary>Content</summary>
      <pre>{contentStr || "// empty"}</pre>
    </details>
  {:else}
    <div class="fact-preview" title="点击展开">
      {shortPreview(contentStr)}
    </div>
  {/if}
</div>

{#snippet shortPreview(s: string)}
  {@const trimmed = s.replace(/\s+/g, " ").slice(0, 120)}
  {trimmed || "(empty)"}{trimmed.length >= 120 ? "…" : ""}
{/snippet}

<style>
  .fact-card {
    padding: 8px 10px;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 6px;
    transition: box-shadow 0.15s ease;
  }
  .fact-card:hover {
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    border-color: var(--color-gray-300, #d1d5db);
  }
  .fact-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
  }
  .head-left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .seq-no {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-gray-400, #9ca3af);
    font-weight: 600;
  }
  .type-chip {
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 10px;
    font-weight: 600;
    font-family: var(--font-mono, monospace);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .logical-time {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-primary, #2563eb);
    background: var(--color-info-bg, #eff6ff);
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 600;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .fact-time {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    font-family: var(--font-mono, monospace);
  }
  .expand-icon {
    font-size: 8px;
    color: var(--color-gray-400, #9ca3af);
  }
  .fact-id {
    margin-top: 4px;
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .fact-id code {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--color-gray-600, #4b5563);
  }
  .fact-content {
    margin-top: 6px;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 4px;
    overflow: hidden;
  }
  .fact-content summary {
    padding: 3px 8px;
    background: var(--color-gray-50, #f9fafb);
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    cursor: pointer;
    font-weight: 500;
  }
  .fact-content pre {
    margin: 0;
    padding: 8px;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    line-height: 1.4;
    background: #0f172a;
    color: #e2e8f0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .fact-preview {
    margin-top: 4px;
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    font-family: var(--font-mono, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
