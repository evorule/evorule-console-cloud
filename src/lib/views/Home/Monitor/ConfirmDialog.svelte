<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:通用二次确认对话框(13 按钮干预操作都需走此对话框)
    - 标题 + 说明文字 + [取消] [确认]
    - 警告级别:info / warning / danger(按钮颜色区分)
    - 支持自定义确认按钮文案
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §6.3(二次确认)
-->

<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 警告级别,影响按钮和标题颜色 */
    level?: "info" | "warning" | "danger";
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    open,
    title,
    message,
    confirmLabel = "确认",
    cancelLabel = "取消",
    level = "info",
    onConfirm,
    onCancel,
  }: Props = $props();

  const levelCls = $derived.by(() => {
    switch (level) {
      case "danger":
        return {
          btn: "btn-danger",
          title: "title-danger",
          icon: "⚠️",
        };
      case "warning":
        return {
          btn: "btn-warning",
          title: "title-warning",
          icon: "⚡",
        };
      default:
        return {
          btn: "btn-primary",
          title: "title-info",
          icon: "❓",
        };
    }
  });
</script>

{#if open}
  <div
    class="confirm-overlay"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => {
      if (e.currentTarget === e.target) onCancel();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") onCancel();
    }}
  >
    <div class="confirm-card">
      <header class="confirm-header">
        <span class={`title-icon ${levelCls.title}`}>{levelCls.icon}</span>
        <h3 class={`confirm-title ${levelCls.title}`}>{title}</h3>
      </header>
      {#if message}
        <div class="confirm-body">
          <p class="confirm-message">{message}</p>
        </div>
      {/if}
      <footer class="confirm-footer">
        <button type="button" class="btn btn-cancel" onclick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          class={`btn ${levelCls.btn}`}
          onclick={() => {
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .confirm-card {
    background: var(--bg-card);
    border-radius: 10px;
    min-width: 320px;
    max-width: 480px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    animation: slideIn 0.2s ease;
  }
  @keyframes slideIn {
    from {
      transform: translateY(-10px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  .confirm-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .title-icon {
    font-size: 18px;
  }
  .confirm-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .title-warning {
    color: var(--color-warning, #b45309);
  }
  .title-danger {
    color: #b91c1c;
  }
  .confirm-body {
    padding: 14px 18px;
  }
  .confirm-message {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--color-text-secondary, #4b5563);
    white-space: pre-wrap;
  }
  .confirm-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    background: var(--color-gray-50, #f9fafb);
    border-top: 1px solid var(--color-gray-200, #e5e7eb);
  }
  .btn {
    font-size: 13px;
    padding: 7px 16px;
    border-radius: 5px;
    border: 1px solid;
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    transition: all 0.15s ease;
  }
  .btn-cancel {
    background: var(--bg-card);
    border-color: var(--color-gray-300, #d1d5db);
    color: var(--color-text-secondary, #4b5563);
  }
  .btn-cancel:hover {
    background: var(--color-gray-100, #f3f4f6);
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    border-color: var(--color-primary, #2563eb);
    color: white;
  }
  .btn-primary:hover {
    background: var(--color-primary-dark, var(--brand, #1d4ed8));
    border-color: var(--color-primary-dark, var(--brand, #1d4ed8));
  }
  .btn-warning {
    background: #f59e0b;
    border-color: #f59e0b;
    color: white;
  }
  .btn-warning:hover {
    background: #d97706;
    border-color: #d97706;
  }
  .btn-danger {
    background: var(--color-error, #dc2626);
    border-color: var(--color-error, #dc2626);
    color: white;
  }
  .btn-danger:hover {
    background: #b91c1c;
    border-color: #b91c1c;
  }
</style>
