<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:U7 滚动 Session 切换 Toast(顶部滑入滑出)
    - 显示切换原因 + 旧版本→新版本
    - 显示 3s 后自动消失
    - 点击可查看详情 / 手动关闭
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §7.3(U7 切换通知) + §4.3(SessionSwitched)
-->

<script lang="ts">
  interface Props {
    visible: boolean;
    newSessionId: number;
    newVersion: number;
    oldSessionId: number | null;
    oldVersion: number | null;
    reason: string;
    onClose: () => void;
    /** 自动关闭毫秒,0 = 不自动关闭 */
    autoCloseMs?: number;
  }

  let {
    visible,
    newSessionId,
    newVersion,
    oldSessionId,
    oldVersion,
    reason,
    onClose,
    autoCloseMs = 5000,
  }: Props = $props();

  const reasonText = $derived(reasonToText(reason));
  function reasonToText(r: string): string {
    switch (r) {
      case "ruleset_published":
        return "新规则集发布";
      case "rollback":
        return "紧急回滚";
      case "manual_switch":
        return "手动切换";
      case "session_closed":
        return "旧 Session 关闭";
      default:
        return r || "未知原因";
    }
  }

  $effect(() => {
    if (!visible || autoCloseMs <= 0) return;
    const t = setTimeout(() => onClose(), autoCloseMs);
    return () => clearTimeout(t);
  });
</script>

{#if visible}
  <div class="ss-toast" role="status" aria-live="polite">
    <div class="ss-left">
      <span class="ss-icon">🔄</span>
      <div class="ss-texts">
        <div class="ss-title">Session 已切换</div>
        <div class="ss-reason">原因:{reasonText}</div>
        <div class="ss-versions">
          {#if oldVersion !== null && oldVersion !== undefined}
            <span class="ss-old">v{oldVersion}</span>
            <span class="ss-arrow">→</span>
          {/if}
          <span class="ss-new">v{newVersion}</span>
          <span class="ss-session-hint">
            (Session #{oldSessionId ?? "?"} → #{newSessionId})
          </span>
        </div>
      </div>
    </div>
    <button type="button" class="ss-close" onclick={onClose} aria-label="关闭">
      ✕
    </button>
  </div>
{/if}

<style>
  .ss-toast {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background: linear-gradient(135deg, var(--brand, #7c3aed), #2563eb);
    color: white;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(37, 99, 235, 0.4);
    max-width: 540px;
    min-width: 320px;
    animation: toastIn 0.35s ease;
  }
  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translate(-50%, -20px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  .ss-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .ss-icon {
    font-size: 20px;
    animation: spin 1.2s ease-out;
  }
  @keyframes spin {
    from { transform: rotate(-180deg); opacity: 0; }
    to { transform: rotate(0); opacity: 1; }
  }
  .ss-texts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ss-title {
    font-size: 13px;
    font-weight: 700;
  }
  .ss-reason {
    font-size: 11px;
    opacity: 0.9;
  }
  .ss-versions {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
    flex-wrap: wrap;
  }
  .ss-old {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 5px;
    text-decoration: line-through;
  }
  .ss-arrow {
    font-size: 11px;
    opacity: 0.85;
  }
  .ss-new {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 5px;
    font-weight: 700;
  }
  .ss-session-hint {
    font-size: 10px;
    opacity: 0.75;
  }
  .ss-close {
    background: transparent;
    border: none;
    color: white;
    opacity: 0.85;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .ss-close:hover {
    background: rgba(255, 255, 255, 0.15);
    opacity: 1;
  }
</style>
