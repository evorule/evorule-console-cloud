<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P10 demo 模式引导任务卡片(4 个)。
  P10_TASKFLOW_DEMO_DESIGN.md §3.3 + §5.4 定义。
  职责:展示 4 个引导任务卡片,点击启动对应只读 TaskFlow。
-->

<script lang="ts">
	import { GUIDED_TASKS } from "$lib/data/guided-tasks";
	import { startTaskFlow } from "$lib/stores/task-flow";
	import { demoDatasetStore } from "$lib/stores/demo-dataset";
	import { guidedTaskProgressStore, type GuidedTaskId } from "$lib/stores/guided-task-progress";
	import { toastInfo } from "$lib/stores/toast";

	function handleStart(taskId: GuidedTaskId) {
		const task = GUIDED_TASKS.find((t) => t.id === taskId);
		if (!task) return;
		const dataset = $demoDatasetStore;
		const presetContext = task.presetContext[dataset];
		startTaskFlow(task.flowId, true, presetContext);
		toastInfo(`已启动引导任务: ${task.name}`, "demo 任务流");
	}

	function isCompleted(taskId: GuidedTaskId): boolean {
		return $guidedTaskProgressStore.some((p) => p.taskId === taskId);
	}

	const completedCount = $derived(
		$guidedTaskProgressStore.length,
	);
</script>

<div class="guided-tasks">
	<div class="gt-header">
		<h3 class="gt-title">🎯 4 个引导任务(2-3 分钟体验完整链路)</h3>
		{#if completedCount > 0}
			<span class="gt-progress">已完成 {completedCount}/4</span>
		{/if}
	</div>

	<div class="gt-grid">
		{#each GUIDED_TASKS as task (task.id)}
			<button
				class="gt-card"
				class:completed={isCompleted(task.id)}
				onclick={() => handleStart(task.id)}
			>
				<div class="gt-card-header">
					<span class="gt-card-icon">{task.icon}</span>
					<span class="gt-card-name">{task.name}</span>
					{#if isCompleted(task.id)}
						<span class="gt-done-badge">✓ 已完成</span>
					{/if}
				</div>
				<div class="gt-card-pitch">{task.pitch}</div>
				<div class="gt-card-meta">
					<span class="gt-time">⏱ ~{task.estimatedMinutes} 分钟</span>
					<span class="gt-dataset">📊 {$demoDatasetStore === "medical" ? "医疗场景" : "财务场景"}</span>
				</div>
			</button>
		{/each}
	</div>
</div>

<style>
	.guided-tasks {
		padding: 0;
	}
	.gt-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.gt-title {
		font-size: 16px;
		font-weight: 600;
		margin: 0;
		color: var(--color-text-primary, #1f2937);
	}
	.gt-progress {
		font-size: 13px;
		color: var(--color-success, #22c55e);
		font-weight: 500;
	}

	.gt-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}
	.gt-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		background: white;
		border: 2px solid var(--color-gray-200, #e5e7eb);
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}
	.gt-card:hover {
		border-color: var(--color-primary, #2563eb);
		box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
		transform: translateY(-1px);
	}
	.gt-card.completed {
		border-color: var(--color-success, #22c55e);
		background: var(--color-success-bg, #f0fdf4);
	}

	.gt-card-header {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.gt-card-icon {
		font-size: 20px;
	}
	.gt-card-name {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary, #1f2937);
		flex: 1;
	}
	.gt-done-badge {
		font-size: 11px;
		padding: 2px 8px;
		background: var(--color-success, #22c55e);
		color: white;
		border-radius: 10px;
	}
	.gt-card-pitch {
		font-size: 13px;
		color: var(--color-text-secondary, #6b7280);
		line-height: 1.5;
	}
	.gt-card-meta {
		display: flex;
		gap: 12px;
		font-size: 11px;
		color: var(--color-text-secondary, #6b7280);
	}

	@media (max-width: 768px) {
		.gt-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
