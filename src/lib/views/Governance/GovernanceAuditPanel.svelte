<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:治理域审计面板（G2）——认证审计/生命周期审计/LLM 审计三视图+LLM 统计
  权限:三端点均仅管理员(403 原样透传);数据形态宽松以 JsonViewer 呈现
-->

<script lang="ts">
  import { get } from "svelte/store";
  import {
    governanceStore,
  } from "$lib/governance/governance-store";
  import JsonViewer from "$lib/views/Dataset/JsonViewer.svelte";

  type Tab = "auth" | "lifecycle" | "llm";

  let tab = $state<Tab>("lifecycle");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let authData = $state<unknown>(null);
  let lifecycleData = $state<unknown>(null);
  let llmData = $state<unknown>(null);
  let llmStats = $state<unknown>(null);
  let lifecycleFilter = $state("");

  async function load(t: Tab): Promise<void> {
    const g = get(governanceStore);
    if (!g.backend) return;
    loading = true;
    error = null;
    try {
      if (t === "auth") authData = await g.backend.listAuthAudits();
      else if (t === "lifecycle")
        lifecycleData = await g.backend.listLifecycleAudits(
          lifecycleFilter.trim() || undefined,
        );
      else {
        llmData = await g.backend.listLlmAudits();
        llmStats = await g.backend.llmAuditStats();
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function switchTab(t: Tab): void {
    tab = t;
    void load(t);
  }

  // 首开即载
  $effect(() => {
    void load(tab);
  });
</script>

<div class="ga" aria-label="治理域审计">
  <div class="ga-tabs" role="tablist">
    {#each [["lifecycle", "生命周期审计"], ["auth", "认证审计"], ["llm", "LLM 审计"]] as [t, label] (t)}
      <button
        type="button"
        class="ga-tab"
        class:active={tab === t}
        role="tab"
        aria-selected={tab === t}
        onclick={() => switchTab(t as Tab)}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if tab === "lifecycle"}
    <div class="ga-filter">
      <input
        placeholder="按数据集 ID 过滤(可空)"
        bind:value={lifecycleFilter}
        onkeydown={(e) => e.key === "Enter" && void load("lifecycle")}
      />
      <button type="button" class="ga-btn" onclick={() => void load("lifecycle")}>
        查询
      </button>
    </div>
  {/if}

  {#if loading}
    <p class="ga-status">加载中…</p>
  {:else if error}
    <div class="ga-status ga-err">{error}</div>
  {:else}
    {#if tab === "llm" && llmStats}
      <div class="ga-stats">
        <JsonViewer value={llmStats} />
      </div>
    {/if}
    <div class="ga-json">
      {#if tab === "auth" && authData !== null}
        <JsonViewer value={authData} />
      {:else if tab === "lifecycle" && lifecycleData !== null}
        <JsonViewer value={lifecycleData} />
      {:else if tab === "llm" && llmData !== null}
        <JsonViewer value={llmData} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .ga {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ga-tabs {
    display: flex;
    gap: 4px;
  }
  .ga-tab {
    font-size: 11px;
    padding: 4px 12px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
    border-radius: 6px 6px 0 0;
  }
  .ga-tab.active {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: #fff;
  }
  .ga-filter {
    display: flex;
    gap: 6px;
  }
  .ga-filter input {
    flex: 1;
    font-size: 12px;
    padding: 5px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
    font-family: var(--font-mono, monospace);
  }
  .ga-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .ga-status {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    margin: 0;
  }
  .ga-err {
    color: var(--danger, #dc2626);
  }
  .ga-stats {
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    padding: 6px;
    max-height: 180px;
    overflow: auto;
  }
  .ga-json {
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    padding: 6px;
    max-height: 320px;
    overflow: auto;
    font-size: 11px;
  }
</style>
