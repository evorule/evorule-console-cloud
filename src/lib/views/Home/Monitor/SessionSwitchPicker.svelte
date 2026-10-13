<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:会话选择浮层(session.switch 干预钮)
    - A 视角切换:把监控大屏实时流指向任一活跃会话(不动生产状态)
    - B 晋级入口:对 fork 自生产的试验会话提供「晋级生产」(管理员,窄场景)
  标记:生产=productionState.currentSessionId;监控中=当前 monitorTarget
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { useBackend } from "$lib/kernel";
  import { CloudHttpBackend } from "$lib/backend/cloud-http-backend";
  import { toastSuccess, toastError, toastWarning } from "$lib/stores/toast";
  import {
    productionStateStore,
  } from "$lib/stores/production-state";
  import { get } from "svelte/store";

  interface Props {
    /** 当前监控目标(缺省跟随生产会话) */
    monitorTarget: number | null;
    onPick: (sessionId: number) => void;
    onCancel: () => void;
  }

  let { monitorTarget, onPick, onCancel }: Props = $props();

  const backend = useBackend() as CloudHttpBackend;

  let sessions = $state<number[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let promoting = $state<number | null>(null);

  const productionSid = $derived(get(productionStateStore).currentSessionId);

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

  function badge(sid: number): string {
    if (sid === productionSid) return "生产";
    if (sid === monitorTarget) return "监控中";
    return "";
  }

  function handlePick(sid: number): void {
    if (sid === monitorTarget) {
      toastWarning(`会话 #${sid} 已是当前监控视角`);
      return;
    }
    onPick(sid);
  }

  async function handlePromote(sid: number): Promise<void> {
    if (sid === productionSid) return;
    if (
      !window.confirm(
        `把会话 #${sid} 晋级为生产会话?生产引用换防(规则集版本/哈希不变),旧生产会话不再受保护。`,
      )
    ) {
      return;
    }
    promoting = sid;
    try {
      await backend.promoteSession(sid);
      toastSuccess(`会话 #${sid} 已晋级为生产会话(版本/哈希保留)`);
      await refresh();
    } catch (e) {
      const status = e instanceof Error && "status" in e ? (e as { status?: number }).status : 0;
      if (status === 400) {
        toastError("仅支持晋级 fork 自当前生产会话的试验会话");
      } else if (status === 403 || status === 401) {
        toastError("晋级须平台管理员登录");
      } else {
        toastError(`晋级失败:HTTP ${status || "网络错误"}`);
      }
    } finally {
      promoting = null;
    }
  }
</script>

<div
  class="ss-overlay"
  role="presentation"
  onclick={(e) => {
    if (e.currentTarget === e.target) onCancel();
  }}
>
  <div class="ss-panel" role="dialog" aria-label="切换 Session">
    <header class="ss-header">
      <h3 class="ss-title">🔀 切换 Session</h3>
      <span class="ss-hint">选监控视角(不动生产状态);fork 自生产的试验会话可晋级</span>
    </header>

    {#if loading}
      <div class="ss-status">读取中…</div>
    {:else if error}
      <div class="ss-status ss-err">{error}</div>
    {:else if !sessions || sessions.length === 0}
      <div class="ss-status">无活跃会话</div>
    {:else}
      <ul class="ss-list">
        {#each sessions as sid (sid)}
          <li class="ss-row" class:current={sid === monitorTarget}>
            <span class="ss-sid">#{sid}</span>
            {#if badge(sid)}
              <span class="ss-badge" class:prod={sid === productionSid}
                >{badge(sid)}</span
              >
            {/if}
            <span class="ss-actions">
              <button
                class="ss-btn pick"
                disabled={sid === monitorTarget}
                onclick={() => handlePick(sid)}
              >
                切到此视角
              </button>
              {#if sid !== productionSid}
                <button
                  class="ss-btn promote"
                  disabled={promoting !== null}
                  onclick={() => handlePromote(sid)}
                >
                  {promoting === sid ? "晋级中…" : "晋级生产"}
                </button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <footer class="ss-footer">
      <button class="ss-btn" onclick={onCancel}>关闭</button>
      <button class="ss-btn" onclick={() => void refresh()}>刷新</button>
    </footer>
  </div>
</div>

<style>
  .ss-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
  .ss-panel {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 10px;
    min-width: 380px;
    max-width: 520px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    gap: 10px;
  }
  .ss-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ss-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary, #111827);
  }
  .ss-hint {
    font-size: 11px;
    color: var(--text-secondary, #6b7280);
  }
  .ss-status {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
    padding: 12px 0;
  }
  .ss-err {
    color: var(--danger, #dc2626);
  }
  .ss-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ss-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
  }
  .ss-row.current {
    background: var(--info-bg, #eff6ff);
    border-color: var(--info, #93c5fd);
  }
  .ss-sid {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 600;
    min-width: 48px;
  }
  .ss-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-page, #f3f4f6);
    color: var(--text-secondary, #6b7280);
  }
  .ss-badge.prod {
    background: var(--success-bg, #d1fae5);
    color: var(--success, #059669);
    font-weight: 600;
  }
  .ss-actions {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
  .ss-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--border, #d1d5db);
    background: var(--bg-card, #fff);
    color: var(--text-secondary, #4b5563);
    cursor: pointer;
  }
  .ss-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ss-btn.pick:hover:not(:disabled) {
    background: var(--info-bg, #dbeafe);
  }
  .ss-btn.promote {
    border-color: var(--success, #10b981);
    color: var(--success, #059669);
  }
  .ss-btn.promote:hover:not(:disabled) {
    background: var(--success-bg, #d1fae5);
  }
  .ss-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
