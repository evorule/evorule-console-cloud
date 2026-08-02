<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud 主视图容器 — 根据 currentView 渲染 5 视图之一 -->
<!--
  复用内核视图组件(RuleLibraryView 等),大众版只做容器 + 视图切换。
  Phase 5 会在此传入 LLM callback props(onaiGenerateDraft 等),接通 LLM 按钮。
-->

<script lang="ts">
	import {
		currentView,
		RuleLibraryView,
		ExecutionPadView,
		StateView,
		AuditView,
		TimeTravelView
	} from '@evorule/console';
</script>

{#if $currentView === 'rules'}
	<RuleLibraryView />
{:else if $currentView === 'execution'}
	<ExecutionPadView />
{:else if $currentView === 'state'}
	<StateView />
{:else if $currentView === 'audit'}
	<AuditView />
{:else if $currentView === 'timetravel'}
	<TimeTravelView />
{/if}
