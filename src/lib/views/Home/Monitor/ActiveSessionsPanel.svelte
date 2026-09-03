<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:活跃会话清单(UV-062 W2 接线5)
    - GET /api/sessions(HttpBackend.listSessions)拉取 session id 列表
    - 每项:点选(填入调试面板)+ 📋 复制到剪贴板
    - 读取失败显式错误态 + 重试;空列表与错误分开展示
  配合:DebugPanel(点选 session_id 直接进入六路调试)
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { useBackend } from "$lib/kernel";
  import { toastError, toastSuccess } from "$lib/stores/toast";

  interface Props {
    /** 点选回调(填入调试面板 session id) */
    onPick?: (sessionId: number) => void;
  }

  let { onPick }: Props = $props();

  const backend = useBackend();

  let sessions = $state<number[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    loading = true;
    error = null;
    try {
      sessions = await backend.listSessions();
    } catch (e) {
      sessions = null;
      error = `读取失败: ${(e as Error).message}`;
    } finally {
      loading = false;
    }
  }

  async function handleCopy(sid: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(sid));
      toastSuccess(`已复制 session id: ${sid}`);
    } catch (e) {
      toastError(`复制失败: ${(e as Error).message}`);
    }
  }
</script>

<section class="active-sessions" aria-label="活跃会话清单">
  <header class="as-header">
    <h3 class="as-title">📋 活跃会话</h3>
    <button
      class="as-btn"
      onclick={() => void refresh()}
      disabled={loading}
      title="重新拉取会话列表(GET /api/sessions)"
    >
      {loading ? "⏳ 拉取中…" : "↻ 刷新"}
    </button>
  </header>

  {#if error}
    <div class="as-error" title={error}>⚠️ {error}</div>
    <button class="as-retry" onclick={() => void refresh()}>↻ 重试</button>
  {:else if loading && sessions === null}
    <div class="as-hint">读取中…</div>
  {:else if sessions === null}
    <div class="as-hint">尚未加载</div>
  {:else if sessions.length === 0}
    <div class="as-hint">(无活跃会话)</div>
  {:else}
    <ul class="as-list">
      {#each sessions as sid (sid)}
        <li class="as-item">
          <button
            class="as-id"
            onclick={() => onPick?.(sid)}
            title="点选:填入调试面板并刷新"
          >
            #{sid}
          </button>
          <button
            class="as-copy"
            onclick={() => void handleCopy(sid)}
            title="复制 session id"
            aria-label="复制 session id {sid}"
          >
            📋
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .active-sessions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-card, #ffffff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    min-width: 0;
  }
  .as-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .as-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary, #111827);
    white-space: nowrap;
  }
  .as-btn {
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 5px;
    border: 1px solid var(--brand, #2563eb);
    background: var(--brand, #2563eb);
    color: white;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  .as-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .as-error {
    font-size: 11px;
    color: var(--danger, #991b1b);
    word-break: break-all;
  }
  .as-retry {
    align-self: flex-start;
    font-size: 11px;
    padding: 2px 10px;
    border-radius: 4px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card);
    color: var(--text-secondary, #6b7280);
    cursor: pointer;
  }
  .as-retry:hover {
    background: var(--bg-page, #f9fafb);
  }
  .as-hint {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
  }
  .as-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    overflow-y: auto;
    max-height: 120px;
  }
  .as-item {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-page, #f9fafb);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 5px;
    overflow: hidden;
  }
  .as-id {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 700;
    color: var(--brand, #2563eb);
    background: transparent;
    border: none;
    padding: 3px 6px;
    cursor: pointer;
  }
  .as-id:hover {
    background: var(--info-bg, #eff6ff);
  }
  .as-copy {
    font-size: 11px;
    background: transparent;
    border: none;
    border-left: 1px solid var(--border, #e5e7eb);
    padding: 3px 6px;
    cursor: pointer;
  }
  .as-copy:hover {
    background: var(--bg-hover, #f3f4f6);
  }
</style>
