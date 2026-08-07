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
    draining:  { label: "排出中",  color: "#1d4ed8", bg: "#eff6ff", border: "#93c5fd", icon: "🔽" },
    executing: { label: "执行中",  color: "#15803d", bg: "#f0fdf4", border: "#86efac", icon: "▶" },
    awaiting_io:{label: "等待IO",  color: "#c2410c", bg: "#fff7ed", border: "#fdba74", icon: "⏳" },
    stable:    { label: "稳定",    color: "#0f766e", bg: "#f0fdfa", border: "#5eead4", icon: "✅" },
    error:     { label: "错误",    color: "#b91c1c", bg: "#fef2f2", border: "#fca5a5", icon: "❌" },
  };

  const phase = $derived(state ? phaseMap[state.phase] : phaseMap.idle);
</script>

<div class="reactor-state-bar" aria-live="polite">
  <!-- 左侧:Phase -->
  <div class="phase-indicator"
    style={`background: ${phase.bg}; border-color: ${phase.border}; color: ${phase.color};`}>
    <span class="phase-icon">{phase.icon}</span>
    <div class="phase-texts">
      <span class="phase-label">Reactor</span>
      <span class="phase-name">{state ? phase.label : "未连接"}</span>
    </div>
    {#if state?.phase === "executing"}
      <span class="pulse-dot" style={`background: ${phase.color};`}></span>
    {/if}
  </div>

  <!-- 右侧:指标 -->
  {#if state}
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
      <span class="metric-muted">连接后显示运行态指标</span>
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
    background: white;
    border: 1px solid var(--color-gray-200, #e5e7eb);
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
    color: var(--color-gray-400, #9ca3af);
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
    color: var(--color-gray-500, #6b7280);
    text-transform: uppercase;
    font-weight: 500;
  }
  .metric-value {
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary, #111827);
  }
  .metric-value.mono {
    font-family: var(--font-mono, monospace);
    font-weight: 600;
  }
  .metric-value.hot {
    color: #c2410c;
  }
  .metric.alert .metric-value {
    color: var(--color-error, #dc2626);
    animation: flash 1.5s ease-in-out infinite;
  }
  .metric.done .metric-value {
    color: var(--color-gray-500, #6b7280);
  }
  @keyframes flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
