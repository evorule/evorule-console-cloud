<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:监控大屏主视图(L1)
    - 顶部:ConnectionBanner + 生产状态版本展示
    - 中上:ReactorStateBar
    - 中左:FactStreamView(Fact 流虚拟列表)
    - 右上:AnomalyPanel(异常告警)
    - 右下:PerformanceMetrics(性能指标)
    - 右:InterventionBar(13 按钮 + 二次确认 + 回滚)
    - 浮层:SessionSwitchToast(U7 切换)
    - 生命周期:mount → 拉 productionState + startSSE + startReactorPolling + startMetricsPolling;unmount 清理
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §6(整体布局) + §7(数据流/生命周期)
-->

<script lang="ts">
  import { get } from "svelte/store";
  import { onMount, onDestroy } from "svelte";
  // === Stores ===
  import type { ProductionState } from "$lib/stores/production-state";
  import {
    productionStateStore,
    DEFAULT_PRODUCTION_STATE,
    onSessionSwitched as productionOnSessionSwitched,
    setSessionSwitchHandler,
    refreshProductionState,
    fetchProductionState,
  } from "$lib/stores/production-state";
  import {
    sseConnectionStore,
    startSSE,
    stopSSE,
  } from "$lib/stores/sse-connection";
  import type { SessionSwitchedEvent } from "$lib/stores/sse-events";
  import {
    reactorRuntimeStore,
    startReactorPolling,
    stopReactorPolling,
  } from "$lib/stores/reactor-runtime";
  import {
    performanceMetricsStore,
    DEFAULT_METRICS,
    startMetricsPolling,
    stopMetricsPolling,
  } from "$lib/stores/performance-metrics";
  import { toastInfo } from "$lib/stores/toast";
  // T4: P07 ExportDialog(InterventionBar 的 audit.export_chain 触发)
  import ExportDialog from "$lib/views/Export/ExportDialog.svelte";
  import type { ExportContentType } from "$lib/stores/export-types";

  // === Sub Components ===
  import ConnectionBanner from "./ConnectionBanner.svelte";
  import ReactorStateBar from "./ReactorStateBar.svelte";
  import FactStreamView from "./FactStreamView.svelte";
  import AnomalyPanel from "./AnomalyPanel.svelte";
  import PerformanceMetrics from "./PerformanceMetrics.svelte";
  import InterventionBar, {
    type InterventionAction,
  } from "./InterventionBar.svelte";
  import SessionSwitchToast from "./SessionSwitchToast.svelte";

  interface Props {
    /** evorule-server 基地址(默认 http://127.0.0.1:18080) */
    baseUrl?: string;
    /** 外部干预回调(真实部署时调用 API,演示模式 toast 提示) */
    onIntervention?: (action: InterventionAction, payload?: unknown) => void;
  }

  let {
    baseUrl = "http://127.0.0.1:18080",
    onIntervention: externalIntervention,
  }: Props = $props();

  // === SessionSwitchToast 展示态 ===
  let ssToastVisible = $state(false);
  let ssToastNewSessionId = $state(0);
  let ssToastNewVersion = $state(0);
  let ssToastOldSessionId: number | null = $state(null);
  let ssToastOldVersion: number | null = $state(null);
  let ssToastReason = $state("");

  // === T4: P07 ExportDialog 状态(audit.export_chain 触发) ===
  let exportOpen = $state(false);
  let exportPreset = $state<{ contents?: ExportContentType[] } | undefined>(
    undefined,
  );

  // 订阅 store 快照(供模板使用)
  let productionState: ProductionState = $derived($productionStateStore);
  let sseConn = $derived($sseConnectionStore);
  let reactor = $derived($reactorRuntimeStore);
  let metrics = $derived($performanceMetricsStore ?? DEFAULT_METRICS);

  // === U7 SSE session_switched 回调(生产态切换) ===
  function handleU7Switched(e: SessionSwitchedEvent) {
    const d = e.data;
    // 快照:切换前旧值
    const oldState = get(productionStateStore);
    ssToastOldSessionId = oldState.currentSessionId;
    ssToastOldVersion = oldState.rulesetVersion;
    ssToastNewSessionId = d.new_session_id;
    ssToastNewVersion = d.new_ruleset_version;
    ssToastReason = d.reason;
    // 更新 production store(会触发内部 SSE 重连)
    productionOnSessionSwitched(d.new_session_id, d.new_ruleset_version);
    // 显示 Toast
    ssToastVisible = true;
  }

  // === 启动 ===
  onMount(async () => {
    // 1. 拉 production state
    await refreshProductionState(async () => fetchProductionState(baseUrl));
    // 2. 设置 U7 handler
    setSessionSwitchHandler((newSid, newVer) => {
      // SSE 重连:关闭旧,订阅新
      stopSSE();
      startSSE(newSid, baseUrl, handleU7Switched);
    });
    const ps = get(productionStateStore);
    // 3. SSE Fact/anomaly/切换 订阅
    if (ps.currentSessionId !== null && ps.status !== "offline") {
      startSSE(ps.currentSessionId, baseUrl, handleU7Switched);
    }
    // 4. Reactor 2s 轮询
    if (ps.currentSessionId !== null) {
      startReactorPolling(ps.currentSessionId, baseUrl);
    }
    // 5. 性能 5s 轮询
    startMetricsPolling(baseUrl);
  });

  onDestroy(() => {
    stopSSE();
    stopReactorPolling();
    stopMetricsPolling();
  });

  // === 干预按钮回调(默认实现:Toast,外部可覆盖) ===
  function handleIntervention(action: InterventionAction, payload?: unknown) {
    // T4: audit.export_chain 拦截 → 打开 P07 ExportDialog(preset: audit_chain)
    // 即使有 externalIntervention,导出对话框也在本组件内打开(属于 UI 行为,不属于外部 API)
    if (action === "audit.export_chain") {
      exportPreset = { contents: ["audit_chain"] };
      exportOpen = true;
      // 同时通知外部(若提供),保持可观测性
      externalIntervention?.(action, payload);
      return;
    }
    if (externalIntervention) {
      externalIntervention(action, payload);
      return;
    }
    // 默认 demo 实现:显示 toast
    const map: Partial<Record<InterventionAction, string>> = {
      "reactor.pause": "Reactor 暂停",
      "reactor.resume": "Reactor 恢复",
      "reactor.gc": "手动 GC 触发",
      "reactor.check_invariants": "不变量检查启动",
      "publish.start_session": "发布会话创建",
      "publish.approve_mode": "审批模式切换",
      "publish.export_package": "发布包导出开始",
      "session.switch": "Session 切换触发",
      "session.rollback": `紧急回滚到 v${(payload as { toVersion?: number })?.toVersion ?? "?"}`,
      "io.cancel_all_pending": "待处理 IO 已取消",
      "io.inject_heartbeat": "心跳 Fact 已注入",
      "audit.export_chain": "审计链导出中",
      "wal.force_rotate": "WAL 轮换已触发",
    };
    toastInfo(map[action] ?? `执行干预: ${action}`);
  }
</script>

<div class="monitor-dashboard" data-status={productionState.status}>
  <!-- Session 切换 Toast(浮层) -->
  <SessionSwitchToast
    visible={ssToastVisible}
    newSessionId={ssToastNewSessionId}
    newVersion={ssToastNewVersion}
    oldSessionId={ssToastOldSessionId}
    oldVersion={ssToastOldVersion}
    reason={ssToastReason}
    onClose={() => (ssToastVisible = false)}
  />

  <!-- 顶部 连接 + 生产状态 -->
  <header class="md-topbar">
    <div class="md-topbar-left">
      <h2 class="md-title">📈 L1 监控大屏</h2>
      <div class="md-production-tag">
        <span class={`md-prod-status status-${productionState.status}`}>
          {productionState.status === "running"
            ? "● 运行中"
            : productionState.status === "switching"
              ? "⇄ 切换中"
              : "○ 离线"}
        </span>
        <span class="md-prod-version"
          >规则集 v{productionState.rulesetVersion}</span
        >
        {#if productionState.currentSessionId !== null}
          <span class="md-prod-sid"
            >Session #{productionState.currentSessionId}</span
          >
        {/if}
        {#if productionState.rulesetHash}
          <span class="md-prod-hash" title={productionState.rulesetHash}>
            H:{productionState.rulesetHash.slice(0, 6)}…
          </span>
        {/if}
        {#if productionState.updatedAt}
          <span class="md-prod-updated"
            >更新 {new Date(
              productionState.updatedAt,
            ).toLocaleTimeString()}</span
          >
        {/if}
      </div>
    </div>
    <div class="md-topbar-right">
      <ConnectionBanner state={sseConn} />
    </div>
  </header>

  <!-- Reactor State Bar -->
  <div class="md-reactor-row">
    <ReactorStateBar state={reactor} />
  </div>

  <!-- 主体:3 列网格 -->
  <div class="md-grid">
    <!-- Fact 流(左大区域) -->
    <div class="md-fact-area">
      <FactStreamView itemHeight={86} />
    </div>

    <!-- 右侧 2 面板 + 1 操作栏 -->
    <aside class="md-side">
      <AnomalyPanel />
      <PerformanceMetrics data={metrics} />
      <InterventionBar
        currentRulesetVersion={productionState.rulesetVersion}
        onAction={handleIntervention}
        disabled={productionState.status === "offline"}
      />
    </aside>
  </div>

  <!-- T4: P07 通用导出对话框(audit.export_chain 触发) -->
  <ExportDialog
    open={exportOpen}
    preset={exportPreset}
    onClose={() => {
      exportOpen = false;
      exportPreset = undefined;
    }}
  />
</div>

<style>
  .monitor-dashboard {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--color-gray-50, #f8fafc);
    padding: 10px 12px 12px;
    gap: 10px;
    box-sizing: border-box;
    overflow: auto;
  }
  .md-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
    border-radius: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .md-topbar-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .md-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .md-production-tag {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
  }
  .md-prod-status {
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
  }
  .status-running {
    background: var(--color-success-bg, #dcfce7);
    color: var(--color-success, #166534);
  }
  .status-switching {
    background: var(--color-warning-bg, #fef9c3);
    color: var(--color-warning, #854d0e);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .status-offline {
    background: var(--bg-hover, #f3f4f6);
    color: var(--text-secondary, #4b5563);
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }
  .md-prod-version {
    font-family: var(--font-mono, monospace);
    font-weight: 700;
    color: var(--color-primary, #2563eb);
  }
  .md-prod-sid {
    font-family: var(--font-mono, monospace);
    color: var(--color-gray-600, #4b5563);
    background: var(--color-gray-100, #f3f4f6);
    padding: 0 6px;
    border-radius: 4px;
  }
  .md-prod-hash {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--brand, #7c3aed);
    background: var(--color-info-bg, #f5f3ff);
    padding: 0 5px;
    border-radius: 3px;
  }
  .md-prod-updated {
    color: var(--color-gray-500, #6b7280);
  }
  .md-topbar-right {
    flex-shrink: 0;
    min-width: 280px;
    max-width: 460px;
    width: 100%;
  }
  .md-reactor-row {
    flex-shrink: 0;
  }
  .md-grid {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 10px;
    flex: 1;
    min-height: 0;
  }
  .md-fact-area {
    min-width: 0;
    min-height: 360px;
    display: flex;
    flex-direction: column;
  }
  .md-side {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto auto;
    gap: 10px;
    min-width: 0;
    min-height: 0;
  }
  @media (max-width: 1024px) {
    .md-grid {
      grid-template-columns: 1fr;
    }
    .md-fact-area {
      min-height: 320px;
    }
    .md-side {
      grid-template-rows: auto auto auto;
    }
  }
</style>
