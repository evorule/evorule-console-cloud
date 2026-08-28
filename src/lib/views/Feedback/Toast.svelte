<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一 Toast 通知组件
    - 4 类:success / error / warning / info
    - 自动消失(success/info 4s,warning 5s,error 6s)
    - 队列最多 3 条,先进先出
    - 支持手动关闭(× 按钮)
  依赖:toastStore
-->

<script lang="ts">
  import { toastStore, dismissToast } from "$lib/stores/toast";

  const toasts = $derived($toastStore);
</script>

{#if toasts.length > 0}
  <div class="toast-container" role="region" aria-label="通知">
    {#each toasts as toast (toast.id)}
      <div class={`toast toast-${toast.type}`} role="alert">
        <span class="toast-icon">
          {#if toast.type === "success"}✅{/if}
          {#if toast.type === "error"}❌{/if}
          {#if toast.type === "warning"}⚠️{/if}
          {#if toast.type === "info"}ℹ️{/if}
        </span>
        <div class="toast-content">
          {#if toast.title}
            <div class="toast-title">{toast.title}</div>
          {/if}
          <div class="toast-message">{toast.message}</div>
        </div>
        <button
          class="toast-close"
          onclick={() => dismissToast(toast.id)}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 360px;
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slide-in 0.3s ease-out;
  }
  .toast-success {
    background: var(--success-bg, #f0fdf4);
    border-left: 4px solid var(--success, #22c55e);
  }
  .toast-error {
    background: var(--danger-bg, #fef2f2);
    border-left: 4px solid var(--danger, #ef4444);
  }
  .toast-warning {
    background: var(--warning-bg, #fffbeb);
    border-left: 4px solid var(--warning, #f59e0b);
  }
  .toast-info {
    background: var(--info-bg, #f0f9ff);
    border-left: 4px solid var(--info, #3b82f6);
  }
  .toast-icon {
    font-size: 16px;
  }
  .toast-content {
    flex: 1;
  }
  .toast-title {
    font-weight: 600;
    margin-bottom: 2px;
  }
  .toast-message {
    font-size: 14px;
    color: var(--text-secondary, #6b7280);
  }
  .toast-close {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary, #6b7280);
    padding: 0;
    line-height: 1;
  }
  .toast-close:hover {
    color: var(--text-primary, #1f2937);
  }
  @keyframes slide-in {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
</style>
