<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — AI 转译命令 Dialog(L2 P2,07 立项 §2.2) -->
<!--
  用途:自然语言 → 命令指令 JSON 草稿 → 填入执行台 textarea
  流程:
    1. 用户输入自然语言描述(如"把报销金额设为 10000")
    2. 点"生成命令草案"调 assistant.transpileCommand(第 4 操作,
       purpose=transpile_command,走既有双通道审计链)
    3. 草稿展示 + 展示层静态校验(JSON.parse + type ∈ 协议白名单,
       只帮人提前发现笔误,不替代引擎 fail-fast;校验器不改产物)
    4. 用户可编辑,点"填入执行台"写入 pendingInstructionDraft 信箱
    5. ExecutionPad 消费信箱填入 textarea → 人点击提交才走既有命令链
       ——LLM 永远不直接提交命令

  填入机制(信箱模式,与 GenerateInputDialog 的 clipboard 模式不同):
    - 本转译器的主路径就是执行台,clipboard 绕行无必要
    - 内核 ExecutionPad 只见 aiDraft string prop + onaiDraftConsumed
      callback(由执行台页面透传),不感知本 store(内核边界不破)
-->

<script lang="ts">
	import { useAssistantOrNull } from '$lib/kernel';
	import type { LlmAssistant } from '$lib/assistant/types';
	import {
		closeAssistantDialog,
		pendingInstructionDraft
	} from '$lib/stores/assistant-ui';
	import { COMMAND_INSTRUCTION_TYPES } from '$lib/assistant/prompts';
	import { LlmError } from '$lib/assistant/llm-fetch';

	// 注入实例是 LlmAssistant(超集,含 transpileCommand);内核槽类型只声明
	// 三方法,这里在大众版层收窄(与 +layout.svelte provideLlm 注入一致)
	const assistant = useAssistantOrNull() as LlmAssistant | null;

	let description = $state('');
	let draftJson = $state('');
	let isLoading = $state(false);
	let errorMsg = $state<string | null>(null);
	let filled = $state(false);

	// 展示层静态校验结果(纯提示,不阻断填入——产物可改,引擎才权威)
	let draftParseOk = $derived(((): boolean => {
		try {
			JSON.parse(draftJson);
			return true;
		} catch {
			return false;
		}
	})());
	let draftTypeError = $derived(((): string | null => {
		if (!draftJson || !draftParseOk) return null;
		try {
			const t = (JSON.parse(draftJson) as { type?: unknown }).type;
			if (typeof t === 'string' && COMMAND_INSTRUCTION_TYPES.includes(t)) return null;
			return typeof t === 'string' ? t : String(t);
		} catch {
			return null;
		}
	})());

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
		draftJson = '';
		filled = false;
		try {
			const result = await assistant.transpileCommand(description);
			draftJson = JSON.stringify(result, null, 2);
		} catch (e) {
			const err = e as LlmError;
			errorMsg = err.message || '转译失败,请检查 LLM 配置';
		} finally {
			isLoading = false;
		}
	}

	function handleEditDraft(event: Event) {
		draftJson = (event.target as HTMLTextAreaElement).value;
		filled = false;
	}

	function handleFill() {
		if (!draftJson) return;
		// 一次性信箱:写入后由执行台消费并回调清空(经页面 onaiDraftConsumed)
		pendingInstructionDraft.set(draftJson);
		filled = true;
		closeAssistantDialog();
	}

	function handleClose() {
		closeAssistantDialog();
	}

	function handleRetry() {
		draftJson = '';
		errorMsg = null;
		filled = false;
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
		aria-labelledby="transpile-dialog-title"
	>
		<header class="dialog-header">
			<h2 id="transpile-dialog-title">⌨ AI 转译命令</h2>
			<button class="close-btn" onclick={handleClose} aria-label="关闭">×</button>
		</header>

		<main class="dialog-body">
			<!-- 1. 自然语言描述 -->
			<section class="step">
				<label for="transpile-description">1. 用自然语言描述你要提交的命令:</label>
				<textarea
					id="transpile-description"
					bind:value={description}
					placeholder="例如:把报销金额 amount 设为 10000"
					rows="2"
					disabled={isLoading}
				></textarea>
				<div class="actions">
					<button class="btn btn-primary" onclick={handleGenerate} disabled={isLoading || !description.trim()}>
						{isLoading ? '⏳ 转译中...' : '✨ 生成命令草案'}
					</button>
				</div>
			</section>

			{#if errorMsg}
				<div class="alert alert-error">
					<strong>❌ 出错了:</strong> {errorMsg}
					<button class="btn btn-mini" onclick={handleRetry}>重试</button>
				</div>
			{/if}

			{#if draftJson}
				<section class="step">
					<label for="transpile-draft">2. 命令 JSON 草稿(可手动修改):</label>
					<textarea
						id="transpile-draft"
						value={draftJson}
						oninput={handleEditDraft}
						rows="8"
						class="code"
						disabled={isLoading}
					></textarea>

					<!-- 展示层静态校验:纯提示,不阻断填入(引擎 fail-fast 才权威) -->
					{#if !draftParseOk}
						<div class="hint warn">⚠ 不是合法 JSON,填入后执行台会报解析错误,请修正</div>
					{:else if draftTypeError}
						<div class="hint warn">
							⚠ type "{draftTypeError}" 不在协议白名单({COMMAND_INSTRUCTION_TYPES.join(' / ')}),可能是业务自定义指令,提交前请人工确认
						</div>
					{:else}
						<div class="hint">✓ JSON 合法,type 在协议白名单内</div>
					{/if}
				</section>
			{/if}
		</main>

		<footer class="dialog-footer">
			<span class="footer-hint">草稿仅填入执行台输入区,需你确认后提交</span>
			<button class="btn btn-secondary" onclick={handleClose} disabled={isLoading}>
				放弃
			</button>
			{#if draftJson}
				<button class="btn btn-primary" onclick={handleFill} disabled={isLoading}>
					⬇ 填入执行台
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
		background: var(--bg-page);
		color: var(--text-primary);
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
		background: var(--text-primary);
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
		color: var(--text-primary);
	}
	textarea {
		width: 100%;
		padding: var(--spacing-sm);
		border: 1px solid var(--border);
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
		border-color: var(--brand);
		box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
	}
	.actions {
		display: flex;
		gap: var(--spacing-sm);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		background: var(--bg-hover);
		padding: var(--spacing-xs) var(--spacing-sm);
		border-radius: var(--radius-md);
	}
	.hint.warn {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, var(--bg-hover));
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
		background: var(--brand);
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--brand-hover);
	}
	.btn-secondary {
		background: var(--border);
		color: var(--text-primary);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--border);
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
		background: var(--danger);
		color: #fff;
	}
	.dialog-footer {
		padding: var(--spacing-md) var(--spacing-lg);
		background: var(--bg-hover);
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: var(--spacing-sm);
		border-top: 1px solid var(--border);
	}
	.footer-hint {
		margin-right: auto;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
</style>
