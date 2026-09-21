<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /agent 路由 — Agent 会话台
  承载 AgentWorkspace 三栏骨架(空壳可导航)。
  入口:侧栏「🤖 Agent 会话」(agentConfig.enabled 门控,禁用时不渲染)。
  Dialog 宿主:会话台「转规则草稿」经 assistant-ui 打开 DraftRuleDialog
  (外部预填信箱;与 /view/* 页的 Dialog 宿主同一 store 驱动)。
-->
<script lang="ts">
  import AgentWorkspace from "$lib/views/Agent/AgentWorkspace.svelte";
  import DraftRuleDialog from "$lib/views/Assistant/DraftRuleDialog.svelte";
  import { activeAssistantDialog } from "$lib/stores/assistant-ui";
</script>

<AgentWorkspace />
{#if $activeAssistantDialog === "draft"}
  <DraftRuleDialog />
{/if}
