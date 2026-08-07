<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P10 任务流向导进度条(浮在顶部导航下方)。
  P10_TASKFLOW_DEMO_DESIGN.md §3.1 + §5.2 定义。
  职责:显示当前任务流的进度条 + 步骤说明 + 上一步/下一步/取消按钮。
-->

<script lang="ts">
	import { taskFlowStore, nextStep, prevStep, jumpToStep, cancelTaskFlow } from "$lib/stores/task-flow";
	import { getCurrentFlowDef, getCurrentStepDef } from "$lib/stores/task-flow";
	import { toastInfo } from "$lib/stores/toast";

	const instance = $derived($taskFlowStore);
	const flowDef = $derived(getCurrentFlowDef());
	const stepDef = $derived(getCurrentStepDef());

	// demo 引导任务 ID 映射(完成时记录进度)
	const guidedTaskMap: Record<string, "try_add" | "try_query" | "try_edit" | "try_compliance"> = {
		add_rule: "try_add",
		query_issue: "try_query",
		edit_rule: "try_edit",
		compliance_gate: "try_compliance",
	};

	function handleNext() {
		if (!instance) return;
		const guidedId = instance.isDemo ? guidedTaskMap[instance.flowId] : undefined;
		nextStep({}, guidedId);
	}

	function handleComplete() {
		if (!instance) return;
		const guidedId = instance.isDemo ? guidedTaskMap[instance.flowId] : undefined;
		nextStep({}, guidedId); // 触发完成
		toastInfo("任务流已完成!", "🎉");
	}

	function handleCancel() {
		cancelTaskFlow(false);
		toastInfo("任务流已取消", "任务流");
	}
</script>

{#if instance && instance.status === "running" && flowDef}
	<div class="tfw-bar" role="region" aria-label="任务流进度">
		<div class="tfw-info">
			<span class="tfw-icon">{flowDef.icon}</span>
			<div class="tfw-text">
				<div class="tfw-title">
					{flowDef.name}
					{#if instance.isDemo}
						<span class="tfw-demo-badge">demo</span>
					{/if}
				</div>
				<div class="tfw-instruction">
					步骤 {instance.currentStep}/{flowDef.steps.length}:{stepDef?.name ?? ""}
				</div>
			</div>
		</div>

		<div class="tfw-progress">
			{#each flowDef.steps as step, i (step.id)}
				<button
					class="tfw-step"
					class:active={i + 1 === instance.currentStep}
					class:done={i + 1 < instance.currentStep}
					onclick={() => jumpToStep(i + 1)}
					title={step.instruction}
					aria-label={`跳转到步骤 ${i + 1}: ${step.name}`}
				>
					<span class="tfw-step-num">{i + 1 < instance.currentStep ? "✓" : i + 1}</span>
					<span class="tfw-step-name">{step.name}</span>
				</button>
				{#if i < flowDef.steps.length - 1}
					<span class="tfw-step-line" class:done={i + 1 < instance.currentStep}></span>
				{/if}
			{/each}
		</div>

		<div class="tfw-actions">
			<button
				class="tfw-btn"
				onclick={prevStep}
				disabled={instance.currentStep === 1}
				title="上一步"
			>
				← 上一步
			</button>
			{#if instance.currentStep < flowDef.steps.length}
				<button class="tfw-btn primary" onclick={handleNext}>
					下一步 →
				</button>
			{:else}
				<button class="tfw-btn success" onclick={handleComplete}>
					✓ 完成
				</button>
			{/if}
			<button class="tfw-btn ghost" onclick={handleCancel} title="取消任务流">
				✕
			</button>
		</div>
	</div>

	<div class="tfw-hint-bar">
		<span class="tfw-hint-icon">💡</span>
		<span class="tfw-hint-text">{stepDef?.instruction ?? ""}</span>
		<span class="tfw-hint-goal">完成条件:{stepDef?.completionHint ?? ""}</span>
	</div>
{/if}

<style>
	.tfw-bar {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 20px;
		background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
		color: white;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		flex-wrap: wrap;
	}

	.tfw-info {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-shrink: 0;
	}
	.tfw-icon {
		font-size: 24px;
	}
	.tfw-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.tfw-title {
		font-size: 14px;
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tfw-demo-badge {
		font-size: 10px;
		padding: 1px 6px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		font-weight: 400;
	}
	.tfw-instruction {
		font-size: 11px;
		opacity: 0.85;
	}

	.tfw-progress {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
		justify-content: center;
		flex-wrap: wrap;
	}
	.tfw-step {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 14px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.7);
		font-size: 12px;
		transition: all 0.15s ease;
	}
	.tfw-step:hover {
		background: rgba(255, 255, 255, 0.2);
		color: white;
	}
	.tfw-step.active {
		background: white;
		color: #2563eb;
		font-weight: 600;
		border-color: white;
	}
	.tfw-step.done {
		background: rgba(34, 197, 94, 0.3);
		border-color: rgba(34, 197, 94, 0.6);
		color: #bbf7d0;
	}
	.tfw-step-num {
		font-size: 11px;
		font-weight: 600;
	}
	.tfw-step-name {
		font-size: 11px;
	}
	.tfw-step-line {
		width: 16px;
		height: 2px;
		background: rgba(255, 255, 255, 0.2);
	}
	.tfw-step-line.done {
		background: rgba(34, 197, 94, 0.6);
	}

	.tfw-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.tfw-btn {
		padding: 5px 12px;
		background: rgba(255, 255, 255, 0.15);
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 4px;
		color: white;
		cursor: pointer;
		font-size: 12px;
		transition: all 0.15s ease;
	}
	.tfw-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.tfw-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.25);
	}
	.tfw-btn.primary {
		background: rgba(255, 255, 255, 0.9);
		color: #2563eb;
		font-weight: 600;
	}
	.tfw-btn.primary:hover:not(:disabled) {
		background: white;
	}
	.tfw-btn.success {
		background: #22c55e;
		border-color: #22c55e;
		font-weight: 600;
	}
	.tfw-btn.success:hover:not(:disabled) {
		background: #16a34a;
	}
	.tfw-btn.ghost {
		padding: 5px 8px;
		background: transparent;
		border-color: rgba(255, 255, 255, 0.3);
	}

	.tfw-hint-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 20px;
		background: #fef9c3;
		border-bottom: 1px solid #fde68a;
		font-size: 12px;
		color: #92400e;
		flex-wrap: wrap;
	}
	.tfw-hint-icon {
		font-size: 14px;
	}
	.tfw-hint-text {
		flex: 1;
	}
	.tfw-hint-goal {
		color: #78350f;
		font-size: 11px;
	}

	@media (max-width: 768px) {
		.tfw-bar {
			padding: 8px 12px;
			gap: 8px;
		}
		.tfw-step-name {
			display: none;
		}
		.tfw-instruction {
			display: none;
		}
		.tfw-hint-goal {
			display: none;
		}
	}
</style>
