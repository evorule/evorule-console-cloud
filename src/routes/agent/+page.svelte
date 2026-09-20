<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /agent 路由 — Agent 会话台
  承载 AgentWorkspace 三栏骨架(空壳可导航)。
  入口:侧栏「🤖 Agent 会话」(agentConfig.enabled 门控,禁用时不渲染)。
-->
<script lang="ts">
  import AgentWorkspace from "$lib/views/Agent/AgentWorkspace.svelte";
</script>

<AgentWorkspace />
