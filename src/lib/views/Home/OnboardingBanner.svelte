<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P11 缺口 3:首屏引导横幅 OnboardingBanner。
  P11_UX_GAPS_FIX_DESIGN.md §4.5 定义。
  职责:首次进入工作台(状态 C)时显示引导横幅,指引新手下一步操作。
  关闭后 localStorage 记录,不再重复显示。
-->

<script lang="ts">
	import { browser } from "$app/environment";
	import { goto } from "$app/navigation";
	import { taskFlowsDef } from "$lib/data/task-flows";
	import { startTaskFlow } from "$lib/stores/task-flow";
	import { sessionStore } from "$lib/stores/session";
	import { toastInfo } from "$lib/stores/toast";

	const STORAGE_KEY = "evorule-console-cloud:onboarding-banner";

	let dismissed = $state(false);

	if (browser) {
		try {
			dismissed = localStorage.getItem(STORAGE_KEY) === "seen";
		} catch {
			dismissed = false;
		}
	}

	function handleDismiss() {
		dismissed = true;
		if (browser) {
			try {
				localStorage.setItem(STORAGE_KEY, "seen");
			} catch {
				// 静默失败
			}
		}
		toastInfo("引导横幅已关闭,可从设置重新显示", "新手引导");
	}

	function handleStartTask() {
		// 启动「加规则」任务流(最常见的新手任务)
		startTaskFlow("add_rule", false);
		handleDismiss();
	}

	function handleViewRules() {
		goto("/view/rules");
		handleDismiss();
	}

	const username = $derived($sessionStore.username ?? "用户");
</script>

{#if !dismissed}
	<div class="ob-banner" role="region" aria-label="新手引导">
		<div class="ob-content">
			<span class="ob-icon">👋</span>
			<div class="ob-text">
				<div class="ob-title">欢迎,{username}!这里是你的 evorule 工作台</div>
				<div class="ob-desc">
					新手上路建议:① 加一条业务规则 → ② 在执行台测试 → ③ 查看审计链。
					或直接启动「任务流」向导,4 步体验完整链路。
				</div>
			</div>
			<div class="ob-actions">
				<button class="ob-btn primary" onclick={handleStartTask}>
					🎯 启动任务流
				</button>
				<button class="ob-btn" onclick={handleViewRules}>
					📜 查看规则库
				</button>
				<button class="ob-close" onclick={handleDismiss} title="关闭(不再显示)" aria-label="关闭引导横幅">
					✕
				</button>
			</div>
		</div>
		<!-- 快捷任务流入口 -->
		<div class="ob-quick-flows">
			<span class="ob-quick-label">快捷任务:</span>
			{#each taskFlowsDef.slice(0, 3) as flow (flow.id)}
				<button
					class="ob-quick-flow"
					onclick={() => {
						startTaskFlow(flow.id, false);
						handleDismiss();
					}}
				>
					<span>{flow.icon}</span>
					<span>{flow.name}</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.ob-banner {
		background: linear-gradient(135deg, #dbeafe 0%, #ede9fe 100%);
		border: 1px solid var(--color-info, #3b82f6);
		border-radius: 8px;
		padding: 14px 18px;
		margin-bottom: 16px;
	}
	.ob-content {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.ob-icon {
		font-size: 28px;
		flex-shrink: 0;
	}
	.ob-text {
		flex: 1;
		min-width: 200px;
	}
	.ob-title {
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary, #1f2937);
		margin-bottom: 4px;
	}
	.ob-desc {
		font-size: 12px;
		color: var(--color-text-secondary, #6b7280);
		line-height: 1.5;
	}
	.ob-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.ob-btn {
		padding: 6px 14px;
		background: white;
		border: 1px solid var(--color-gray-300, #d1d5db);
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
		color: var(--color-text-primary, #1f2937);
		transition: all 0.15s ease;
	}
	.ob-btn:hover {
		background: var(--color-gray-50, #f9fafb);
	}
	.ob-btn.primary {
		background: var(--color-primary, #3b82f6);
		color: white;
		border-color: var(--color-primary, #3b82f6);
	}
	.ob-btn.primary:hover {
		opacity: 0.9;
	}
	.ob-close {
		background: transparent;
		border: none;
		font-size: 14px;
		cursor: pointer;
		color: var(--color-text-secondary, #6b7280);
		padding: 4px;
		line-height: 1;
	}
	.ob-close:hover {
		color: var(--color-text-primary, #1f2937);
	}

	.ob-quick-flows {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px dashed var(--color-gray-300, #d1d5db);
		flex-wrap: wrap;
	}
	.ob-quick-label {
		font-size: 12px;
		color: var(--color-text-secondary, #6b7280);
		font-weight: 500;
	}
	.ob-quick-flow {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 10px;
		background: white;
		border: 1px solid var(--color-gray-200, #e5e7eb);
		border-radius: 12px;
		cursor: pointer;
		font-size: 12px;
		color: var(--color-text-primary, #1f2937);
		transition: all 0.15s ease;
	}
	.ob-quick-flow:hover {
		border-color: var(--color-primary, #3b82f6);
		color: var(--color-primary, #3b82f6);
	}

	@media (max-width: 768px) {
		.ob-content {
			flex-direction: column;
			align-items: flex-start;
		}
		.ob-actions {
			width: 100%;
			justify-content: flex-end;
		}
	}
</style>
