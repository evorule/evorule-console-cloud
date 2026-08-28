<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:状态 A(demo 模式)首页骨架
    - 未登录访客 / force-demo 模式下渲染
    - T1 阶段:占位骨架(T5 P10/P11 打磨 banner / 数据集切换动画 / CTA 强化)
    - 提供"登录"和"切换 demo 数据集"两个测试入口
  依赖:sessionStore(登录) / demoDatasetStore(切换数据集) / homeModeStore(回工作台)
  关联设计:HOME_DESIGN.md §5.1(DemoHome 组件树) + §3.4(demo toggle 行为)
-->

<script lang="ts">
  import { sessionStore, login } from "$lib/stores/session";
  import { homeModeStore, autoMode } from "$lib/stores/home-mode";
  import {
    demoDatasetStore,
    setDemoDataset,
    toggleDemoDataset,
  } from "$lib/stores/demo-dataset";
  import { toastSuccess, toastInfo } from "$lib/stores/toast";
  import GuidedTasks from "./GuidedTasks.svelte";
  import TaskHistoryView from "./TaskHistoryView.svelte";
  import GettingStartedChecklist from "./GettingStartedChecklist.svelte";

  // mock 登录(P0 阶段,真实认证由 evorule-server 提供)
  function handleLogin() {
    // P0 mock:用固定 userId/username 登录
    login("demo-user", "演示用户");
    toastSuccess("已登录为演示用户", "登录成功");
    // autoMode 让 HomeRouter 按 session + db 自动决策(空库 → 向导;有库 → 工作台)
    autoMode();
  }

  function handleSwitchDataset() {
    toggleDemoDataset();
    const next = $demoDatasetStore === "medical" ? "财务场景" : "医疗场景";
    toastInfo(`已切换到 ${next}`, "demo 数据集");
  }

  function handleSelectDataset(d: "medical" | "finance") {
    setDemoDataset(d);
    toastInfo(
      `已切换到 ${d === "medical" ? "医疗场景" : "财务场景"}`,
      "demo 数据集",
    );
  }

  // 已登录用户在 force-demo 模式下可切回工作台
  const isLoggedIn = $derived($sessionStore.loggedIn);
  const isForceDemo = $derived($homeModeStore === "force-demo");

  // 「这是什么」可折叠说明(首屏价值叙事补充)
  let showWhatIs = $state(false);
</script>

<section class="demo-home">
  <div class="demo-banner">
    <span class="banner-icon">📋</span>
    <span class="banner-text">演示模式 · 数据为预填示例</span>
    {#if isLoggedIn && isForceDemo}
      <button class="banner-cta" onclick={autoMode}> ← 回我的工作台 </button>
    {/if}
  </div>

  <div class="demo-hero">
    <h1 class="hero-title">evorule</h1>
    <p class="hero-subtitle">企业 AI Agent 合规审计层</p>
    <p class="hero-desc">
      BLAKE3 不可篡改审计链 · 时间旅行回放 · 三层安全控制<br />
      让 AI Agent 的每一次决策都可审计、可回放、可控制
    </p>
    <div class="hero-actions">
      {#if !isLoggedIn}
        <button class="btn btn-primary" onclick={handleLogin}>
          30 秒看懂 →
        </button>
      {:else}
        <button class="btn btn-primary" onclick={autoMode}>
          进入工作台 →
        </button>
      {/if}
    </div>

    <button
      class="whatis-toggle"
      onclick={() => (showWhatIs = !showWhatIs)}
      aria-expanded={showWhatIs}
    >
      ❓ 这是什么？30 秒看懂 evorule {showWhatIs ? "▲" : "▼"}
    </button>
    {#if showWhatIs}
      <div class="whatis-panel" role="region" aria-label="evorule 是什么">
        <p class="whatis-lead">
          <strong>evorule 是给 AI Agent 装上的「行车记录仪 + 红绿灯」。</strong>
        </p>
        <ul class="whatis-list">
          <li>📹 <strong>行车记录仪</strong>：AI 的每一次决策、每一条规则命中，都被 BLAKE3 哈希链记录——不可篡改、可回放、可追溯。</li>
          <li>🚦 <strong>红绿灯</strong>：AI 想调用工具、改数据前，先过合规门禁；不合规就拦下，守住安全边界。</li>
          <li>🧭 <strong>给谁用</strong>：想把 AI 用起来、又怕它"乱来"的团队——金融、医疗、政务等高合规场景。</li>
        </ul>
        <p class="whatis-foot">下面用 6 步带你跑通第一条规则 👇</p>
      </div>
    {/if}
  </div>

  <div class="demo-dataset-picker">
    <div class="picker-label">选择 demo 场景:</div>
    <div class="picker-options">
      <button
        class="dataset-card"
        class:active={$demoDatasetStore === "medical"}
        onclick={() => handleSelectDataset("medical")}
      >
        <span class="card-icon">🏥</span>
        <span class="card-title">医疗场景</span>
        <span class="card-desc">分诊规则 / 用药门禁 / 转诊审批</span>
      </button>
      <button
        class="dataset-card"
        class:active={$demoDatasetStore === "finance"}
        onclick={() => handleSelectDataset("finance")}
      >
        <span class="card-icon">💳</span>
        <span class="card-title">财务场景</span>
        <span class="card-desc">转账限额 / 风控拦截 / 合规审计</span>
      </button>
    </div>
    <button class="btn btn-ghost" onclick={handleSwitchDataset}>
      ↔ 快速切换
    </button>
  </div>

  <div class="demo-guided-section" data-tour="library">
    <GuidedTasks />
  </div>

  <div class="demo-checklist-section">
    <GettingStartedChecklist />
  </div>

  <div class="demo-capabilities">
    <h3 class="capabilities-title">⚡ evorule 核心能力</h3>
    <div class="capabilities-grid">
      <div class="capability">
        <span class="cap-icon">🔗</span>
        <span class="cap-name">BLAKE3 不可篡改审计链</span>
        <span class="cap-desc">每个决策留痕,哈希链验证完整性</span>
      </div>
      <div class="capability">
        <span class="cap-icon">⏪</span>
        <span class="cap-name">时间旅行回放</span>
        <span class="cap-desc">回溯任意版本,diff 对比因果链</span>
      </div>
      <div class="capability">
        <span class="cap-icon">🛡️</span>
        <span class="cap-name">等保 2.0 三级门禁</span>
        <span class="cap-desc">AI Agent 工具调用前合规检查</span>
      </div>
      <div class="capability">
        <span class="cap-icon">📤</span>
        <span class="cap-name">合规报告导出</span>
        <span class="cap-desc">6 种内容 × 4 种格式,满足 EU AI Act</span>
      </div>
      <div class="capability">
        <span class="cap-icon">🔄</span>
        <span class="cap-name">滚动 session 热更新</span>
        <span class="cap-desc">规则集发布零停机,版本单调递增</span>
      </div>
      <div class="capability">
        <span class="cap-icon">✅</span>
        <span class="cap-name">协作审批工作流</span>
        <span class="cap-desc">三级权限,规则发布需审批</span>
      </div>
    </div>
  </div>

  <div class="demo-history-section">
    <TaskHistoryView />
  </div>
</section>

<style>
  .demo-home {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  /* banner */
  .demo-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--info-bg, #e0f2fe);
    border: 1px solid var(--info, #0284c7);
    border-radius: 6px;
    font-size: 14px;
  }
  .banner-icon {
    font-size: 16px;
  }
  .banner-text {
    flex: 1;
    color: var(--info, #0c4a6e);
  }
  .banner-cta {
    background: transparent;
    border: 1px solid var(--info, #0284c7);
    color: var(--info, #0284c7);
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }
  .banner-cta:hover {
    background: var(--info-bg, #e0f2fe);
  }

  /* hero */
  .demo-hero {
    text-align: center;
    padding: 48px 24px;
  }
  .hero-title {
    font-size: 48px;
    font-weight: 700;
    margin: 0 0 8px 0;
    letter-spacing: 0.02em;
    color: var(--brand, #2563eb);
  }
  .hero-subtitle {
    font-size: 20px;
    color: var(--text-secondary, #64748b);
    margin: 0 0 24px 0;
  }
  .hero-desc {
    font-size: 15px;
    color: var(--text-secondary, #64748b);
    line-height: 1.6;
    margin: 0 0 32px 0;
  }
  .hero-actions {
    display: flex;
    justify-content: center;
    gap: 12px;
  }

  /* buttons */
  .btn {
    padding: 10px 24px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    transition: all 0.15s ease;
  }
  .btn-primary {
    background: var(--brand, #2563eb);
    color: white;
  }
  .btn-primary:hover {
    opacity: 0.9;
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #64748b);
    border: 1px solid var(--border, #cbd5e1);
  }
  .btn-ghost:hover {
    background: var(--bg-page, #f8fafc);
  }

  /* 这是什么? 可折叠说明 */
  .whatis-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 4px auto 0;
    padding: 8px 16px;
    background: transparent;
    border: 1px dashed var(--border, #cbd5e1);
    border-radius: 999px;
    color: var(--text-secondary, #64748b);
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }
  .whatis-toggle:hover {
    border-color: var(--brand, #2563eb);
    color: var(--brand, #2563eb);
  }
  .whatis-panel {
    margin: 16px auto 0;
    max-width: 680px;
    text-align: left;
    padding: 16px 20px;
    background: var(--bg-page, #f8fafc);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
  }
  .whatis-lead {
    margin: 0 0 10px;
    font-size: 14px;
    color: var(--text-primary, #1e293b);
  }
  .whatis-list {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary, #64748b);
    line-height: 1.6;
  }
  .whatis-foot {
    margin: 12px 0 0;
    font-size: 13px;
    color: var(--brand, #2563eb);
    font-weight: 600;
  }

  /* dataset picker */
  .demo-dataset-picker {
    padding: 24px;
    background: var(--bg-page, #f8fafc);
    border-radius: 8px;
  }
  .picker-label {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--text-primary, #1e293b);
  }
  .picker-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .dataset-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 16px;
    background: var(--bg-card);
    border: 2px solid var(--border, #e2e8f0);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }
  .dataset-card:hover {
    border-color: var(--brand, #2563eb);
  }
  .dataset-card.active {
    border-color: var(--brand, #2563eb);
    background: var(--info-bg, #eff6ff);
  }
  .card-icon {
    font-size: 24px;
  }
  .card-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  .card-desc {
    font-size: 12px;
    color: var(--text-secondary, #64748b);
  }

  /* guided tasks section */
  .demo-guided-section {
    padding: 16px 0;
  }

  /* capabilities section */
  .demo-capabilities {
    padding: 24px;
    background: var(--bg-page, #f8fafc);
    border-radius: 8px;
  }
  .capabilities-title {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 16px 0;
    color: var(--text-primary, #1e293b);
  }
  .capabilities-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .capability {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px;
    background: var(--bg-card);
    border-radius: 6px;
    border: 1px solid var(--border, #e2e8f0);
  }
  .cap-icon {
    font-size: 22px;
  }
  .cap-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #1e293b);
  }
  .cap-desc {
    font-size: 11px;
    color: var(--text-secondary, #64748b);
    line-height: 1.4;
  }

  /* history section */
  .demo-history-section {
    padding: 0;
  }

  @media (max-width: 768px) {
    .capabilities-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
