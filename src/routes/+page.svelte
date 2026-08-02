<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud 主视图容器 -->
<!--
  职责:
    - 根据 currentView 渲染 5 视图之一(内核视图组件)
    - 给 RuleLibraryView 传 LLM callback(onaiGenerateDraft / onaiExplainRule)
    - 给 ExecutionPadView 传 LLM callback(onaiGenerateInput)
    - 根据 activeAssistantDialog 渲染对应的 Dialog

  LLM callback → openAssistantDialog():
    - 视图的 LLM 按钮被点 → 调 callback → openAssistantDialog(type)
    - Dialog 显示,LLM 交互由 Dialog 内部管理
    - Dialog 关闭后用户继续操作

  内核边界:
    - 内核视图只调 callback,不感知 Dialog
    - 大众版通过 callback 接通 LLM 按钮 → Dialog
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
	import {
		activeAssistantDialog,
		openAssistantDialog
	} from '$lib/stores/assistant-ui';
	import DraftRuleDialog from '$lib/views/Assistant/DraftRuleDialog.svelte';
	import ExplainRuleDialog from '$lib/views/Assistant/ExplainRuleDialog.svelte';
	import GenerateInputDialog from '$lib/views/Assistant/GenerateInputDialog.svelte';
</script>

{#if $currentView === 'rules'}
	<RuleLibraryView
		onaiGenerateDraft={() => openAssistantDialog('draft')}
		onaiExplainRule={() => openAssistantDialog('explain')}
	/>
{:else if $currentView === 'execution'}
	<ExecutionPadView
		onaiGenerateInput={() => openAssistantDialog('input')}
	/>
{:else if $currentView === 'state'}
	<StateView />
{:else if $currentView === 'audit'}
	<AuditView />
{:else if $currentView === 'timetravel'}
	<TimeTravelView />
{/if}

<!-- LLM 三 Dialog(条件渲染,只一个能开) -->
{#if $activeAssistantDialog === 'draft'}
	<DraftRuleDialog />
{:else if $activeAssistantDialog === 'explain'}
	<ExplainRuleDialog />
{:else if $activeAssistantDialog === 'input'}
	<GenerateInputDialog />
{/if}
