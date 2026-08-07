<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:SSE 连接状态横幅(顶部,按状态显示不同颜色+文案)
    - connecting:黄色 "连接中..."
    - connected:绿色 "已连接" + lastConnectedAt
    - reconnecting:橙色 "重连中(第 N 次)..."
    - degraded:紫色 "降级模式(轮询)"
    - disconnected:灰色 "未连接"
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.4 + §7.3(连接状态展示)
-->

<script lang="ts">
  import type { ConnectionState } from "$lib/stores/sse-connection";

  interface Props {
    state: ConnectionState;
  }

  let { state }: Props = $props();

  const cfg = $derived.by(() => {
    switch (state.status) {
      case "connected":
        return {
          bg: "var(--color-success-bg, #f0fdf4)",
          fg: "var(--color-success, #16a34a)",
          border: "#86efac",
          icon: "✅",
          text: "已连接",
          sub: state.lastConnectedAt
            ? `自 ${new Date(state.lastConnectedAt).toLocaleTimeString()} 起`
            : "",
          pulse: true,
        };
      case "connecting":
        return {
          bg: "var(--color-warning-bg, #fffbeb)",
          fg: "var(--color-warning, #d97706)",
          border: "#fcd34d",
          icon: "🔗",
          text: "连接中...",
          sub: "正在建立 SSE 长连接",
          pulse: true,
        };
      case "reconnecting":
        return {
          bg: "#fff7ed",
          fg: "#c2410c",
          border: "#fdba74",
          icon: "🔁",
          text: `重连中(第 ${state.retryCount} 次)...`,
          sub: state.lastError ?? "网络波动,尝试指数退避重连",
          pulse: true,
        };
      case "degraded":
        return {
          bg: "#faf5ff",
          fg: "#7e22ce",
          border: "#d8b4fe",
          icon: "⚠️",
          text: "降级模式",
          sub: state.lastError ?? "SSE 不可用,以 5s 轮询代替",
          pulse: false,
        };
      case "disconnected":
      default:
        return {
          bg: "var(--color-gray-50, #f9fafb)",
          fg: "var(--color-gray-500, #6b7280)",
          border: "var(--color-gray-200, #e5e7eb)",
          icon: "⛔",
          text: "未连接",
          sub: "未订阅任何 session 的事件流",
          pulse: false,
        };
    }
  });
</script>

<div
  class="connection-banner"
  style={`background: ${cfg.bg}; border-color: ${cfg.border}; color: ${cfg.fg};`}
>
  <span class="icon" class:pulse={cfg.pulse}>{cfg.icon}</span>
  <div class="texts">
    <div class="main-text">{cfg.text}</div>
    {#if cfg.sub}
      <div class="sub-text">{cfg.sub}</div>
    {/if}
  </div>
  {#if state.status === "reconnecting" || state.status === "degraded"}
    <div class="spinner-mini" class:spin={cfg.pulse}></div>
  {/if}
</div>

<style>
  .connection-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border: 1px solid;
    border-radius: 6px;
    font-size: 12px;
    flex-shrink: 0;
  }
  .icon {
    font-size: 14px;
  }
  .icon.pulse {
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }
  .texts {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .main-text {
    font-weight: 600;
    line-height: 1.2;
  }
  .sub-text {
    font-size: 11px;
    opacity: 0.85;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spinner-mini {
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .spinner-mini.spin {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
