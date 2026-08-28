<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  evorule-console 状态视图 — 驾驶舱 (阶段 D.1.3 重写)
-->
<!--
  依据: 设计文档/01_界面升级.txt §三.3 (大屏线框) + 03_大屏.md
        实施文档_界面升级_v1.0.md §D.1.3
  职责 (驾驶舱布局):
    - 顶部状态栏: 运行灯脉动 + version + session + 链完整性徽章 + 时间旅行/审计/导出按钮
    - 左 65% FactStream (Fact 流时间线)
    - 右 35% 面板: 3 指标卡 + 异常告警 + 链完整性徽章
  数据源:
    - refreshSessionState (session store) — reactor 运行态
    - refreshAudit (audit store) — 审计链 Fact 流
    - $effect 监听 $reactorVersion 变化时自动刷新 audit (新版本 = 新 Fact)
  交互:
    - 点击 Fact → 打开 AuditView 模态 (传 factId)
    - 审计按钮 → 打开 AuditView 模态 (无指定 fact)
  边界 (00 §六):
    - 审计链/Fact = evorule 确定性信号 (VerdictBadge chain-verified/broken)
    - 指标卡数值 = 应用层推导 (VerdictBadge metric)
-->

<script lang="ts">
  import {
    sessionState,
    reactorPhase,
    reactorVersion,
    reactorCausalDepth,
    reactorPendingIO,
    currentSessionId,
    isLoading,
    lastError,
    refreshSessionState,
  } from "$lib/kernel/stores/session";
  import {
    auditData,
    auditLoading,
    auditError,
    refreshAudit,
    fetchCausalChain,
    clearCausalSelection,
  } from "$lib/kernel/stores/audit";
  import { useBackendOrNull } from "$lib/kernel/backend/backend-context";
  import { setView } from "$lib/kernel/stores/view";
  import type { CausalEntry } from "$lib/kernel/backend/types";
  import VerdictBadge from "$lib/kernel/components/VerdictBadge.svelte";
  import FactStream from "./FactStream.svelte";
  import AuditView from "../AuditView/AuditView.svelte";

  const backend = useBackendOrNull();

  /** AuditView 模态控制 */
  let auditModalOpen = $state(false);
  /** 模态展示的 factId (null = 不指定, 展示整链) */
  let auditModalFactId = $state<number | null>(null);

  // === 初始化 + session 切换时拉取状态 + 审计 ===
  $effect(() => {
    const sid = $currentSessionId;
    if (backend && sid !== null) {
      refreshSessionState(backend, sid);
      refreshAudit(backend, sid);
    }
  });

  // === reactor 版本变化时刷新审计 (新 Fact 入链) ===
  $effect(() => {
    const v = $reactorVersion;
    const sid = $currentSessionId;
    if (backend && sid !== null && v !== null) {
      // v 变化触发, 拉最新审计链
      refreshAudit(backend, sid);
    }
  });

  function handleRefresh() {
    if (!backend) return;
    const sid = $currentSessionId;
    if (sid === null) return;
    refreshSessionState(backend, sid);
    refreshAudit(backend, sid);
  }

  /** 点击时间旅行按钮 → 切换到时间旅行视图。
   *  StateView 在 / 路由(+page.svelte 按 currentView 渲染),setView 即切换,无需 goto。 */
  function handleTimeTravel() {
    setView("timetravel");
  }

  /** 导出当前审计数据 + session 状态为 JSON 文件下载。
   *  应用层导出(含墙钟 exported_at,标注非 evorule 确定性)。 */
  function handleExport() {
    if ($currentSessionId === null) return;
    const exportData = {
      exported_at: new Date().toISOString(),
      session_id: $currentSessionId,
      audit: $auditData,
      session_state: $sessionState,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evorule-audit-session-${$currentSessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** 点击 Fact → 打开审计模态 + 拉因果链 */
  async function handleFactClick(factId: number) {
    if (!backend) return;
    const sid = $currentSessionId;
    if (sid === null) return;
    auditModalFactId = factId;
    auditModalOpen = true;
    await fetchCausalChain(backend, sid, factId);
  }

  /** 点击审计按钮 → 打开审计模态 (不指定 fact) */
  function handleOpenAudit() {
    auditModalFactId = null;
    clearCausalSelection();
    auditModalOpen = true;
  }

  function handleCloseAudit() {
    auditModalOpen = false;
    auditModalFactId = null;
    clearCausalSelection();
  }

  /** 运行灯是否脉动 (非稳态/空闲时脉动) */
  let lampPulsing = $derived(
    $reactorPhase === "executing" ||
      $reactorPhase === "draining" ||
      $reactorPhase === "awaiting_io" ||
      $reactorPhase === "error",
  );

  let phaseLabel = $derived($reactorPhase ?? "—");

  /** 审计 entries → CausalEntry[] */
  function asCausalEntries(entries: unknown[]): CausalEntry[] {
    return entries.filter((e): e is CausalEntry => {
      if (!e || typeof e !== "object") return false;
      const c = e as Record<string, unknown>;
      return typeof c.fact_id === "number" && typeof c.fact_type === "string";
    });
  }

  let facts = $derived($auditData ? asCausalEntries($auditData.entries) : []);
  let chainVerified = $derived($auditData?.verified ?? false);
  let factCount = $derived($auditData?.fact_count ?? 0);

  /** 异常告警: 结构不变量违反 > 0 */
  let invariantViolations = $derived(
    $sessionState?.reactor.structural_invariant_violations ?? 0,
  );
</script>

<div class="state-cockpit">
  <!-- === 顶部状态栏 === -->
  <header class="status-bar">
    <div class="status-left">
      <span
        class="run-lamp"
        class:pulsing={lampPulsing}
        class:error={$reactorPhase === "error"}
        class:stable={$reactorPhase === "stable" || $reactorPhase === "idle"}
        aria-label="运行状态灯"
      ></span>
      <div class="status-meta">
        <span class="meta-line">
          <span class="meta-label">version</span>
          <span class="meta-value">{$reactorVersion ?? "—"}</span>
        </span>
        <span class="meta-line">
          <span class="meta-label">session</span>
          <span class="meta-value">{$currentSessionId ?? "—"}</span>
        </span>
        <span class="meta-line">
          <span class="meta-label">phase</span>
          <span class="meta-value">{phaseLabel}</span>
        </span>
      </div>
    </div>

    <div class="status-right">
      <VerdictBadge
        kind={chainVerified ? "chain-verified" : "chain-broken"}
        value={chainVerified ? "链完整" : "链断裂"}
      />
      <button class="btn-text" onclick={handleOpenAudit} disabled={$currentSessionId === null}>
        🔍 审计
      </button>
      <button class="btn-text" onclick={handleTimeTravel} disabled={$currentSessionId === null}>
        ⏱ 时间旅行
      </button>
      <button
        class="btn-text"
        onclick={handleExport}
        disabled={$currentSessionId === null || !$auditData}
      >
        ⤓ 导出
      </button>
      <button
        class="btn-secondary"
        onclick={handleRefresh}
        disabled={!backend || $isLoading || $currentSessionId === null}
      >
        {$isLoading ? "刷新中…" : "刷新"}
      </button>
    </div>
  </header>

  {#if !backend}
    <div class="empty-state">
      <span class="empty-icon">🔌</span>
      <p>backend 未注入(开发期需要 evorule-server)</p>
    </div>
  {:else if $currentSessionId === null}
    <div class="empty-state">
      <span class="empty-icon">📭</span>
      <p>无当前 session</p>
      <p class="empty-hint">先到执行台创建 session</p>
    </div>
  {:else}
    {#if $lastError}
      <div class="error-banner" role="alert">
        <span>⚠</span>
        <span>{$lastError}</span>
      </div>
    {/if}

    <div class="cockpit-body">
      <!-- === 左 65% FactStream === -->
      <section class="fact-panel">
        <header class="panel-header">
          <h2>Fact 流</h2>
          <span class="panel-hint">
            {$auditLoading ? "加载中…" : `${factCount} 条 Fact`}
          </span>
        </header>
        <div class="fact-stream-container">
          {#if $auditError}
            <div class="inline-error">{$auditError}</div>
          {:else}
            <FactStream
              facts={facts}
              verified={chainVerified}
              onfactclick={handleFactClick}
            />
          {/if}
        </div>
      </section>

      <!-- === 右 35% 面板 === -->
      <aside class="side-panel">
        <section class="metrics-trio">
          <div class="mini-metric">
            <span class="mini-label">version</span>
            <span class="mini-value">{$reactorVersion ?? "—"}</span>
          </div>
          <div class="mini-metric">
            <span class="mini-label">causal_depth</span>
            <span class="mini-value">{$reactorCausalDepth ?? "—"}</span>
          </div>
          <div class="mini-metric">
            <span class="mini-label">pending_io</span>
            <span class="mini-value">{$reactorPendingIO ?? "—"}</span>
          </div>
        </section>

        <section class="alert-panel" class:has-alert={invariantViolations > 0}>
          <header class="alert-header">
            <h3>异常告警</h3>
            <VerdictBadge
              kind={invariantViolations > 0 ? "evorule-error" : "chain-verified"}
              value={invariantViolations > 0 ? `${invariantViolations} 项违反` : "无异常"}
              compact
            />
          </header>
          {#if invariantViolations > 0}
            <p class="alert-text">
              检测到 {invariantViolations} 项结构不变量违反,reactor 可能进入异常态。
            </p>
          {:else}
            <p class="alert-text muted">所有结构不变量保持,reactor 运行正常。</p>
          {/if}
        </section>

        <section class="chain-panel">
          <header class="alert-header">
            <h3>链完整性</h3>
          </header>
          <div class="chain-row">
            <VerdictBadge
              kind={chainVerified ? "chain-verified" : "chain-broken"}
              value={chainVerified ? "审计链已验证" : "审计链未验证"}
            />
          </div>
          <p class="alert-text muted">
            blake3 哈希链由 evorule 核心仓验证,前端仅展示结果。
          </p>
        </section>
      </aside>
    </div>
  {/if}
</div>

<!-- === AuditView 模态 (点击 Fact 触发) === -->
<AuditView
  open={auditModalOpen}
  factId={auditModalFactId}
  onclose={handleCloseAudit}
/>

<style>
  .state-cockpit {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* === 顶部状态栏 === */
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
    padding: var(--spacing-sm) var(--spacing-lg);
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .status-left {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  .run-lamp {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    background: var(--text-secondary);
    flex-shrink: 0;
    box-shadow: 0 0 0 1px var(--border);
  }

  .run-lamp.stable {
    background: var(--success);
  }

  .run-lamp.pulsing {
    background: var(--brand);
    animation: lamp-pulse 1.2s ease-in-out infinite;
  }

  .run-lamp.error {
    background: var(--danger);
    animation: lamp-pulse 0.6s ease-in-out infinite;
  }

  @keyframes lamp-pulse {
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 0 1px var(--border);
    }
    50% {
      opacity: 0.4;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 30%, transparent);
    }
  }

  .status-meta {
    display: flex;
    gap: var(--spacing-lg);
  }

  .meta-line {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .meta-label {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .meta-value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
  }

  .status-right {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  /* === 主体 === */
  .cockpit-body {
    display: grid;
    grid-template-columns: 65% 1fr;
    gap: var(--spacing-md);
    flex: 1;
    padding: var(--spacing-md) var(--spacing-lg);
    overflow: hidden;
    min-height: 0;
  }

  /* === Fact 面板 === */
  .fact-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: var(--card-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    min-height: 0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-sm) var(--spacing-md);
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .panel-header h2 {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: var(--font-semibold);
  }

  .panel-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .fact-stream-container {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .inline-error {
    padding: var(--spacing-md);
    color: var(--danger);
    font-size: var(--text-sm);
  }

  /* === 右侧面板 === */
  .side-panel {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
    overflow-y: auto;
    min-height: 0;
  }

  .metrics-trio {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-sm);
  }

  .mini-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--spacing-sm);
    background: var(--bg-card);
    border: var(--card-border);
    border-radius: var(--radius-md);
  }

  .mini-label {
    font-size: 10px;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .mini-value {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
  }

  .alert-panel,
  .chain-panel {
    padding: var(--spacing-md);
    background: var(--bg-card);
    border: var(--card-border);
    border-radius: var(--radius-md);
  }

  .alert-panel.has-alert {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 6%, var(--bg-card));
  }

  .alert-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }

  .alert-header h3 {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: var(--font-semibold);
  }

  .alert-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-primary);
  }

  .alert-text.muted {
    color: var(--text-secondary);
  }

  .chain-row {
    margin-bottom: var(--spacing-sm);
  }

  /* === 通用 === */
  .error-banner {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg-card));
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    color: var(--danger);
    font-size: var(--text-sm);
    margin: var(--spacing-sm) var(--spacing-lg) 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
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

  @media (max-width: 900px) {
    .cockpit-body {
      grid-template-columns: 1fr;
    }
    .status-meta {
      gap: var(--spacing-sm);
    }
  }
</style>
