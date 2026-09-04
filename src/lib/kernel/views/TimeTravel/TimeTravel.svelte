<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console 时间旅行视图 — 嵌入 ttd,展现 evorule "可回放" -->
<!--
  依据: docs/SPEC.md §4
  依据: docs/IMPLEMENTATION_PLAN.md 阶段5
  依据: ./../../ttd/VERSION.md(适配说明)

  职责:
    - 容器:Svelte 组件包装 ttd vanilla JS 5 视图
    - 适配:console HttpBackend → ttd api 对象(console-adapter.ts injectBackend)
    - 同步:console session store 的 currentSessionId → ttd store
    - 样式:console-scoped.css 限定 .ttd-root,避免污染 console light 主题

  设计:
    - Svelte 渲染 HTML 结构(sidebar + tabs + 5 panels)
    - onMount 时 ttd 在该容器内做 vanilla DOM 操作
    - ttd 的 views 通过 eventbus 通信,组件不干预内部交互
-->

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { currentSessionId } from "$lib/kernel/stores/session";
  import { useBackendOrNull } from "$lib/kernel/backend/backend-context";
  import { initTtd, cleanupTtd } from "$lib/kernel/ttd/main.js";
  import { store } from "$lib/kernel/ttd/core/store.js";
  import { eventbus, EVENTS } from "$lib/kernel/ttd/core/eventbus.js";
  import { injectBackend, syncSessionToTtd } from "$lib/kernel/ttd/console-adapter";
  import { SessionList } from "$lib/kernel/ttd/components/session-list.js";
  import "$lib/kernel/ttd/styles/console-scoped.css";

  const backend = useBackendOrNull();

  // Svelte 5: bind:this 变量需用 $state 声明,否则 svelte-check 警告 non_reactive_update
  let ttdRoot: HTMLDivElement | undefined = $state();
  let unsubSession: (() => void) | null = null;
  let unsubTtdStore: (() => void) | null = null;
  let initialized = $state(false);
  let initError = $state<string | null>(null);

  // 界面升级 v1.0 阶段 B.2 + D.1.5: 回溯模式(离开实时位)→ ttd root 加琥珀光晕 class
  // 回溯判定: selectedVersion < maxVersion 且 maxVersion > 0 (有事实且未在最新位)
  // D.1.5 新增: 顶部标签 "实时" → "⏪ N% 回溯" + 历史快照横幅 + 退出回溯按钮
  //   N% = (maxVersion - selectedVersion) / maxVersion (派生 target/current_version)
  let selectedVersion = $state(0);
  let maxVersion = $state(0);
  let rewinding = $derived(maxVersion > 0 && selectedVersion < maxVersion);
  let rewindPct = $derived(
    maxVersion > 0
      ? Math.round(((maxVersion - selectedVersion) / maxVersion) * 100)
      : 0
  );

  /** 退出回溯: 跳回最新版本(等价 ttd End 键, emit VERSION_SELECT canonical signal) */
  function exitRewind() {
    if (maxVersion > 0) eventbus.emit(EVENTS.VERSION_SELECT, maxVersion);
  }

  /** UV-084 W1-A3:手动回收已结束/已过期会话(委托 SessionList.reap,含二次确认) */
  function handleReapSessions() {
    void SessionList.reap();
  }

  onMount(async () => {
    if (!backend) {
      initError =
        "backend 未注入(开发期需要 evorule-server 跑在 127.0.0.1:18080)";
      return;
    }
    if (!ttdRoot) return;

    try {
      // 1. 注入 console backend 到 ttd api 模块
      injectBackend(backend);

      // 2. 初始化 ttd:
      //    - skipAutoSelect: evorule-console 自己管理 session(走 ExecutionPad),
      //                      不让 ttd 自动选第一个
      //    - skipApiUrl: console 通过 console-adapter 注入 backend,
      //                  ttd 不需要 apiUrl 输入框(也不渲染 header)
      await initTtd({ skipAutoSelect: true, skipApiUrl: true });
      initialized = true;

      // 3. 若 console 当前已有 session,同步给 ttd
      if ($currentSessionId !== null) {
        await syncSessionToTtd($currentSessionId);
      }

      // 4. 监听 console session 变化,自动同步给 ttd
      unsubSession = currentSessionId.subscribe(async (id) => {
        await syncSessionToTtd(id);
      });

      // 5. 订阅 ttd store,驱动琥珀色回溯光晕 (B.2) + 顶部标签/横幅 (D.1.5)
      //    只读观察 store 状态,不重写 ttd vanilla DOM 渲染逻辑。
      // ttd store 为 vanilla JS 模块(core/store.js),无 TS 类型;state 显式标注 any
      unsubTtdStore = store.subscribe((state: any) => {
        maxVersion = state.views.timeline.maxVersion;
        selectedVersion = state.selectedVersion;
      });
    } catch (e) {
      initError = `ttd 初始化失败: ${(e as Error).message}`;
    }
  });

  onDestroy(() => {
    if (unsubSession) unsubSession();
    if (unsubTtdStore) unsubTtdStore();
    cleanupTtd();
  });
</script>

<div class="time-travel-view">
  <header class="view-header">
    <div class="title-group">
      <h1>时间旅行</h1>
      <span class="subtitle"
        >可回放 — rewind / diff / causal / what-if(嵌入 ttd v1.0)</span
      >
    </div>
    <!-- D.1.5: 顶部状态标签 — 实时 / ⏪ N% 回溯(琥珀色) -->
    <span class="rewind-status" class:rewinding={rewinding} aria-live="polite">
      {#if rewinding}
        ⏪ {rewindPct}% 回溯
      {:else}
        <span class="live-dot" aria-hidden="true"></span>实时
      {/if}
    </span>
  </header>

  {#if !backend}
    <div class="empty-state">
      <span class="empty-icon">🔌</span>
      <p>backend 未注入</p>
      <p class="empty-hint">开发期需要 evorule-server 跑在 127.0.0.1:18080</p>
    </div>
  {:else if initError}
    <div class="error-banner" role="alert">
      <span>⚠</span>
      <span>{initError}</span>
    </div>
  {:else if $currentSessionId === null}
    <div class="empty-state">
      <span class="empty-icon">📭</span>
      <p>无当前 session</p>
      <p class="empty-hint">先到执行台创建 session,时间旅行视图会自动同步</p>
    </div>
  {:else}
    <!-- ttd 容器:console-scoped.css 限定 .ttd-root 内的样式作用域 -->
    <!-- B.2: 回溯模式加 time-travel-amber class(琥珀光晕 + Fact opacity 0.7) -->
    <div class="ttd-root" class:time-travel-amber={rewinding} bind:this={ttdRoot}>
      <!-- D.1.5: 历史快照横幅 — 离开实时位时显示版本号 + 退出回溯按钮 -->
      {#if rewinding}
        <div class="rewind-banner" role="status">
          <span class="banner-text"
            >📜 正在查看历史快照 · 版本 {selectedVersion}</span
          >
          <button class="exit-rewind-btn" onclick={exitRewind}>
            ✕ 退出回溯
          </button>
        </div>
      {/if}
      <div class="main">
        <aside class="sidebar">
          <div class="sidebar-header">
            <h2>会话 (Sessions)</h2>
            <!-- UV-084 W1-A3:手动回收已结束/已过期会话(生产会话保活,UV-079) -->
            <button
              class="session-reap-btn"
              title="回收已结束/已过期的会话(活跃与生产会话不受影响)"
              onclick={handleReapSessions}
            >
              ♻ 回收
            </button>
          </div>
          <ul class="session-list" id="sessionList">
            <li class="session-item">加载中...</li>
          </ul>
        </aside>
        <div class="content">
          <div class="tabs">
            <div class="tab active" data-tab="timeline" role="tab">
              ⏱ 时间线
            </div>
            <div class="tab" data-tab="state" role="tab">📦 状态</div>
            <div class="tab" data-tab="causal" role="tab">🔗 因果链</div>
            <div class="tab" data-tab="diff" role="tab">⇄ 对比</div>
            <div class="tab" data-tab="whatif" role="tab">🔀 假设</div>
          </div>

          <div class="panel active" id="panel-timeline" role="tabpanel">
            <div class="empty">从左侧选择一个 session</div>
          </div>
          <div class="panel" id="panel-state" role="tabpanel">
            <div class="empty">从左侧选择一个 session</div>
          </div>
          <div class="panel" id="panel-causal" role="tabpanel">
            <div class="empty">在「时间线」中点击一个 fact 查看因果链</div>
          </div>
          <div class="panel" id="panel-diff" role="tabpanel">
            <div class="empty">从左侧选择一个 session</div>
          </div>
          <div class="panel" id="panel-whatif" role="tabpanel">
            <div class="empty">
              🔀 What-If 分析 — 从左侧选择一个 session 开始
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .time-travel-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .view-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-md) var(--spacing-lg);
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .title-group h1 {
    margin: 0;
    font-size: var(--text-xl);
    color: var(--text-primary);
  }

  .subtitle {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-left: var(--spacing-sm);
  }

  /* ttd-root 容器占满剩余空间(高度 calc 减去 header) */
  .ttd-root {
    flex: 1;
    min-height: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 300px;
    color: var(--text-secondary);
    text-align: center;
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: var(--spacing-md);
  }

  .empty-hint {
    font-size: var(--text-xs);
    margin-top: var(--spacing-xs);
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: color-mix(in srgb, var(--danger) 10%, var(--bg-card));
    border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
    border-radius: var(--radius-md);
    color: var(--danger);
    margin: var(--spacing-lg);
  }

  /* === D.1.5 顶部状态标签 + 历史快照横幅 === */
  .rewind-status {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: 2px var(--spacing-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--text-secondary);
    background: var(--bg-card);
    white-space: nowrap;
  }

  .rewind-status.rewinding {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 50%, var(--border));
    background: color-mix(in srgb, var(--warning) 8%, var(--bg-card));
  }

  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 60%, transparent);
    animation: live-pulse 2s ease-out infinite;
  }

  @keyframes live-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 60%, transparent);
    }
    70% {
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
  }

  /* 历史快照横幅 — 叠在 ttd-root 顶部,琥珀色边框(对齐 01 §2.4) */
  .rewind-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
    padding: var(--spacing-xs) var(--spacing-md);
    background: color-mix(in srgb, var(--warning) 8%, var(--bg-card));
    border-bottom: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border));
    color: var(--warning);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    flex-shrink: 0;
  }

  .banner-text {
    font-weight: var(--font-medium);
  }

  .exit-rewind-btn {
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--warning) 50%, var(--border));
    border-radius: var(--radius-sm);
    color: var(--warning);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 2px var(--spacing-sm);
    cursor: pointer;
  }

  .exit-rewind-btn:hover {
    background: color-mix(in srgb, var(--warning) 15%, transparent);
  }
</style>
