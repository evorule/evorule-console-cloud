<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- P09 导入导出中心路由(/import-export) -->
<!--
  职责:
    - 渲染 ImportExportPage(P09 §9.1 主页,3 Tab:导入/导出/模板市场)
    - 路由参数 ?tab=import/export/marketplace + ?type=rule/dataset/form/library_schema
    - backend / assistant 由 +layout.svelte 注入
  关联设计:P09_IMPORT_EXPORT_INFRA_DESIGN.md §9.1
  路由守卫:+layout.ts 中 /import-export 要求登录 + 库非空
-->

<script lang="ts">
  import ImportExportPage from "$lib/views/ImportExport/ImportExportPage.svelte";
  import { page } from "$app/stores";
  import type { ObjectType } from "$lib/stores/import-export-types";

  type PresetTab = "import" | "export" | "marketplace";

  // 从 URL 取 preset
  let preset = $derived.by(() => {
    const tabParam = $page.url.searchParams.get("tab");
    const typeParam = $page.url.searchParams.get("type") as ObjectType | null;
    const tab: PresetTab | undefined =
      tabParam === "import" ||
      tabParam === "export" ||
      tabParam === "marketplace"
        ? tabParam
        : undefined;
    return {
      tab,
      type: typeParam ?? undefined,
    };
  });
</script>

<ImportExportPage {preset} />
