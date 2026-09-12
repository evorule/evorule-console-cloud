<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- P09 模板市场独立路由(/marketplace) -->
<!--
  职责:
    - 渲染 MarketplaceTab(P09 §7.2,独立全页市场)
    - 与 /import-export?tab=marketplace 等价,但提供独立入口(顶部导航直达)
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §7.2
  路由守卫:+layout.ts 中 /marketplace 要求登录 + 库非空
-->

<script lang="ts">
  import MarketplaceTab from "$lib/views/ImportExport/MarketplaceTab.svelte";
</script>

<div class="marketplace-page">
  <header class="mp-header">
    <h1 class="mp-title">🛒 模板市场</h1>
    <p class="mp-subtitle">
      内置 + 用户分享 + 官方规则集,一键导入到你的库
    </p>
    <!-- UV-179 批次C:财务人员场景显性位(直达官方资产分区) -->
    <a class="mp-scenario" href="/marketplace?view=official">
      💰 财务 / 费用合规场景?点这里查看「官方资产」,选择场景包一键部署
    </a>
  </header>
  <MarketplaceTab />
</div>

<style>
  .marketplace-page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px;
  }
  .mp-header {
    margin-bottom: 16px;
  }
  .mp-title {
    margin: 0 0 4px;
    font-size: 22px;
    color: var(--text-primary, #111827);
  }
  .mp-subtitle {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary, #6b7280);
  }
  /* UV-179 批次C:财务场景显性位 */
  .mp-scenario {
    display: inline-block;
    margin-top: 10px;
    font-size: 13px;
    color: var(--brand, #2563eb);
    text-decoration: none;
    background: var(--bg-card, #0d1117);
    border: 1px dashed var(--border, rgba(255, 255, 255, 0.08));
    border-radius: var(--r-sm, 6px);
    padding: 8px 14px;
  }
  .mp-scenario:hover {
    text-decoration: underline;
    border-color: var(--brand, #2563eb);
  }
</style>
