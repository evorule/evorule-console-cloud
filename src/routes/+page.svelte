<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud 首页 — 状态感知 + 层感知路由 -->
<!--
  职责:
    - / 路由的入口页,把决策委托给 HomeRouter
    - HomeRouter 根据 sessionStore + isEmptyDb + homeModeStore 决策 A/B/C
    - 5 视图渲染已迁移到 /view/[id]/+page.svelte(T1 阶段)
  关联设计:HOME_DESIGN.md §4.4(状态感知路由)
-->

<script lang="ts">
	import HomeRouter from '$lib/views/Home/HomeRouter.svelte';
</script>

<HomeRouter />
