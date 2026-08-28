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
</style>
