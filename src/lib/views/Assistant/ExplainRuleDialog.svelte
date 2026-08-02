<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — AI 解释规则 Dialog -->
<!--
  用途:JSON 规则 → 自然语言说明(只读,不改规则)
  流程:
    1. 自动用当前选中规则的 JSON 调 LLM
    2. 显示说明文字(用户只读)
    3. 可"重新生成"或"关闭"

  关键约束:
    - 不修改规则(纯解释)
    - 不写入规则库
    - LLM 输出不影响任何状态
-->

<script lang="ts">
	import { useAssistantOrNull, type AssistantProvider, selectedRule } from '@evorule/console';
	import { closeAssistantDialog } from '$lib/stores/assistant-ui';
	import { LlmError } from '$lib/assistant/llm-fetch';

	const assistant: AssistantProvider | null = useAssistantOrNull();

	let explanation = $state('');
	let isLoading = $state(false);
	let errorMsg = $state<string | null>(null);

	async function handleExplain() {
		if (!assistant) {
			errorMsg = 'LLM 未注入(配置不完备?)';
			return;
		}
		const rule = $selectedRule;
		if (!rule) {
			errorMsg = '未选中规则';
			return;
		}
		isLoading = true;
		errorMsg = null;
		explanation = '';
		try {
			// rule.content 是 JSON 字符串,先解析为对象再传
			const ruleObj = JSON.parse(rule.content);
			const text = await assistant.explainRule(ruleObj);
			explanation = text;
		} catch (e) {
			// JSON.parse 错误
			if (e instanceof SyntaxError) {
				errorMsg = `规则 JSON 解析失败: ${e.message}`;
			} else {
				const err = e as LlmError;
				errorMsg = err.message || '解释失败,请检查 LLM 配置';
			}
		} finally {
			isLoading = false;
		}
	}

	function handleClose() {
		closeAssistantDialog();
	}

	// 自动触发解释(组件挂载时)
	$effect(() => {
		// 只在第一次触发,避免重复
		if (!explanation && !isLoading && !errorMsg) {
			handleExplain();
		}
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && handleClose()} />

<div
	class="dialog-overlay"
	onclick={handleClose}
	onkeydown={(e) => e.key === 'Enter' && handleClose()}
	role="button"
	tabindex="0"
	aria-label="点击空白处关闭对话框"
>
	<div
		class="dialog"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-labelledby="explain-dialog-title"
	>
		<header class="dialog-header">
			<h2 id="explain-dialog-title">📚 AI 解释规则</h2>
			<button class="close-btn" onclick={handleClose} aria-label="关闭">×</button>
		</header>

		<main class="dialog-body">
			{#if $selectedRule}
				<section class="rule-info">
					<div class="info-row">
						<span class="label">规则 ID:</span>
						<code>{$selectedRule.id}</code>
					</div>
					<div class="info-row">
						<span class="label">描述:</span>
						<span>{$selectedRule.description}</span>
					</div>
				</section>
			{:else}
				<div class="alert alert-warning">未选中规则,无法解释</div>
			{/if}

			{#if isLoading}
				<div class="loading">
					<span class="spinner">⏳</span>
					<p>AI 正在分析规则...</p>
				</div>
			{/if}

			{#if errorMsg}
				<div class="alert alert-error">
					<strong>❌ 出错了:</strong> {errorMsg}
					<button class="btn btn-mini" onclick={handleExplain}>重试</button>
				</div>
			{/if}

			{#if explanation}
				<section class="explanation">
					<label for="explanation-text">AI 说明:</label>
				<div class="explanation-text" id="explanation-text" role="region" aria-live="polite">{explanation}</div>
				</section>
			{/if}
		</main>

		<footer class="dialog-footer">
			<button class="btn btn-secondary" onclick={handleExplain} disabled={isLoading || !$selectedRule}>
				🔄 重新生成
			</button>
			<button class="btn btn-primary" onclick={handleClose} disabled={isLoading}>
				关闭
			</button>
		</footer>
	</div>
</div>

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: var(--spacing-md);
	}
	.dialog {
		background: var(--color-gray-50);
		color: var(--color-gray-900);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xl);
		max-width: 700px;
		width: 100%;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--spacing-md) var(--spacing-lg);
		background: var(--color-gray-900);
		color: #fff;
	}
	.dialog-header h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.close-btn {
		background: transparent;
		color: #fff;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		line-height: 1;
		padding: 0 var(--spacing-xs);
	}
	.close-btn:hover {
		opacity: 0.7;
	}
	.dialog-body {
		padding: var(--spacing-lg);
		overflow-y: auto;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.rule-info {
		background: var(--color-gray-100);
		padding: var(--spacing-md);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		font-size: var(--text-sm);
	}
	.info-row {
		display: flex;
		gap: var(--spacing-sm);
	}
	.info-row .label {
		font-weight: 500;
		color: var(--color-gray-700);
		min-width: 80px;
	}
	.info-row code {
		font-family: var(--font-mono);
		background: var(--color-gray-200);
		padding: 0 var(--spacing-xs);
		border-radius: var(--radius-sm);
	}
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-xl);
		color: var(--color-gray-600);
	}
	.spinner {
		font-size: 2rem;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.alert {
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}
	.alert-error {
		background: var(--color-error);
		color: #fff;
	}
	.alert-warning {
		background: var(--color-warning);
		color: #fff;
	}
	.explanation {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.explanation label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-gray-700);
	}
	.explanation-text {
		padding: var(--spacing-md);
		background: var(--color-gray-100);
		border-radius: var(--radius-md);
		font-size: var(--text-base);
		line-height: 1.6;
		white-space: pre-wrap;
		color: var(--color-gray-900);
	}
	.btn {
		padding: var(--spacing-sm) var(--spacing-md);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
		transition: all var(--transition-fast);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary {
		background: var(--color-primary);
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-secondary {
		background: var(--color-gray-200);
		color: var(--color-gray-800);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--color-gray-300);
	}
	.btn-mini {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--text-xs);
	}
	.dialog-footer {
		padding: var(--spacing-md) var(--spacing-lg);
		background: var(--color-gray-100);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		border-top: 1px solid var(--color-gray-200);
	}
</style>
