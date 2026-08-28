<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — AI 生成测试输入 Dialog -->
<!--
  用途:自然语言 → 测试输入 JSON → 用户审核采用
  流程:
    1. 用户输入自然语言描述(如"注册 user_id=123 的用户")
    2. 点"生成输入"调 LLM,返回 JSON
    3. 用户审核(JSON 可编辑)
    4. 点"采用并复制"将 JSON 复制到剪贴板 + 关闭
    5. 用户切到执行台,Ctrl+V 粘贴到 instruction 输入框

  采用机制(clipboard 模式):
    - 内核 ExecutionPad 没暴露 instructionText setter(扩展槽只支持 callback)
    - 大众版用"复制到剪贴板"绕过此限制,无需修改内核
    - UX 友好,通用模式
-->

<script lang="ts">
	import { useAssistantOrNull, type AssistantProvider } from '$lib/kernel';
	import { closeAssistantDialog } from '$lib/stores/assistant-ui';
	import { LlmError } from '$lib/assistant/llm-fetch';

	const assistant: AssistantProvider | null = useAssistantOrNull();

	let description = $state('');
	let inputJson = $state('');
	let isLoading = $state(false);
	let errorMsg = $state<string | null>(null);
	let copied = $state(false);

	async function handleGenerate() {
		if (!assistant) {
			errorMsg = 'LLM 未注入(配置不完备?)';
			return;
		}
		if (!description.trim()) {
			errorMsg = '请先输入自然语言描述';
			return;
		}
		isLoading = true;
		errorMsg = null;
		inputJson = '';
		copied = false;
		try {
			const result = await assistant.generateInput(description);
			inputJson = JSON.stringify(result, null, 2);
		} catch (e) {
			const err = e as LlmError;
			errorMsg = err.message || '生成失败,请检查 LLM 配置';
		} finally {
			isLoading = false;
		}
	}

	function handleEditInput(event: Event) {
		inputJson = (event.target as HTMLTextAreaElement).value;
		copied = false;
	}

	async function handleAdopt() {
		if (!inputJson) return;
		// 校验 JSON
		try {
			JSON.parse(inputJson);
		} catch (e) {
			errorMsg = `JSON 不合法: ${(e as Error).message}`;
			return;
		}
		// 复制到剪贴板
		try {
			await navigator.clipboard.writeText(inputJson);
			copied = true;
			// 1.5 秒后自动关闭
			setTimeout(() => closeAssistantDialog(), 1500);
		} catch (e) {
			// clipboard API 失败(可能不是 https/localhost),fallback 手动复制
			errorMsg = `复制失败(${(e as Error).message}),请手动选择文本复制`;
		}
	}

	function handleClose() {
		closeAssistantDialog();
	}

	function handleRetry() {
		inputJson = '';
		errorMsg = null;
		copied = false;
		handleGenerate();
	}
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
		aria-labelledby="input-dialog-title"
	>
		<header class="dialog-header">
			<h2 id="input-dialog-title">🧪 AI 生成测试输入</h2>
			<button class="close-btn" onclick={handleClose} aria-label="关闭">×</button>
		</header>

		<main class="dialog-body">
			<!-- 1. 描述输入 -->
			<section class="step">
				<label for="input-description">1. 用自然语言描述你想要的测试输入:</label>
				<textarea
					id="input-description"
					bind:value={description}
					placeholder="例如:注册一个 user_id=123、name='张三' 的成年用户"
					rows="2"
					disabled={isLoading}
				></textarea>
				<div class="actions">
					<button class="btn btn-primary" onclick={handleGenerate} disabled={isLoading || !description.trim()}>
						{isLoading ? '⏳ 生成中...' : '✨ 生成输入'}
					</button>
				</div>
			</section>

			{#if errorMsg}
				<div class="alert alert-error">
					<strong>❌ 出错了:</strong> {errorMsg}
					<button class="btn btn-mini" onclick={handleRetry}>重试</button>
				</div>
			{/if}

			{#if inputJson}
				<section class="step">
					<label for="input-json">2. 测试输入 JSON(可手动修改):</label>
					<textarea
						id="input-json"
						value={inputJson}
						oninput={handleEditInput}
						rows="8"
						class="code"
						disabled={isLoading || copied}
					></textarea>

					<div class="hint">
						ℹ️ 点"采用并复制"将 JSON 复制到剪贴板,然后在执行台按 Ctrl+V 粘贴到输入框
					</div>
				</section>
			{/if}

			{#if copied}
				<div class="alert alert-success">
					✅ 已复制到剪贴板!切到执行台按 Ctrl+V 粘贴即可
				</div>
			{/if}
		</main>

		<footer class="dialog-footer">
			<button class="btn btn-secondary" onclick={handleClose} disabled={isLoading}>
				放弃
			</button>
			{#if inputJson && !copied}
				<button class="btn btn-primary" onclick={handleAdopt} disabled={isLoading}>
					📋 采用并复制到剪贴板
				</button>
			{/if}
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
	.step {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.step label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-gray-700);
	}
	textarea {
		width: 100%;
		padding: var(--spacing-sm);
		border: 1px solid var(--color-gray-300);
		border-radius: var(--radius-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		resize: vertical;
		box-sizing: border-box;
	}
	textarea.code {
		font-family: var(--font-mono);
	}
	textarea:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
	}
	.actions {
		display: flex;
		gap: var(--spacing-sm);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-gray-600);
		background: var(--color-gray-100);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-md);
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
	.alert-success {
		background: var(--color-success);
		color: #fff;
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
