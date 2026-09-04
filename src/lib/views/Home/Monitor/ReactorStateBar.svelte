<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:Reactor 运行态状态栏(6 phase 正确显示 + 因果深度 + step + pending IO)
    - phase 6 状态:idle(灰)/ draining(蓝)/ executing(绿)/ awaiting_io(橙)/ stable(青)/ error(红)
    - 右侧指标:因果深度 / step / pending_io / invariant violations
  关联设计:P05_MONITOR_DASHBOARD_DESIGN.md §5.5(Reactor runtime) + §4.2(6 phase)
-->

<script lang="ts">
  import type { ReactorRuntimeState, ReactorPhase } from "$lib/stores/reactor-runtime";

  interface Props {
    state: ReactorRuntimeState | null;
  }

  let { state }: Props = $props();

  const phaseMap: Record<ReactorPhase, { label: string; color: string; bg: string; border: string; icon: string }> = {
    idle:      { label: "空闲",    color: "#6b7280", bg: "#f9fafb", border: "#d1d5db", icon: "⏸" },
    draining:  { label: "排出中",  color: "var(--brand, #1d4ed8)", bg: "var(--info-bg, #eff6ff)", border: "var(--info, #93c5fd)", icon: "🔽" },
    executing: { label: "执行中",  color: "#15803d", bg: "#f0fdf4", border: "var(--success, #86efac)", icon: "▶" },
    awaiting_io:{label: "等待IO",  color: "#c2410c", bg: "#fff7ed", border: "#fdba74", icon: "⏳" },
    stable:    { label: "稳定",    color: "#0f766e", bg: "#f0fdfa", border: "#5eead4", icon: "✅" },
    error:     { label: "错误",    color: "#b91c1c", bg: "var(--danger-bg, #fef2f2)", border: "var(--danger, #fca5a5)", icon: "❌" },
  };

  const phase = $derived(state ? phaseMap[state.phase] : phaseMap.idle);

  // UV-079 ②: 会话失效(404)态——phase 指示器切警示样式,指标区换提示文案
  const missing = $derived(state?.sessionMissing === true);
</script>

<div class="reactor-state-bar" aria-live="polite">
  <!-- 左侧:Phase -->
  <!-- UV-078 W1-A4:"未连接"→"待会话" — state 为 null 仅表示当前无选中会话可观测, -->
  <!-- 并非连接故障;tooltip 说明数据来源与预期态,消除新用户困惑 -->
  {#if missing}
    <!-- UV-079 ②: 幻影会话警示——轮询 404 已停止,提示刷新重新同步 -->
    <div class="phase-indicator missing"
      title="轮询的生产会话已不存在(可能被回收或切换)。服务端 reaper 会自动重建生产会话——刷新页面即可重新同步;若刷新后仍失效,请检查 evorule-server 日志中的 UV-079 报警。">
      <span class="phase-icon">⚠</span>
      <div class="phase-texts">
        <span class="phase-label">Reactor</span>
        <span class="phase-name">会话失效</span>
      </div>
    </div>
  {:else}
    <div class="phase-indicator"
      style={`background: ${phase.bg}; border-color: ${phase.border}; color: ${phase.color};`}
      title={state
        ? `Reactor 运行态来自当前选中会话(实时轮询)。Phase:${phase.label}`
        : '当前无选中会话 — 在执行台创建或选择一个会话后,这里会实时显示其 Reactor 运行态(6 phase/因果深度/待处理 IO)。这是预期空态,不代表连接故障。'}>
      <span class="phase-icon">{phase.icon}</span>
      <div class="phase-texts">
        <span class="phase-label">Reactor</span>
        <span class="phase-name">{state ? phase.label : "待会话"}</span>
      </div>
      {#if state?.phase === "executing"}
        <span class="pulse-dot" style={`background: ${phase.color};`}></span>
      {/if}
    </div>
  {/if}

  <!-- 右侧:指标 -->
  {#if missing}
    <div class="metrics muted">
      <span class="metric-muted missing-hint">生产会话已不存在(轮询已停止)— 服务端会自动重建,请刷新页面重新同步生产状态</span>
    </div>
  {:else if state}
    <div class="metrics">
      <div class="metric">
        <span class="metric-label">因果深度</span>
        <span class="metric-value">{state.causalDepth}</span>
      </div>
      <div class="metric">
        <span class="metric-label">当前 Step</span>
        <span class="metric-value">{state.currentStep}</span>
      </div>
      <div class="metric">
        <span class="metric-label">待处理 IO</span>
        <span class="metric-value" class:hot={state.pendingIoCount > 3}>
          {state.pendingIoCount}
        </span>
      </div>
      <div class="metric">
        <span class="metric-label">版本</span>
        <span class="metric-value mono">v{state.reactorVersion}</span>
      </div>
      <div class="metric" class:alert={state.invariantViolations > 0}>
        <span class="metric-label">不变量违规</span>
        <span class="metric-value">{state.invariantViolations}</span>
      </div>
      <div class="metric" class:done={state.finished}>
        <span class="metric-label">状态</span>
        <span class="metric-value">{state.finished ? "已结束" : "运行中"}</span>
      </div>
    </div>
  {:else}
    <div class="metrics muted">
      <span class="metric-muted">选中会话后显示运行态指标</span>
    </div>
  {/if}
</div>

<style>
  .reactor-state-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 8px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .phase-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid;
    border-radius: 6px;
    position: relative;
  }
  .phase-icon {
    font-size: 14px;
  }
  .phase-texts {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  .phase-label {
    font-size: 10px;
    opacity: 0.75;
    font-weight: 500;
    text-transform: uppercase;
  }
  .phase-name {
    font-size: 13px;
    font-weight: 700;
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse-dot 1s ease-in-out infinite;
    margin-left: 4px;
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.75); }
  }
  .metrics {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .metrics.muted {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
  }
  .metric-muted {
    font-size: 11px;
  }
  .metric {
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.1;
  }
  .metric-label {
    font-size: 10px;
    color: var(--text-secondary, #6b7280);
    text-transform: uppercase;
    font-weight: 500;
  }
  .metric-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary, #111827);
  }
  .metric-value.mono {
    font-family: var(--font-mono, monospace);
    font-weight: 600;
  }
  .metric-value.hot {
    color: #c2410c;
  }
  .metric.alert .metric-value {
    color: var(--danger, #dc2626);
    animation: flash 1.5s ease-in-out infinite;
  }
  .metric.done .metric-value {
    color: var(--text-secondary, #6b7280);
  }
  /* UV-079 ②: 会话失效警示样式(幻影引用报警面) */
  .phase-indicator.missing {
    background: #fffbeb;
    border-color: #fcd34d;
    color: #b45309;
  }
  .metric-muted.missing-hint {
    color: #b45309;
    font-weight: 600;
  }
  @keyframes flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
