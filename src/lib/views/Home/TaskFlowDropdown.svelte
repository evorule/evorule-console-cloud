<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P10 任务流下拉触发器(顶部导航栏入口)。
  P10_TASKFLOW_DEMO_DESIGN.md §3.1 + §5.1 定义。
  职责:下拉菜单,展示 6 个任务流,点击启动对应任务流。
-->

<script lang="ts">
	import { taskFlowsDef } from "$lib/data/task-flows";
	import { startTaskFlow } from "$lib/stores/task-flow";
	import { sessionStore } from "$lib/stores/session";
	import { viewModeStore } from "$lib/stores/view-mode";
	import { toastInfo } from "$lib/stores/toast";

	let open = $state(false);

	function toggle() {
		open = !open;
	}

	function handleSelect(flowId: (typeof taskFlowsDef)[number]["id"]) {
		const isLoggedIn = $sessionStore.loggedIn;
		// 未登录时以 demo 模式启动(只读)
		startTaskFlow(flowId, !isLoggedIn);
		open = false;
		const def = taskFlowsDef.find((f) => f.id === flowId);
		toastInfo(`已启动任务流: ${def?.name ?? flowId}`, "任务流");
	}

	function handleOutsideClick(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest(".tf-dropdown")) {
			open = false;
		}
	}

	$effect(() => {
		if (open) {
			document.addEventListener("click", handleOutsideClick);
		}
		return () => document.removeEventListener("click", handleOutsideClick);
	});
</script>

<div class="tf-dropdown">
	<button
		class="tf-trigger"
		onclick={toggle}
		aria-haspopup="menu"
		aria-expanded={open}
		title="任务流 — 以任务为主线跨视图完成业务目标"
	>
		<span class="tf-icon">🎯</span>
		<span class="tf-label">任务流</span>
		<span class="tf-caret" class:open>{open ? "▲" : "▼"}</span>
	</button>

	{#if open}
		<div class="tf-menu" role="menu">
			<div class="tf-menu-header">
				<span>选择任务类型</span>
				<span class="tf-hint">6 任务流 · 4 步骤/流</span>
			</div>
			{#each taskFlowsDef as flow (flow.id)}
				<button
					class="tf-item"
					role="menuitem"
					onclick={() => handleSelect(flow.id)}
				>
					<span class="tf-item-icon">{flow.icon}</span>
					<div class="tf-item-body">
						<div class="tf-item-name">{flow.name}</div>
						<div class="tf-item-desc">{flow.description}</div>
					</div>
					<span class="tf-item-time">~{flow.estimatedMinutes}分钟</span>
				</button>
			{/each}
			<div class="tf-menu-footer">
				{#if $viewModeStore === "decision_maker"}
					<span class="tf-mode-tag">决策者视图</span>
				{/if}
				{#if !$sessionStore.loggedIn}
					<span class="tf-demo-tag">未登录将以 demo 模式启动(只读)</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.tf-dropdown {
		position: relative;
	}

	.tf-trigger {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: transparent;
		color: var(--border, #d1d5db);
		border: 1px solid var(--text-primary, #374151);
		border-radius: var(--radius-md, 6px);
		padding: 6px 12px;
		cursor: pointer;
		font-size: 13px;
		transition: all 0.15s ease;
	}
	.tf-trigger:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.tf-icon {
		font-size: 14px;
	}
	.tf-caret {
		font-size: 10px;
		opacity: 0.7;
		transition: transform 0.15s ease;
	}
	.tf-caret.open {
		transform: rotate(180deg);
	}

	.tf-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		min-width: 360px;
		background: var(--bg-card);
		border: 1px solid var(--border, #e5e7eb);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
		z-index: 100;
		overflow: hidden;
	}

	.tf-menu-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 16px;
		background: var(--bg-page, #f9fafb);
		border-bottom: 1px solid var(--border, #e5e7eb);
		font-size: 13px;
		font-weight: 600;
		color: var(--text-primary, #1f2937);
	}
	.tf-hint {
		font-size: 11px;
		font-weight: 400;
		color: var(--text-secondary, #6b7280);
	}

	.tf-item {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		width: 100%;
		padding: 12px 16px;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--bg-hover, #f3f4f6);
		cursor: pointer;
		text-align: left;
		transition: background 0.15s ease;
	}
	.tf-item:last-child {
		border-bottom: none;
	}
	.tf-item:hover {
		background: var(--info-bg, #eff6ff);
	}
	.tf-item-icon {
		font-size: 20px;
		flex-shrink: 0;
		margin-top: 2px;
	}
	.tf-item-body {
		flex: 1;
		min-width: 0;
	}
	.tf-item-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary, #1f2937);
		margin-bottom: 2px;
	}
	.tf-item-desc {
		font-size: 12px;
		color: var(--text-secondary, #6b7280);
		line-height: 1.4;
	}
	.tf-item-time {
		font-size: 11px;
		color: var(--text-secondary, #6b7280);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.tf-menu-footer {
		padding: 8px 16px;
		background: var(--bg-page, #f9fafb);
		border-top: 1px solid var(--border, #e5e7eb);
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.tf-mode-tag,
	.tf-demo-tag {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 10px;
	}
	.tf-mode-tag {
		background: var(--info-bg, #dbeafe);
		color: var(--info, var(--info, #1e40af));
	}
	.tf-demo-tag {
		background: var(--warning-bg, #fef3c7);
		color: var(--warning, var(--warning, #92400e));
	}

	@media (max-width: 768px) {
		.tf-label {
			display: none;
		}
		.tf-menu {
			min-width: 280px;
			right: -40px;
		}
	}
</style>
