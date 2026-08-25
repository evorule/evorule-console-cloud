<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P10 任务历史记录视图。
  P10_TASKFLOW_DEMO_DESIGN.md §5.3 定义。
  职责:展示用户的历史任务流记录(启动时间 / 完成度 / 状态)。
-->

<script lang="ts">
	import { taskHistoryStore, clearHistory } from "$lib/stores/task-history";
	import { toastInfo } from "$lib/stores/toast";

	const entries = $derived($taskHistoryStore);

	function handleClear() {
		clearHistory();
		toastInfo("已清空任务历史", "任务历史");
	}

	function formatTime(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleString("zh-CN", {
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
			});
		} catch {
			return iso;
		}
	}

	function statusLabel(status: string): string {
		return status === "completed" ? "✓ 完成" : status === "cancelled" ? "✕ 取消" : "▶ 进行中";
	}
</script>

<div class="th-view">
	<div class="th-header">
		<h3 class="th-title">📜 任务历史</h3>
		{#if entries.length > 0}
			<button class="th-clear" onclick={handleClear}>清空</button>
		{/if}
	</div>

	{#if entries.length === 0}
		<div class="th-empty">
			<span class="th-empty-icon">📋</span>
			<p class="th-empty-text">还没有任务历史</p>
			<p class="th-empty-hint">启动一个任务流,完成后会记录在这里</p>
		</div>
	{:else}
		<div class="th-list">
			{#each entries as entry (entry.instanceId)}
				<div class="th-entry" class:completed={entry.status === "completed"} class:cancelled={entry.status === "cancelled"}>
					<div class="th-entry-main">
						<div class="th-entry-name">{entry.flowName}</div>
						<div class="th-entry-meta">
							<span class="th-entry-time">{formatTime(entry.startedAt)}</span>
							<span class="th-entry-steps">{entry.completedSteps}/{entry.totalSteps} 步</span>
							{#if entry.isDemo}
								<span class="th-entry-demo">demo</span>
							{/if}
						</div>
					</div>
					<span class="th-status th-status-{entry.status}">
						{statusLabel(entry.status)}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.th-view {
		background: white;
		border-radius: 8px;
		padding: 16px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}
	.th-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.th-title {
		font-size: 15px;
		font-weight: 600;
		margin: 0;
		color: var(--color-text-primary, #1f2937);
	}
	.th-clear {
		background: transparent;
		border: 1px solid var(--color-gray-300, #d1d5db);
		border-radius: 4px;
		padding: 4px 10px;
		font-size: 12px;
		cursor: pointer;
		color: var(--color-text-secondary, #6b7280);
	}
	.th-clear:hover {
		background: var(--color-gray-50, #f9fafb);
	}

	.th-empty {
		text-align: center;
		padding: 24px 16px;
		color: var(--color-text-secondary, #6b7280);
	}
	.th-empty-icon {
		font-size: 32px;
		opacity: 0.5;
	}
	.th-empty-text {
		font-size: 14px;
		margin: 8px 0 4px 0;
	}
	.th-empty-hint {
		font-size: 12px;
		opacity: 0.7;
	}

	.th-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.th-entry {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		background: var(--color-gray-50, #f9fafb);
		border-radius: 6px;
		border-left: 3px solid var(--color-gray-300, #d1d5db);
	}
	.th-entry.completed {
		border-left-color: var(--color-success, #22c55e);
	}
	.th-entry.cancelled {
		border-left-color: var(--color-error, var(--danger, #ef4444));
		opacity: 0.7;
	}
	.th-entry-main {
		flex: 1;
		min-width: 0;
	}
	.th-entry-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-primary, #1f2937);
	}
	.th-entry-meta {
		display: flex;
		gap: 10px;
		font-size: 11px;
		color: var(--color-text-secondary, #6b7280);
		margin-top: 2px;
	}
	.th-entry-demo {
		padding: 0 6px;
		background: var(--color-warning-bg, #fef3c7);
		color: var(--color-warning-text, var(--color-warning, #92400e));
		border-radius: 8px;
	}

	.th-status {
		font-size: 11px;
		font-weight: 500;
		padding: 2px 8px;
		border-radius: 10px;
		flex-shrink: 0;
	}
	.th-status-completed {
		background: var(--color-success-bg, #dcfce7);
		color: var(--color-success-text, var(--color-success, #166534));
	}
	.th-status-cancelled {
		background: var(--color-error-bg, #fee2e2);
		color: var(--color-error-text, var(--color-error, #991b1b));
	}
	.th-status-running {
		background: var(--color-info-bg, #dbeafe);
		color: var(--color-info-text, var(--color-info, #1e40af));
	}
</style>
