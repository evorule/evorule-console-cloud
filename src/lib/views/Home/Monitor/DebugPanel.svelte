<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:内核调试只读面板(UV-062 W2 接线3)
    - 输入/点选 session_id 后展示六路调试信息:
      step(单步计数)/ snapshot(状态快照)/ phase(执行阶段)/
      queue(待执行队列)/ pending_io(悬挂 I/O)/ pending_io_count(计数)
    - 数据只读展示,刷新按钮整体重拉
    - 六路独立错误态:一路失败只落自己通道错误,不拖垮其他路
    - snapshot 200+error 语义失败态按错误渲染(缺失字段 ≠ 隐式 0)
  逻辑层:./debug-panel-logic.ts(纯函数,单测覆盖)
  端点:GET /api/sessions/{id}/step|snapshot|debug/phase|debug/queue|
        debug/pending_io|pending_io_count
-->

<script lang="ts">
  import { useBackend } from "$lib/kernel";
  import {
    type DebugChannelKey,
    type DebugChannelState,
    DEBUG_CHANNEL_LABELS,
    DEBUG_CHANNEL_ORDER,
    createInitialChannels,
    parseSessionIdInput,
    formatChannelValue,
    channelSemanticError,
    fetchDebugChannel,
  } from "./debug-panel-logic";

  interface Props {
    /**
     * 外部点选(如活跃会话面板);每次点选传入新对象,变化时填入输入框并
     * 自动刷新——重复点选同一 session 也会重新拉取。
     * null = 不注入(用户手动输入)。
     */
    pick?: { sid: number } | null;
  }

  let { pick = null }: Props = $props();

  const backend = useBackend();

  let sessionInput = $state("");
  let channels = $state<Record<DebugChannelKey, DebugChannelState>>(
    createInitialChannels(),
  );
  /** 已加载(或正在加载)的 session id;null = 尚未查询过 */
  let loadedSession = $state<number | null>(null);
  let loading = $state(false);
  let inputError = $state<string | null>(null);

  // 外部点选(活跃会话面板)→ 填入输入框并自动刷新
  $effect(() => {
    if (pick !== null) {
      sessionInput = String(pick.sid);
      void handleRefresh();
    }
  });

  /** 刷新六路(各自独立 try/catch,Promise 并发) */
  async function handleRefresh(): Promise<void> {
    const sid = parseSessionIdInput(sessionInput);
    if (sid === null) {
      inputError = "session id 须为正整数";
      return;
    }
    inputError = null;
    loadedSession = sid;
    loading = true;
    for (const key of DEBUG_CHANNEL_ORDER) {
      channels[key] = { status: "loading", data: null, error: null };
    }
    // 六路独立:任一路失败只写自己的 error 态,其余路照常展示
    await Promise.all(
      DEBUG_CHANNEL_ORDER.map(async (key) => {
        try {
          const data = await fetchDebugChannel(backend, sid, key);
          const semErr = channelSemanticError(key, data);
          if (semErr !== null) {
            channels[key] = { status: "error", data: null, error: semErr };
          } else {
            channels[key] = { status: "ok", data, error: null };
          }
        } catch (e) {
          channels[key] = {
            status: "error",
            data: null,
            error: (e as Error).message,
          };
        }
      }),
    );
    loading = false;
  }

  function handleInputKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      void handleRefresh();
    }
  }
</script>

<section class="debug-panel" aria-label="内核调试面板">
  <header class="dp-header">
    <h3 class="dp-title">🐞 调试面板</h3>
    <div class="dp-input-row">
      <input
        class="dp-input"
        type="text"
        inputmode="numeric"
        bind:value={sessionInput}
        onkeydown={handleInputKeydown}
        placeholder="session id"
        aria-label="session id"
        title="输入要调试的 session id(正整数)"
      />
      <button
        class="dp-btn"
        onclick={() => void handleRefresh()}
        disabled={loading}
        title="拉取六路调试信息(step/快照/阶段/队列/悬挂 IO/计数)"
      >
        {loading ? "⏳ 刷新中…" : "↻ 刷新"}
      </button>
    </div>
  </header>

  {#if inputError}
    <div class="dp-input-error">⚠️ {inputError}</div>
  {/if}

  {#if loadedSession === null}
    <div class="dp-empty">
      输入 session id 后刷新,查看六路调试信息(单步 / 快照 / 阶段 / 队列 /
      悬挂 IO / 计数)
    </div>
  {:else}
    <div class="dp-meta">Session #{loadedSession}</div>
    <div class="dp-grid">
      {#each DEBUG_CHANNEL_ORDER as key (key)}
        {@const ch = channels[key]}
        <div class="dp-channel" class:err={ch.status === "error"}>
          <span class="dp-ch-label">{DEBUG_CHANNEL_LABELS[key]}</span>
          {#if ch.status === "idle"}
            <span class="dp-ch-hint">未加载</span>
          {:else if ch.status === "loading"}
            <span class="dp-ch-hint">加载中…</span>
          {:else if ch.status === "error"}
            <span class="dp-ch-error" title={ch.error ?? ""}
              >⚠️ {ch.error}</span
            >
          {:else}
            <span class="dp-ch-value">{formatChannelValue(key, ch.data)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .debug-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-card, #ffffff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    min-width: 0;
  }
  .dp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .dp-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary, #111827);
    white-space: nowrap;
  }
  .dp-input-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dp-input {
    width: 110px;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
    padding: 4px 8px;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 5px;
    background: var(--bg-page, #f9fafb);
    color: var(--text-primary, #111827);
  }
  .dp-input:focus {
    outline: none;
    border-color: var(--brand, #2563eb);
  }
  .dp-btn {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 5px;
    border: 1px solid var(--brand, #2563eb);
    background: var(--brand, #2563eb);
    color: white;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  .dp-btn:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .dp-input-error {
    padding: 4px 8px;
    background: var(--danger-bg, #fef2f2);
    border: 1px solid var(--danger, #fca5a5);
    border-radius: 5px;
    color: var(--danger, #991b1b);
    font-size: 11px;
  }
  .dp-empty {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    padding: 6px 2px;
  }
  .dp-meta {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 700;
    color: var(--brand, #2563eb);
  }
  .dp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 6px;
  }
  .dp-channel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 6px;
    background: var(--bg-page, #f9fafb);
    min-width: 0;
  }
  .dp-channel.err {
    border-color: var(--danger, #fca5a5);
    background: var(--danger-bg, #fef2f2);
  }
  .dp-ch-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-secondary, #6b7280);
  }
  .dp-ch-hint {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
  }
  .dp-ch-error {
    font-size: 11px;
    color: var(--danger, #991b1b);
    word-break: break-all;
  }
  .dp-ch-value {
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    color: var(--text-primary, #111827);
    word-break: break-all;
  }
</style>
