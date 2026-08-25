<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:P09 导入导出主页(3 Tab:导入/导出/模板市场)
    - 路由参数 preset 预选 Tab + 对象类型
    - Tab 切换无状态丢失(各 Tab 自管)
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §9.1
-->

<script lang="ts">
  import ImportTab from "./ImportTab.svelte";
  import ExportTab from "./ExportTab.svelte";
  import MarketplaceTab from "./MarketplaceTab.svelte";
  import type { ObjectType } from "$lib/stores/import-export-types";

  interface Props {
    /** 预设:初始 Tab + 对象类型 */
    preset?: {
      tab?: "import" | "export" | "marketplace";
      type?: ObjectType;
    };
  }

  let { preset }: Props = $props();

  let activeTab = $state<"import" | "export" | "marketplace">(
    preset?.tab ?? "import",
  );
  let presetType = $state<ObjectType | undefined>(preset?.type);

  const tabs = [
    { id: "import" as const, label: "📥 导入", desc: "从文件导入规则/数据集/表单" },
    { id: "export" as const, label: "📤 导出", desc: "导出为 JSON/YAML/CSV/XML/PDF" },
    { id: "marketplace" as const, label: "🛒 模板市场", desc: "builtin + 用户分享模板" },
  ];

  function switchTab(tab: "import" | "export" | "marketplace") {
    activeTab = tab;
    // 切 Tab 时清空 preset type(避免串扰)
    if (tab !== "import" && tab !== "export") presetType = undefined;
  }
</script>

<div class="ie-page">
  <header class="ie-header">
    <h1 class="ie-title">🔄 导入 / 导出 / 模板市场</h1>
    <p class="ie-subtitle">
      规则 / 数据集 / 表单 / 库 Schema 的全格式互转,支持 BLAKE3 完整性嵌入
    </p>
  </header>

  <div class="ie-tabs" role="tablist">
    {#each tabs as tab (tab.id)}
      <button
        class="ie-tab"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => switchTab(tab.id)}
      >
        <span class="ie-tab-label">{tab.label}</span>
        <span class="ie-tab-desc">{tab.desc}</span>
      </button>
    {/each}
  </div>

  <div class="ie-content" role="tabpanel">
    {#if activeTab === "import"}
      <ImportTab presetType={presetType} />
    {:else if activeTab === "export"}
      <ExportTab presetType={presetType} />
    {:else}
      <MarketplaceTab />
    {/if}
  </div>
</div>

<style>
  .ie-page {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px;
  }
  .ie-header {
    margin-bottom: 16px;
  }
  .ie-title {
    margin: 0 0 4px;
    font-size: 22px;
    color: var(--color-text-primary, #111827);
  }
  .ie-subtitle {
    margin: 0;
    font-size: 13px;
    color: var(--color-gray-500, #6b7280);
  }
  .ie-tabs {
    display: flex;
    gap: 8px;
    border-bottom: 1px solid var(--color-gray-200, #e5e7eb);
    margin-bottom: 20px;
  }
  .ie-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 16px;
    cursor: pointer;
    font-family: inherit;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    transition: all 0.15s;
  }
  .ie-tab:hover {
    background: var(--color-gray-50, #f9fafb);
  }
  .ie-tab.active {
    border-bottom-color: var(--color-primary, #2563eb);
  }
  .ie-tab-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary, #111827);
  }
  .ie-tab.active .ie-tab-label {
    color: var(--color-primary, #2563eb);
  }
  .ie-tab-desc {
    font-size: 10px;
    color: var(--color-gray-500, #6b7280);
  }
  .ie-content {
    min-height: 400px;
  }
</style>
