<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  帮助页「核心能力」tab —— 首页能力卡迁入(首页收敛为工作台入口+快速体验,
  营销性能力陈列归帮助页常驻)。
-->

<div class="help-capabilities">
  <h2 class="hc-title">⚡ evorule 核心能力</h2>
  <p class="hc-lead">六大能力围绕一件事:让 AI Agent 的每一次决策可审计、可回放、可控制。</p>
  <div class="hc-grid">
    <div class="hc-card">
      <span class="hc-icon">🔗</span>
      <span class="hc-name">BLAKE3 不可篡改审计链</span>
      <span class="hc-desc">每个决策留痕,哈希链验证完整性</span>
    </div>
    <div class="hc-card">
      <span class="hc-icon">⏪</span>
      <span class="hc-name">时间旅行回放</span>
      <span class="hc-desc">回溯任意版本,diff 对比因果链</span>
    </div>
    <div class="hc-card">
      <span class="hc-icon">🛡️</span>
      <span class="hc-name">等保 2.0 三级门禁</span>
      <span class="hc-desc">AI Agent 工具调用前合规检查</span>
    </div>
    <div class="hc-card">
      <span class="hc-icon">📤</span>
      <span class="hc-name">合规报告导出</span>
      <span class="hc-desc">6 种内容 × 4 种格式,满足 EU AI Act</span>
    </div>
    <div class="hc-card">
      <span class="hc-icon">🔄</span>
      <span class="hc-name">滚动 session 热更新</span>
      <span class="hc-desc">规则集部署零停机,版本单调递增</span>
    </div>
    <div class="hc-card">
      <span class="hc-icon">✅</span>
      <span class="hc-name">协作审批工作流</span>
      <span class="hc-desc">三级权限,规则部署需审批</span>
    </div>
  </div>
</div>

<style>
  .help-capabilities {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hc-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .hc-lead {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .hc-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .hc-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px;
    background: var(--bg-card);
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .hc-icon {
    font-size: 22px;
  }
  .hc-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .hc-desc {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  @media (max-width: 768px) {
    .hc-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
