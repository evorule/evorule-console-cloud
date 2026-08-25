<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态 C(真实工作台)层感知壳
    - 已登录 + 有库时渲染
    - 内部按 layerStore 切换 L1(监控大屏) / L2(编辑台)
    - T1 阶段:占位壳(T3 P05 实现 L1 监控大屏 / T2 P01 实现 L2 编辑台)
    - 顶部 toggle 切换 L1 ↔ L2
  依赖:layerStore / sessionStore / productionStateStore / dbStore / homeModeStore
  关联设计:HOME_DESIGN.md §5.3(RealWorkbench 组件树) + §3.3(层视图切换矩阵)
-->

<script lang="ts">
  import { setLayer, type Layer } from "$lib/stores/layer";
  import { sessionStore, logout } from "$lib/stores/session";
  import { dbStore } from "$lib/stores/db";
  import { forceDemo } from "$lib/stores/home-mode";
  import { toastInfo, toastSuccess } from "$lib/stores/toast";
  import { viewModeStore, toggleViewMode } from "$lib/stores/view-mode";
  import MonitorDashboard from "./Monitor/MonitorDashboard.svelte";
  import OnboardingBanner from "./OnboardingBanner.svelte";
  import DecisionMakerView from "$lib/views/DecisionMaker/DecisionMakerView.svelte";

  interface Props {
    layer: Layer;
  }

  let { layer }: Props = $props();

  const currentUser = $derived($sessionStore.username ?? "用户");
  const dbName = $derived($dbStore.dbName || "未命名库");
  const isDecisionMaker = $derived($viewModeStore === "decision_maker");

  function handleSwitchLayer(l: "L1" | "L2") {
    setLayer(l);
    toastInfo(
      `已切换到 ${l === "L1" ? "L1 监控大屏" : "L2 编辑台"}`,
      "层视图切换",
    );
  }

  function handleLogout() {
    logout();
    forceDemo();
    toastSuccess("已登出", "回到 demo");
  }

  function handleToggleViewMode() {
    toggleViewMode();
    toastInfo(
      `已切换到${$viewModeStore === "decision_maker" ? "决策者" : "专家"}视图`,
      "视图模式",
    );
  }

  // L2 → L1 自动跳转的占位(T3 实现:首次发布规则成功时自动切 L1)
</script>

<section class="real-workbench">
  <header class="workbench-header">
    <div class="workbench-brand">
      <h2>💼 {dbName}</h2>
      <span class="user-badge">👋 {currentUser}</span>
    </div>

    <div class="layer-toggle">
      <button
        class="layer-btn"
        class:active={layer === "L2"}
        onclick={() => handleSwitchLayer("L2")}
        disabled={layer === "L2"}
      >
        ✏️ L2 编辑台
      </button>
      <button
        class="layer-btn"
        class:active={layer === "L1"}
        onclick={() => handleSwitchLayer("L1")}
        disabled={layer === "L1"}
      >
        📊 L1 监控大屏
      </button>
    </div>

    <div class="workbench-actions">
      <!-- P11 缺口 4:专家/决策者视图切换 -->
      <button
        class="btn btn-viewmode"
        class:decision-maker={isDecisionMaker}
        onclick={handleToggleViewMode}
        title={isDecisionMaker
          ? "当前:决策者视图(简化)— 点击切专家模式"
          : "当前:专家视图(完整)— 点击切决策者模式"}
      >
        {isDecisionMaker ? "👔 决策者" : "🔬 专家"}
      </button>
      <button class="btn btn-ghost" onclick={() => forceDemo()}>
        📋 看 demo
      </button>
      <button class="btn btn-ghost" onclick={handleLogout}> 🚪 登出 </button>
    </div>
  </header>

  <!-- P11 缺口 3:首屏引导横幅(首次进入工作台时显示) -->
  <OnboardingBanner />

  {#if isDecisionMaker}
    <!-- P11 缺口 4:决策者视图(简化版,隐藏技术细节) -->
    <div class="layer-panel decision-maker-panel">
      <DecisionMakerView />
    </div>
  {:else if layer === "L1"}
    <div class="layer-panel l1-panel">
      <MonitorDashboard />
    </div>
  {:else if layer === "L2"}
    <div class="layer-panel l2-panel">
      <div class="panel-header">
        <h3>✏️ L2 编辑台(Workspace)</h3>
        <span class="status-badge status-blue">编辑模式</span>
      </div>
      <div class="layer-content">
        <div class="placeholder-icon">🚧</div>
        <p class="placeholder-text">
          L2 编辑台的完整实现将在 T2(P01 建库)+ T3(P03 数据集 / P04
          执行台)阶段完成:<br />
          业务规则库 · 业务表单 · 术语库 · 数据集组合 · 业务执行台 · 沙盒入口
        </p>
        <div class="mock-rule-list">
          <div class="mock-rule">📜 首条规则(向导生成) — draft</div>
        </div>
      </div>
    </div>
  {:else}
    <div class="layer-panel">
      <div class="placeholder-icon">⏳</div>
      <p class="placeholder-text">正在初始化层视图...</p>
    </div>
  {/if}
</section>

<style>
  .real-workbench {
    max-width: 1200px;
    margin: 0 auto;
    padding: 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .workbench-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    background: white;
    border-radius: 8px;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
    flex-wrap: wrap;
  }
  .workbench-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
  }
  .workbench-brand h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
    color: var(--color-text-primary, #1e293b);
  }
  .user-badge {
    font-size: 13px;
    color: var(--color-text-secondary, #64748b);
  }

  .layer-toggle {
    display: flex;
    gap: 4px;
    background: var(--color-gray-100, #f1f5f9);
    padding: 4px;
    border-radius: 6px;
  }
  .layer-btn {
    padding: 6px 14px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text-secondary, #64748b);
    transition: all 0.15s ease;
  }
  .layer-btn:disabled {
    cursor: not-allowed;
  }
  .layer-btn.active {
    background: white;
    color: var(--color-primary, #2563eb);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .workbench-actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }
  .btn-ghost {
    background: transparent;
    color: var(--color-text-secondary, #64748b);
    border: 1px solid var(--color-gray-300, #cbd5e1);
  }
  .btn-ghost:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .btn-viewmode {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info-text, #1e40af);
    border: 1px solid var(--color-info, #3b82f6);
    font-weight: 600;
  }
  .btn-viewmode.decision-maker {
    background: var(--color-warning-bg, #fef3c7);
    color: var(--color-warning-text, #92400e);
    border-color: var(--color-warning, #f59e0b);
  }
  .btn-viewmode:hover {
    opacity: 0.85;
  }

  .layer-panel {
    background: white;
    border-radius: 8px;
    padding: 24px;
    box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1));
  }
  .l1-panel {
    padding: 0;
    overflow: hidden;
    min-height: calc(100vh - 140px);
  }
  .panel-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .panel-header h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    flex: 1;
    color: var(--color-text-primary, #1e293b);
  }
  .status-badge {
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
  }
  .status-blue {
    background: var(--color-info-bg, #dbeafe);
    color: var(--color-info-text, #1e40af);
  }

  .layer-content {
    text-align: center;
    padding: 32px 16px;
  }
  .placeholder-icon {
    font-size: 40px;
    margin-bottom: 12px;
    opacity: 0.5;
  }
  .placeholder-text {
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary, #64748b);
    margin-bottom: 24px;
  }

  .mock-rule-list {
    text-align: left;
    background: var(--color-gray-50, #f8fafc);
    border-radius: 6px;
    padding: 12px 16px;
    font-family: monospace;
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
    max-width: 560px;
    margin: 0 auto;
  }
  .mock-rule {
    padding: 4px 0;
    border-bottom: 1px solid var(--color-gray-200, #e2e8f0);
  }
  .mock-rule:last-child {
    border-bottom: none;
  }
</style>
