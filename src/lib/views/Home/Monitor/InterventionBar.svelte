<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:13 按钮干预栏(右侧操作区,所有操作走二次确认)
    13 操作:
      常规(4):暂停 reactor / 恢复 reactor / 手动 GC / 触发 invariant 检查
      发布(3):开始发布会话 / 进入审批模式 / 导出发布包
      Session(2):切换 session / 紧急回滚
      IO(2):取消全部待处理 IO / 注入心跳
      审计(2):导出审计链 / 强制轮换 WAL
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §6.3(13 按钮 + 二次确认)
-->

<script lang="ts">
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import RollbackVersionPicker from "./RollbackVersionPicker.svelte";
  import { getCurrentUser } from "$lib/stores/auth";
  import {
    ACTION_TO_CONFIRM,
    canPerform as logicCanPerform,
    permissionTooltip as logicPermissionTooltip,
    type InterventionAction as LogicAction,
  } from "./intervention-bar-logic";

  export type InterventionAction = LogicAction;

  interface Props {
    currentRulesetVersion: number;
    /** 所有操作都通过 onAction 回调抛出,由实际接入方处理 HTTP/逻辑 */
    onAction: (action: InterventionAction, payload?: unknown) => void;
    /** 是否禁用(例如 offline/switching 状态禁用) */
    disabled?: boolean;
  }

  /** 取当前用户角色(未登录 → null),喂给纯函数层 */
  function currentRole() {
    return getCurrentUser()?.role ?? null;
  }

  function canPerform(action: InterventionAction): boolean {
    return logicCanPerform(currentRole(), action);
  }

  function permissionTooltip(action: InterventionAction): string {
    return logicPermissionTooltip(currentRole(), action);
  }

  let { currentRulesetVersion, onAction, disabled = false }: Props = $props();

  // === Confirm Dialog 状态 ===
  let confirmOpen = $state(false);
  let confirmTitle = $state("确认操作?");
  let confirmMessage = $state<string | undefined>(undefined);
  let confirmLevel: "info" | "warning" | "danger" = $state("info");
  let confirmLabel = $state("确认");
  let pendingAction: InterventionAction | null = $state(null);

  // === Rollback Picker 状态 ===
  let rollbackOpen = $state(false);

  function request(action: InterventionAction) {
    const spec = ACTION_TO_CONFIRM[action];
    pendingAction = action;
    confirmTitle = spec.title;
    confirmMessage = spec.message;
    confirmLevel = spec.level;
    confirmLabel = spec.confirmLabel;
    confirmOpen = true;
  }

  function handleConfirm() {
    const a = pendingAction;
    confirmOpen = false;
    pendingAction = null;
    if (a) onAction(a);
  }
  function handleCancel() {
    confirmOpen = false;
    pendingAction = null;
  }

  function openRollback() {
    rollbackOpen = true;
  }
  function handlePickRollback(v: number) {
    rollbackOpen = false;
    onAction("session.rollback", { toVersion: v });
  }

  const btnBaseCls = "iv-btn";
</script>

<div class="iv-bar" aria-label="干预操作栏">
  <header class="iv-header">
    <h3 class="iv-title">🛠 干预操作</h3>
    <span class="iv-hint">所有操作均需二次确认</span>
  </header>

  <!-- Reactor -->
  <section class="iv-section">
    <div class="iv-sec-title">Reactor</div>
    <div class="iv-grid">
      <button
        class={`${btnBaseCls} iv-secondary`}
        disabled={disabled || !canPerform("reactor.pause")}
        title={permissionTooltip("reactor.pause")}
        onclick={() => request("reactor.pause")}
      >
        ⏸ 暂停
      </button>
      <button
        class={`${btnBaseCls} iv-success`}
        disabled={disabled || !canPerform("reactor.resume")}
        title={permissionTooltip("reactor.resume")}
        onclick={() => request("reactor.resume")}
      >
        ▶ 恢复
      </button>
      <button
        class={`${btnBaseCls} iv-info`}
        disabled={disabled || !canPerform("reactor.gc")}
        title={permissionTooltip("reactor.gc")}
        onclick={() => request("reactor.gc")}
      >
        🗑 手动 GC
      </button>
      <button
        class={`${btnBaseCls} iv-info`}
        disabled={disabled || !canPerform("reactor.check_invariants")}
        title={permissionTooltip("reactor.check_invariants")}
        onclick={() => request("reactor.check_invariants")}
      >
        🔍 不变量检查
      </button>
    </div>
  </section>

  <!-- 发布 -->
  <section class="iv-section">
    <div class="iv-sec-title">发布 / 审批</div>
    <div class="iv-grid">
      <button
        class={`${btnBaseCls} iv-primary`}
        disabled={disabled || !canPerform("publish.start_session")}
        title={permissionTooltip("publish.start_session")}
        onclick={() => request("publish.start_session")}
      >
        🆕 发布会话
      </button>
      <button
        class={`${btnBaseCls} iv-warning`}
        disabled={disabled || !canPerform("publish.approve_mode")}
        title={permissionTooltip("publish.approve_mode")}
        onclick={() => request("publish.approve_mode")}
      >
        🧑‍⚖️ 审批模式
      </button>
      <button
        class={`${btnBaseCls} iv-secondary`}
        disabled={disabled || !canPerform("publish.export_package")}
        title={permissionTooltip("publish.export_package")}
        onclick={() => request("publish.export_package")}
      >
        📦 导出发布包
      </button>
    </div>
  </section>

  <!-- Session -->
  <section class="iv-section">
    <div class="iv-sec-title">Session</div>
    <div class="iv-grid">
      <button
        class={`${btnBaseCls} iv-secondary`}
        {disabled}
        onclick={() => request("session.switch")}
      >
        🔀 切换 Session
      </button>
      <button
        class={`${btnBaseCls} iv-danger`}
        disabled={disabled || !canPerform("session.rollback")}
        title={permissionTooltip("session.rollback")}
        onclick={openRollback}
      >
        ⏪ 紧急回滚
      </button>
    </div>
  </section>

  <!-- IO -->
  <section class="iv-section">
    <div class="iv-sec-title">IO / 心跳</div>
    <div class="iv-grid">
      <button
        class={`${btnBaseCls} iv-warning`}
        disabled={disabled || !canPerform("io.cancel_all_pending")}
        title={permissionTooltip("io.cancel_all_pending")}
        onclick={() => request("io.cancel_all_pending")}
      >
        ✋ 取消全部 IO
      </button>
      <button
        class={`${btnBaseCls} iv-info`}
        disabled={disabled || !canPerform("io.inject_heartbeat")}
        title={permissionTooltip("io.inject_heartbeat")}
        onclick={() => request("io.inject_heartbeat")}
      >
        💓 心跳注入
      </button>
    </div>
  </section>

  <!-- 审计 / WAL -->
  <section class="iv-section">
    <div class="iv-sec-title">审计 / WAL</div>
    <div class="iv-grid">
      <button
        class={`${btnBaseCls} iv-secondary`}
        disabled={disabled || !canPerform("audit.export_chain")}
        title={permissionTooltip("audit.export_chain")}
        onclick={() => request("audit.export_chain")}
      >
        🔗 导出审计链
      </button>
      <button
        class={`${btnBaseCls} iv-secondary`}
        disabled={disabled || !canPerform("wal.force_rotate")}
        title={permissionTooltip("wal.force_rotate")}
        onclick={() => request("wal.force_rotate")}
      >
        🔄 轮换 WAL
      </button>
    </div>
  </section>
</div>

<!-- 通用二次确认 -->
<ConfirmDialog
  open={confirmOpen}
  title={confirmTitle}
  message={confirmMessage}
  {confirmLabel}
  level={confirmLevel}
  onConfirm={handleConfirm}
  onCancel={handleCancel}
/>

<!-- 紧急回滚:版本选择(嵌套在 overlay 中) -->
{#if rollbackOpen}
  <div
    class="iv-rb-overlay"
    role="presentation"
    onclick={(e) => {
      if (e.currentTarget === e.target) rollbackOpen = false;
    }}
  >
    <RollbackVersionPicker
      currentVersion={currentRulesetVersion}
      onPickVersion={handlePickRollback}
      onCancel={() => (rollbackOpen = false)}
    />
  </div>
{/if}

<style>
  .iv-bar {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    overflow-y: auto;
    min-height: 0;
  }
  .iv-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px;
    padding-bottom: 6px;
    border-bottom: 1px dashed var(--color-gray-200, #e5e7eb);
  }
  .iv-title {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .iv-hint {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .iv-section {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .iv-sec-title {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.03em;
  }
  .iv-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 5px;
  }
  .iv-btn {
    font-size: 11px;
    padding: 6px 8px;
    border-radius: 5px;
    border: 1px solid;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    transition: all 0.12s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .iv-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: grayscale(0.3);
  }
  .iv-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .iv-primary:hover:not(:disabled) {
    background: #1d4ed8;
    border-color: #1d4ed8;
  }
  .iv-secondary {
    background: white;
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .iv-secondary:hover:not(:disabled) {
    background: var(--color-gray-50, #f9fafb);
  }
  .iv-success {
    background: #10b981;
    border-color: #10b981;
    color: white;
  }
  .iv-success:hover:not(:disabled) {
    background: #059669;
    border-color: #059669;
  }
  .iv-info {
    background: #eff6ff;
    border-color: #93c5fd;
    color: #1e40af;
  }
  .iv-info:hover:not(:disabled) {
    background: #dbeafe;
  }
  .iv-warning {
    background: #fff7ed;
    border-color: #fdba74;
    color: #9a3412;
  }
  .iv-warning:hover:not(:disabled) {
    background: #ffedd5;
  }
  .iv-danger {
    background: #fee2e2;
    border-color: #fca5a5;
    color: #991b1b;
  }
  .iv-danger:hover:not(:disabled) {
    background: #fecaca;
  }
  .iv-rb-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }
</style>
