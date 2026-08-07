<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- P07 独立导出中心路由(/export) -->
<!--
  职责:
    - 渲染 ExportCenter(独立全页导出中心,P07 §3.6 决策 6 第 3 个入口)
    - 不传 onClose(独立路由,用户通过顶部导航切换)
    - backend / assistant 由 +layout.svelte 注入,ExportCenter 内部 ExportDialog 通过 useBackend() 获取
  关联设计:P07_RESULT_EXPORT_DESIGN.md §3.6 + §6
  路由守卫:+layout.ts 中 /export 要求登录(与 /view/ 一致)
-->

<script lang="ts">
  import ExportCenter from "$lib/views/Export/ExportCenter.svelte";
</script>

<ExportCenter />
