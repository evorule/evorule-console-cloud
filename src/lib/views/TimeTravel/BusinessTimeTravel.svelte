<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:业务时间旅行主视图(P06 §6.3 + §8.2)
    - 包装内核 TimeTravelView(开发者模式 = 纯 ttd)
    - 业务模式:ttd + 右侧 TermOverlay(业务术语翻译面板)
    - 模式 toggle 持久化到 localStorage
    - 回滚请求委托父组件处理(不在本视图直调 backend API)
  设计决策:
    - 不用 MutationObserver 注入 DOM(P0 简化,避免脆弱)
    - 用侧栏翻译面板:用户在 ttd 点 fact → 这里显示业务化版本
  关联设计:P06_BUSINESS_AUDIT_TT_DESIGN.md §3.5 + §6.3 + §8.2
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { TimeTravelView } from "@evorule/console";
  import TermOverlay from "./TermOverlay.svelte";
  import ConfirmDialog from "../Home/Monitor/ConfirmDialog.svelte";
  import { toastInfo } from "$lib/stores/toast";

  interface Props {
    /** 回滚请求回调(由父组件处理实际回滚 API) */
    onRollbackRequest?: (targetVersion: number) => void;
  }

  let { onRollbackRequest }: Props = $props();

  let mode = $state<"business" | "developer">("business");
  let showRollbackConfirm = $state(false);
  let rollbackTarget = $state<number | null>(null);

  onMount(() => {
    const saved =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("evorule:timetravel-mode")
        : null;
    if (saved === "business" || saved === "developer") {
      mode = saved;
    }
  });

  function handleToggleMode(): void {
    mode = mode === "business" ? "developer" : "business";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("evorule:timetravel-mode", mode);
    }
  }

  function handleRollbackRequest(factId: number): void {
    rollbackTarget = factId;
    showRollbackConfirm = true;
  }

  function handleConfirmRollback(): void {
    showRollbackConfirm = false;
    if (rollbackTarget !== null) {
      onRollbackRequest?.(rollbackTarget);
      toastInfo(`回滚请求已提交: ruleset v${rollbackTarget}`);
    }
    rollbackTarget = null;
  }

  function handleCancelRollback(): void {
    showRollbackConfirm = false;
    rollbackTarget = null;
  }
</script>

<div class="business-time-travel">
  <header class="btt-toolbar">
    <div class="btt-title-group">
      <h2 class="btt-title">⏪ 业务时间旅行</h2>
      <span class="btt-subtitle">
        {mode === "business"
          ? "业务模式 — ttd 5 视图 + 业务术语翻译"
          : "开发者模式 — 纯 ttd v1.0(raw)"}
      </span>
    </div>
    <button
      class="btt-mode-btn"
      class:active-business={mode === "business"}
      class:active-developer={mode === "developer"}
      onclick={handleToggleMode}
      title="切换业务/开发者模式"
    >
      {mode === "business" ? "🔧 切换到开发者" : "🏷 切换到业务"}
    </button>
  </header>

  <div class="btt-content" class:dev-mode={mode === "developer"}>
    <div class="btt-ttd-wrapper">
      <TimeTravelView />
    </div>
    {#if mode === "business"}
      <TermOverlay onRollbackRequest={handleRollbackRequest} />
    {/if}
  </div>
</div>

{#if showRollbackConfirm && rollbackTarget !== null}
  <ConfirmDialog
    open={showRollbackConfirm}
    title="一键回滚"
    message={`确认回滚到 ruleset v${rollbackTarget}?将用旧规则产生新版本,触发滚动 session 热重载。`}
    confirmLabel="确认回滚"
    level="danger"
    onConfirm={handleConfirmRollback}
    onCancel={handleCancelRollback}
  />
{/if}

<style>
  .business-time-travel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .btt-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    background: white;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .btt-title-group {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }
  .btt-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .btt-subtitle {
    font-size: 11px;
    color: var(--color-gray-500, #6b7280);
  }
  .btt-mode-btn {
    font-size: 11px;
    padding: 5px 10px;
    border-radius: 5px;
    border: 1px solid;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    background: white;
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .btt-mode-btn.active-business {
    background: #eff6ff;
    border-color: #93c5fd;
    color: #1e40af;
  }
  .btt-mode-btn.active-developer {
    background: #f3f4f6;
    border-color: var(--color-gray-400, #9ca3af);
    color: var(--color-gray-700, #374151);
  }

  .btt-content {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  .btt-content.dev-mode {
    /* 开发者模式:ttd 占满,无侧栏 */
    display: block;
  }
  .btt-ttd-wrapper {
    flex: 1;
    min-width: 0;
    overflow: auto;
  }
</style>
