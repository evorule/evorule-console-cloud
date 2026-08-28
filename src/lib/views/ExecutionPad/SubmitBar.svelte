<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:提交栏(底部:提交结果状态 + 提交按钮 + 重新翻译 + 清空)
    - 提交结果:lastResult 摘要(Fact ID + 触发规则数 + 耗时)
    - [提交到 session]按钮(需要 instruction translated 状态)
    - [重新翻译] / [清空] 辅助按钮
  关联设计:P04_BUSINESS_EXECUTION_PAD_DESIGN.md §6.3(底部操作栏) + §7.1(提交流)
-->

<script lang="ts">
  import type { CommandResult } from "$lib/kernel";
  import type { TranslateStatus } from "$lib/stores/business-event";

  interface Props {
    translateStatus: TranslateStatus;
    hasInstruction: boolean;
    lastResult: CommandResult | null;
    lastSubmittedAt: string | null;
    submitting?: boolean;
    onSubmit: () => void;
    onRetranslate: () => void;
    onClear: () => void;
    disabled?: boolean;
  }

  let {
    translateStatus,
    hasInstruction,
    lastResult,
    lastSubmittedAt,
    submitting = false,
    onSubmit,
    onRetranslate,
    onClear,
    disabled = false,
  }: Props = $props();

  const canSubmit = $derived(
    !disabled &&
      !submitting &&
      hasInstruction &&
      (translateStatus === "translated" || translateStatus === "error"),
  );
</script>

<div class="submit-bar">
  <!-- 上一次提交结果(左) -->
  <div class="result-area">
    {#if lastResult}
      <div
        class="result-card"
        class:ok={lastResult.accepted}
        class:fail={!lastResult.accepted}
      >
        <span class="result-icon">{lastResult.accepted ? "✅" : "❌"}</span>
        <div class="result-body">
          <div class="result-title">
            {lastResult.accepted ? "提交成功" : "提交失败"}
            {#if lastSubmittedAt}
              <span class="result-time">
                · {new Date(lastSubmittedAt).toLocaleTimeString()}
              </span>
            {/if}
          </div>
          <div class="result-meta">
            {#if lastResult.accepted}
              <span>✓ 已接受</span>
              {#if lastResult.version !== undefined}
                <span>· v{lastResult.version}</span>
              {/if}
            {:else}
              <span class="result-err">{lastResult.error ?? "未知错误"}</span>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div class="result-empty">
        <span class="empty-icon">📤</span>
        <span>尚未提交。填写数据→翻译→提交。</span>
      </div>
    {/if}
  </div>

  <!-- 操作按钮(右) -->
  <div class="actions">
    <button
      type="button"
      class="btn btn-ghost"
      onclick={onClear}
      disabled={disabled || submitting}
      title="清空当前事件"
    >
      🗑 清空
    </button>
    <button
      type="button"
      class="btn btn-secondary"
      onclick={onRetranslate}
      disabled={disabled || submitting || translateStatus === "translating"}
      title="重新调用 LLM 翻译"
    >
      🔄 重新翻译
    </button>
    <button
      type="button"
      class="btn btn-primary btn-submit"
      onclick={onSubmit}
      disabled={!canSubmit}
      title={canSubmit
        ? "提交到生产 session 运行"
        : "需先翻译为 instruction JSON"}
    >
      {#if submitting}
        <span class="spinner"></span>
        提交中...
      {:else}
        🚀 提交到 Session
      {/if}
    </button>
  </div>
</div>

<style>
  .submit-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 14px;
    background: var(--bg-page, #f8fafc);
    border-top: 1px solid var(--border, #e2e8f0);
    flex-wrap: wrap;
  }
  .result-area {
    flex: 1;
    min-width: 280px;
  }
  .result-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid;
  }
  .result-card.ok {
    background: var(--success-bg, #d1fae5);
    border-color: #6ee7b7;
  }
  .result-card.fail {
    background: var(--danger-bg, #fee2e2);
    border-color: var(--danger, #fca5a5);
  }
  .result-icon {
    font-size: 16px;
  }
  .result-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .result-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  .result-time {
    font-weight: 400;
    color: var(--text-secondary, #64748b);
    font-size: 11px;
  }
  .result-meta {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .result-card.fail .result-err {
    color: var(--danger, #991b1b);
    font-weight: 500;
  }
  .result-empty {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }
  .empty-icon {
    font-size: 14px;
  }
  .actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .btn {
    font-size: 12px;
    padding: 7px 14px;
    border: 1px solid var(--border, #cbd5e1);
    border-radius: 4px;
    background: var(--bg-card);
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text-secondary, #64748b);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--bg-hover, #f1f5f9);
  }
  .btn-secondary {
    background: var(--bg-card);
    color: var(--text-primary, #1e293b);
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover, #f1f5f9);
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    border-color: var(--brand, #2563eb);
    color: white;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--brand-hover, var(--brand, #1d4ed8));
    border-color: var(--brand-hover, var(--brand, #1d4ed8));
  }
  .btn-submit {
    font-weight: 600;
    min-width: 140px;
    justify-content: center;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
