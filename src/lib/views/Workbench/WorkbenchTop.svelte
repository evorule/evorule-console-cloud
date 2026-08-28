<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Region 1 — 顶部状态条
    server/rule 连接状态 + workspace + 模式 + 引导任务入口
-->

<script lang="ts">
  import type { WorkspaceRecord } from "$lib/kernel";
  import type { NetMode } from "$lib/backend/types";

  interface Props {
    serverConnected: boolean | null;
    ruleConnected: boolean | null;
    ws: WorkspaceRecord | null;
    mode: NetMode;
    consoleVersion: string;
    refreshing: boolean;
    lastRefreshAt: Date | null;
    onRefresh: () => void;
    onShowOnboarding: () => void;
  }

  let {
    serverConnected,
    ruleConnected,
    ws,
    mode,
    consoleVersion,
    refreshing,
    lastRefreshAt,
    onRefresh,
    onShowOnboarding,
  }: Props = $props();

  function fmtTime(d: Date | null): string {
    if (!d) return "—";
    return d.toLocaleTimeString("zh-CN", { hour12: false });
  }
</script>

<div class="region-status">
  <div class="status-item" class:offline={serverConnected === false}>
    <span class="dot" class:dot-gray={serverConnected === false} class:dot-green={serverConnected === true} class:dot-checking={serverConnected === null}></span>
    <span class="label">server</span>
    <span class="value">{serverConnected === null ? "检测中" : serverConnected ? "● 已连接" : "○ 离线"}</span>
  </div>
  <div class="status-item" class:offline={ruleConnected === false}>
    <span class="dot" class:dot-gray={ruleConnected === false} class:dot-green={ruleConnected === true} class:dot-checking={ruleConnected === null}></span>
    <span class="label">rule</span>
    <span class="value">{ruleConnected === null ? "检测中" : ruleConnected ? "● 已连接" : "○ 离线"}</span>
  </div>

  <div class="status-divider"></div>

  <div class="status-item">
    <span class="label">workspace:</span>
    <span class="value">{ws ? ws.name : "(无)"}</span>
  </div>
  <div class="status-item">
    <span class="label">模式:</span>
    <span class="value">{mode === "online" ? "☁ 联网" : "🖥 离线"}</span>
  </div>

  <div class="status-divider"></div>

  <div class="status-item">
    <span class="label">server:</span>
    <span class="value">evorule-server v{consoleVersion} (18090)</span>
  </div>
  <div class="status-item">
    <span class="label">rule:</span>
    <span class="value">evorule-rule v{consoleVersion} (18081)</span>
  </div>

  <div class="status-divider"></div>

  <span class="status-meta">最近刷新: {fmtTime(lastRefreshAt)}</span>
  <button
    class="status-btn"
    onclick={onRefresh}
    disabled={refreshing}
    title="立即刷新所有数据"
  >
    {#if refreshing}⏳ 刷新中{:else}🔄 刷新{/if}
  </button>
  <button
    class="status-btn"
    onclick={onShowOnboarding}
    title="查看 4 步引导任务"
  >
    📋 4 引导任务
  </button>
  <a
    class="status-btn"
    href="/help"
    title="打开帮助页(5 分钟上手 + 详细使用指南)"
  >
    ❓ 帮助
  </a>
</div>

<style>
  .region-status {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .status-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .status-item.offline .value {
    color: var(--error, #dc2626);
  }
  .status-item .label {
    color: var(--text-muted);
  }
  .status-item .value {
    color: var(--text-primary);
    font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-green { background: var(--success, #16a34a); }
  .dot-gray { background: var(--text-muted); }
  .dot-checking {
    background: var(--warning, #ea580c);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .status-divider {
    width: 1px;
    height: 16px;
    background: var(--border);
  }
  .status-meta {
    font-size: 11px;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
  }
  .status-btn {
    padding: 6px 12px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .status-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .status-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
