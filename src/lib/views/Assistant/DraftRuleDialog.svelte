<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — AI 辅助创建规则 Dialog -->
<!--
  用途:自然语言 → JSON 规则草案 → 校验 → 用户审核采用
  流程:
    1. 用户输入自然语言描述(如"注册时给 status=ok")
    2. 点"生成草案"调 LLM,显示返回的 JSON + 校验结果
    3. 用户审核草案(JSON 可编辑)
    4. 点"采用"将草案作为新规则加入规则库(用户可后续编辑)
    5. 或点"放弃"关闭,不影响任何状态

  关键约束(与 evorule 边界一致):
    - LLM 只生成草案,最终规则由用户审核
    - 草案经内核 RuleValidator 校验(显示 G1-G7 错误)
    - 采用后规则进入 user 规则库,不会自动执行
-->

<script lang="ts">
	import {
		useAssistantOrNull,
		addRule,
		useWorkspaceBackend,
		currentWorkspace,
		type AssistantProvider
	} from '$lib/kernel';
	import { RuleValidator, friendlyRuleError, type ValidationResult } from '$lib/kernel';
	import { get } from 'svelte/store';
	import { closeAssistantDialog } from '$lib/stores/assistant-ui';
	import { LlmError } from '$lib/assistant/llm-fetch';
	import { t } from '$lib/locale';

	const assistant: AssistantProvider | null = useAssistantOrNull();
	// backend 在组件初始化期捕获(Svelte 5 context 不支持事件处理器内调用)
	const wb = useWorkspaceBackend();

	let description = $state('');
	let draftJson = $state('');
	let confidence = $state(0);
	let validation = $state<ValidationResult | null>(null);
	let isLoading = $state(false);
	let errorMsg = $state<string | null>(null);
	let adopted = $state(false);

	async function handleGenerate() {
		if (!assistant) {
			errorMsg = t('draft.err.noAssistant');
			return;
		}
		if (!description.trim()) {
			errorMsg = t('draft.err.enterDescription');
			return;
		}
		isLoading = true;
		errorMsg = null;
		validation = null;
		draftJson = '';
		confidence = 0;
		adopted = false;
		try {
			const result = await assistant.generateRuleDraft(description);
			draftJson = JSON.stringify(result.rule, null, 2);
			confidence = result.confidence;
			// 校验草案(显示 G1-G7 错误供用户参考)
			validation = RuleValidator.validate(draftJson);
		} catch (e) {
			const err = e as LlmError;
			errorMsg = err.message || t('draft.err.genFail');
		} finally {
			isLoading = false;
		}
	}

	async function handleAdopt() {
		if (!draftJson) return;
		// 校验:尝试 JSON.parse 确认是合法 JSON
		try {
			JSON.parse(draftJson);
		} catch (e) {
			errorMsg = t('draft.err.invalidJson', { message: (e as Error).message });
			return;
		}
		// 加入 workspace 规则库(用户可后续编辑)
		const ws = get(currentWorkspace);
		if (!ws) {
			errorMsg = t('draft.err.noWorkspace');
			return;
		}
		const id = `user.ai_draft.${Date.now()}`;
		try {
			await addRule(wb, ws.id, {
				name: id,
				content: draftJson,
				description: `AI 草案: ${description.slice(0, 50)}${description.length > 50 ? '...' : ''}`
			});
		} catch (e) {
			errorMsg = t('draft.err.saveFailed', { message: (e as Error).message });
			return;
		}
		adopted = true;
		// 自动关闭(给个短暂反馈)
		setTimeout(() => closeAssistantDialog(), 800);
	}

	function handleGiveUp() {
		closeAssistantDialog();
	}

	function handleRetry() {
		// 清掉结果,保留描述,重新生成
		draftJson = '';
		validation = null;
		errorMsg = null;
		adopted = false;
		handleGenerate();
	}

	function handleEditDraft(event: Event) {
		// 用户手动改草案 JSON,实时校验
		draftJson = (event.target as HTMLTextAreaElement).value;
		validation = RuleValidator.validate(draftJson);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && handleGiveUp()} />

<div
	class="dialog-overlay"
	onclick={handleGiveUp}
	onkeydown={(e) => e.key === 'Enter' && handleGiveUp()}
	role="button"
	tabindex="0"
	aria-label={t('draft.closeOverlayAria')}
>
	<div
		class="dialog"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-labelledby="draft-dialog-title"
	>
		<header class="dialog-header">
			<h2 id="draft-dialog-title">{t('draft.title')}</h2>
			<button class="close-btn" onclick={handleGiveUp} aria-label={t('draft.closeBtnAria')}>×</button>
		</header>

		<main class="dialog-body">
			<!-- 1. 描述输入 -->
			<section class="step">
				<label for="draft-description">{t('draft.step1Label')}</label>
				<textarea
					id="draft-description"
					bind:value={description}
					placeholder={t('draft.descPlaceholder')}
					rows="3"
					disabled={isLoading}
				></textarea>
				<div class="actions">
					<button class="btn btn-primary" onclick={handleGenerate} disabled={isLoading || !description.trim()}>
						{isLoading ? t('common.generating') : t('draft.generateBtn')}
					</button>
				</div>
			</section>

			<!-- 2. 错误提示 -->
			{#if errorMsg}
				<div class="alert alert-error">
					<strong>{t('draft.errorLabel')}</strong> {errorMsg}
					<button class="btn btn-mini" onclick={handleRetry}>{t('draft.retry')}</button>
				</div>
			{/if}

			<!-- 3. 草案展示 + 校验 -->
			{#if draftJson}
				<section class="step">
					<label for="draft-json">{t('draft.step2Label')}</label>
					<textarea
						id="draft-json"
						value={draftJson}
						oninput={handleEditDraft}
						rows="10"
						class="code"
						disabled={isLoading || adopted}
					></textarea>

					<!-- 置信度 -->
					<div class="confidence">
						<span class="label">{t('draft.confidenceLabel')}</span>
						<span class="value" class:high={confidence >= 0.7} class:low={confidence < 0.4}>
							{(confidence * 100).toFixed(0)}%
						</span>
					</div>

					<!-- 校验结果 -->
					{#if validation}
						<div class="validation">
							{#if validation.valid}
								<div class="alert alert-success">
									{t('draft.validPass')}
								</div>
							{:else}
								<div class="alert alert-warning">
									<strong>{t('draft.validFail', { count: validation.errors.length })}</strong>
									<ul>
										{#each validation.errors as err}
										<li>
											<code>{err.gate}</code>
											{friendlyRuleError(err.message)}
										</li>
									{/each}
									</ul>
									<small>{t('draft.editHint')}</small>
								</div>
							{/if}
						</div>
					{/if}
				</section>
			{/if}

			<!-- 4. 采用反馈 -->
			{#if adopted}
				<div class="alert alert-success">{t('draft.adopted')}</div>
			{/if}
		</main>

		<footer class="dialog-footer">
			<button class="btn btn-secondary" onclick={handleGiveUp} disabled={isLoading}>
				{t('draft.giveUp')}
			</button>
			{#if draftJson && !adopted}
				<button class="btn btn-primary" onclick={handleAdopt} disabled={isLoading}>
					{t('draft.adopt')}
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
		max-width: 800px;
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
	.alert-success {
		background: var(--success);
		color: #fff;
	}
	.alert-warning {
		background: var(--warning);
		color: #fff;
		flex-direction: column;
		align-items: flex-start;
	}
	.alert-warning ul {
		margin: var(--spacing-xs) 0 0;
		padding-left: var(--spacing-lg);
	}
	.alert-warning code {
		background: rgba(0, 0, 0, 0.2);
		padding: 0 var(--spacing-xs);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}
	.confidence {
		display: flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--text-sm);
	}
	.confidence .label {
		color: var(--text-secondary);
	}
	.confidence .value {
		font-weight: 600;
	}
	.confidence .value.high {
		color: var(--success);
	}
	.confidence .value.low {
		color: var(--danger);
	}
	.dialog-footer {
		padding: var(--spacing-md) var(--spacing-lg);
		background: var(--bg-hover);
		display: flex;
		justify-content: flex-end;
		gap: var(--spacing-sm);
		border-top: 1px solid var(--border);
	}
</style>
