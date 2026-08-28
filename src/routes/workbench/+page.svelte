<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /workbench 路由 — 极简首页(方案 C)
  5 region:Dashboard 状态条 + 4 统计卡 + 一键操作 + 最近活动 + 跳单页
  入口:侧栏第一项"🚀 工作台"(新)
  不动现有任何 view,完全 additive。
-->

<script lang="ts">
  import WorkbenchView from "$lib/views/Workbench/WorkbenchView.svelte";
</script>

<WorkbenchView />
