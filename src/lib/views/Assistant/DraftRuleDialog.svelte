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
	import { useAssistantOrNull, addRule, type AssistantProvider } from '@evorule/console';
	import { RuleValidator, type ValidationResult } from '@evorule/console';
	import { closeAssistantDialog } from '$lib/stores/assistant-ui';
	import { LlmError } from '$lib/assistant/llm-fetch';

	const assistant: AssistantProvider | null = useAssistantOrNull();

	let description = $state('');
	let draftJson = $state('');
	let confidence = $state(0);
	let validation = $state<ValidationResult | null>(null);
	let isLoading = $state(false);
	let errorMsg = $state<string | null>(null);
	let adopted = $state(false);

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
			errorMsg = err.message || '生成失败,请检查 LLM 配置';
		} finally {
			isLoading = false;
		}
	}

	function handleAdopt() {
		if (!draftJson) return;
		// 校验:尝试 JSON.parse 确认是合法 JSON
		try {
			JSON.parse(draftJson);
		} catch (e) {
			errorMsg = `草案 JSON 不合法: ${(e as Error).message}`;
			return;
		}
		// 加入 user 规则库(用户可后续编辑)
		const id = `user.ai_draft.${Date.now()}`;
		addRule({
			id,
			version: 1,
			description: `AI 草案: ${description.slice(0, 50)}${description.length > 50 ? '...' : ''}`,
			content: draftJson
		});
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
	aria-label="点击空白处关闭对话框"
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
			<h2 id="draft-dialog-title">🤖 AI 辅助创建规则</h2>
			<button class="close-btn" onclick={handleGiveUp} aria-label="关闭">×</button>
		</header>

		<main class="dialog-body">
			<!-- 1. 描述输入 -->
			<section class="step">
				<label for="draft-description">1. 用自然语言描述你想要的规则:</label>
				<textarea
					id="draft-description"
					bind:value={description}
					placeholder="例如:用户注册时,如果年龄 < 18 岁,设置 status='minor',否则 status='adult'"
					rows="3"
					disabled={isLoading}
				></textarea>
				<div class="actions">
					<button class="btn btn-primary" onclick={handleGenerate} disabled={isLoading || !description.trim()}>
						{isLoading ? '⏳ 生成中...' : '✨ 生成草案'}
					</button>
				</div>
			</section>

			<!-- 2. 错误提示 -->
			{#if errorMsg}
				<div class="alert alert-error">
					<strong>❌ 出错了:</strong> {errorMsg}
					<button class="btn btn-mini" onclick={handleRetry}>重试</button>
				</div>
			{/if}

			<!-- 3. 草案展示 + 校验 -->
			{#if draftJson}
				<section class="step">
					<label for="draft-json">2. 草案(JSON,可手动修改):</label>
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
						<span class="label">LLM 置信度:</span>
						<span class="value" class:high={confidence >= 0.7} class:low={confidence < 0.4}>
							{(confidence * 100).toFixed(0)}%
						</span>
					</div>

					<!-- 校验结果 -->
					{#if validation}
						<div class="validation">
							{#if validation.valid}
								<div class="alert alert-success">
									✅ 草案通过 G1-G7 预校验(注意:核心仓 build.rs 仍是最终拦截)
								</div>
							{:else}
								<div class="alert alert-warning">
									<strong>⚠️ 校验未通过(共 {validation.errors.length} 项):</strong>
									<ul>
										{#each validation.errors as err}
											<li>
												<code>{err.gate}</code>
												{err.message}
											</li>
										{/each}
									</ul>
									<small>请修改草案或重新生成,采用后仍可编辑</small>
								</div>
							{/if}
						</div>
					{/if}
				</section>
			{/if}

			<!-- 4. 采用反馈 -->
			{#if adopted}
				<div class="alert alert-success">✅ 已采用!规则已加入"用户规则"列表,可在规则库查看 / 编辑</div>
			{/if}
		</main>

		<footer class="dialog-footer">
			<button class="btn btn-secondary" onclick={handleGiveUp} disabled={isLoading}>
				放弃
			</button>
			{#if draftJson && !adopted}
				<button class="btn btn-primary" onclick={handleAdopt} disabled={isLoading}>
					✅ 采用并加入规则库
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
	.alert-warning {
		background: var(--color-warning);
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
		color: var(--color-gray-600);
	}
	.confidence .value {
		font-weight: 600;
	}
	.confidence .value.high {
		color: var(--color-success);
	}
	.confidence .value.low {
		color: var(--color-error);
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
