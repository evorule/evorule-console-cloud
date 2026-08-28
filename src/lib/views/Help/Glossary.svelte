<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PR4 · 术语表弹窗(Glossary)。PR10-重2 扩展为「帮助中心」:
  - 搜索框同时检索术语表(searchGlossary)与 docs/ 文档(searchHelpDocs);
  - 结果分「术语」「文档」两段展示;
  - LLM 已配置时显示「问 AI」按钮,把当前问题发给 askHelp 做只读问答,内联展示回答。
  依赖:src/lib/data/glossary.ts(GLOSSARY / searchGlossary)
        src/lib/data/help-index.ts(searchHelpDocs)
        src/lib/assistant/help-qa.ts(askHelp)
  关闭:onclose 回调(点击遮罩 / × / Esc)
-->

<script lang="ts">
	import { get } from 'svelte/store';
	import { GLOSSARY, searchGlossary } from '$lib/data/glossary';
	import { searchHelpDocs } from '$lib/data/help-index';
	import { askHelp } from '$lib/assistant/help-qa';
	import { llmConfig, isLlmConfigured } from '$lib/config/llm-config';

	let { onclose }: { onclose?: () => void } = $props();

	let query = $state('');
	const termResults = $derived(searchGlossary(query));
	const docResults = $derived(searchHelpDocs(query));

	// === LLM 只读问答(PR10-重2) ===
	let aiAnswer = $state<string | null>(null);
	let aiLoading = $state(false);
	let aiError = $state<string | null>(null);

	const llmReady = $derived(isLlmConfigured($llmConfig));

	async function askAi(): Promise<void> {
		if (aiLoading) return;
		aiLoading = true;
		aiError = null;
		aiAnswer = null;
		try {
			aiAnswer = await askHelp(query, get(llmConfig));
		} catch (e) {
			aiError = (e as Error).message;
		} finally {
			aiLoading = false;
		}
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose?.();
	}

	function handleBackdrop(e: MouseEvent) {
		// 仅点击遮罩本身(非内容区)关闭
		if (e.target === e.currentTarget) onclose?.();
	}
</script>

<svelte:window onkeydown={handleKey} />

<div
	class="glossary-backdrop"
	role="presentation"
	onclick={handleBackdrop}
>
	<div
		class="glossary-modal"
		role="dialog"
		aria-modal="true"
		aria-label="evorule 帮助中心"
	>
		<header class="gl-header">
			<div class="gl-title">
				<span class="gl-emoji">📖</span>
				<div>
					<h2>帮助中心</h2>
					<p class="gl-sub">搜术语、查文档,或让 AI 直接解答你的使用问题</p>
				</div>
			</div>
			<button class="gl-close" onclick={() => onclose?.()} aria-label="关闭帮助中心" title="关闭">
				✕
			</button>
		</header>

		<div class="gl-search">
			<svg class="gl-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
			<input
				type="text"
				bind:value={query}
				placeholder="搜索术语或帮助文档,如:审计链 / 规则 / 怎么建库…"
				aria-label="搜索帮助"
			/>
			{#if query}
				<button class="gl-clear" onclick={() => (query = '')} aria-label="清除搜索" title="清除">✕</button>
			{/if}
			{#if llmReady}
				<button
					class="gl-ask"
					onclick={() => void askAi()}
					disabled={aiLoading}
					title={query.trim() ? `用 AI 解答「${query.trim()}」` : '用 AI 介绍一下 evorule'}
				>
					{aiLoading ? '思考中…' : '问 AI'}
				</button>
			{/if}
		</div>

		<div class="gl-count">
			{#if query}
				术语 {termResults.length} 条 · 文档 {docResults.length} 条
			{:else}
				术语 {GLOSSARY.length} 条 · 文档库已索引
			{/if}
		</div>

		{#if aiError}
			<div class="gl-ai gl-ai-error">
				<strong>AI 回答失败：</strong>{aiError}
			</div>
		{:else if aiAnswer !== null}
			<div class="gl-ai">
				<div class="gl-ai-head">🤖 AI 解答（只读）</div>
				<p class="gl-ai-body">{aiAnswer}</p>
			</div>
		{/if}

		<div class="gl-list">
			{#if termResults.length === 0 && docResults.length === 0}
				<div class="gl-empty">没有匹配的内容,换个关键词试试 🔍</div>
			{:else}
				{#each termResults as t (t.id)}
					<article class="gl-item">
						<h3 class="gl-term">{t.term}</h3>
						{#if t.alias && t.alias.length}
							<div class="gl-alias">
								{#each t.alias as a}
									<span class="gl-chip">{a}</span>
								{/each}
							</div>
						{/if}
						<p class="gl-def">{t.definition}</p>
					</article>
				{/each}

				{#if docResults.length > 0}
					<div class="gl-section-label">📄 文档</div>
					{#each docResults as d (d.path)}
						<article class="gl-doc">
							<h4 class="gl-doc-title">{d.title}</h4>
							<p class="gl-doc-snippet">{d.snippet}</p>
						</article>
					{/each}
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.glossary-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1300;
		background: rgba(2, 6, 23, 0.6);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--sp-md);
	}
	.glossary-modal {
		width: 100%;
		max-width: 680px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xl);
		box-shadow: var(--sh-modal);
		overflow: hidden;
	}
	.gl-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--sp-md);
		padding: var(--sp-lg) var(--sp-lg) var(--sp-md);
		border-bottom: 1px solid var(--border);
	}
	.gl-title {
		display: flex;
		gap: var(--sp-sm);
		align-items: flex-start;
	}
	.gl-emoji {
		font-size: 24px;
		line-height: 1.2;
	}
	.gl-title h2 {
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: var(--fw-sb);
		color: var(--text-primary);
	}
	.gl-sub {
		margin: 2px 0 0;
		font-size: var(--fs-xs);
		color: var(--text-secondary);
	}
	.gl-close {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border-radius: var(--r-sm);
		font-size: 15px;
		color: var(--text-secondary);
		background: transparent;
		cursor: pointer;
		transition: background var(--tr-fast), color var(--tr-fast);
	}
	.gl-close:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	.gl-search {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--sp-xs);
		margin: var(--sp-md) var(--sp-lg) 0;
	}
	.gl-search-icon {
		position: absolute;
		left: 12px;
		width: 18px;
		height: 18px;
		color: var(--text-muted);
		pointer-events: none;
	}
	.gl-search input {
		flex: 1;
		min-width: 0;
		height: 40px;
		padding: 0 90px 0 38px;
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text-primary);
		font-size: var(--fs-sm);
		outline: none;
		transition: border-color var(--tr-fast), box-shadow var(--tr-fast);
	}
	.gl-search input::placeholder {
		color: var(--text-muted);
	}
	.gl-search input:focus {
		border-color: var(--brand);
		box-shadow: 0 0 0 3px rgba(29, 99, 237, 0.15);
	}
	.gl-clear {
		position: absolute;
		right: 76px;
		width: 24px;
		height: 24px;
		border-radius: var(--r-sm);
		font-size: 12px;
		color: var(--text-muted);
		background: transparent;
		cursor: pointer;
	}
	.gl-clear:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	.gl-ask {
		position: absolute;
		right: 6px;
		height: 30px;
		padding: 0 var(--sp-md);
		border-radius: var(--r-sm);
		background: var(--brand);
		color: #fff;
		font-size: var(--fs-xs);
		font-weight: var(--fw-med);
		white-space: nowrap;
		transition: background var(--tr-fast);
	}
	.gl-ask:hover:not(:disabled) {
		background: var(--brand-hover);
	}
	.gl-ask:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.gl-count {
		padding: var(--sp-sm) var(--sp-lg) 0;
		font-size: var(--fs-xs);
		color: var(--text-muted);
	}
	/* AI 只读回答面板 */
	.gl-ai {
		margin: var(--sp-sm) var(--sp-lg) 0;
		padding: var(--sp-md);
		border: 1px solid var(--brand-bg, rgba(29, 99, 237, 0.25));
		border-radius: var(--r-md);
		background: rgba(29, 99, 237, 0.08);
	}
	.gl-ai-error {
		border-color: var(--danger);
		background: var(--danger-bg);
		color: var(--danger);
		font-size: var(--fs-sm);
	}
	.gl-ai-head {
		font-size: var(--fs-xs);
		font-weight: var(--fw-sb);
		color: var(--brand);
		margin-bottom: 6px;
	}
	.gl-ai-body {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.65;
		color: var(--text-secondary);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.gl-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--sp-sm) var(--sp-lg) var(--sp-lg);
		display: flex;
		flex-direction: column;
		gap: var(--sp-sm);
	}
	.gl-empty {
		text-align: center;
		color: var(--text-secondary);
		padding: var(--sp-2xl) 0;
		font-size: var(--fs-sm);
	}
	.gl-section-label {
		margin-top: var(--sp-xs);
		font-size: 11px;
		font-weight: var(--fw-sb);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: rgba(255, 255, 255, 0.4);
	}
	.gl-item {
		background: var(--bg-page);
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		padding: var(--sp-md);
		transition: border-color var(--tr-fast);
	}
	.gl-item:hover {
		border-color: var(--border-strong);
	}
	.gl-term {
		margin: 0 0 6px;
		font-size: var(--fs-base);
		font-weight: var(--fw-sb);
		color: var(--text-primary);
	}
	.gl-alias {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.gl-chip {
		font-size: 11px;
		padding: 1px 8px;
		border-radius: var(--r-full);
		background: var(--bg-active);
		color: var(--brand-light);
		border: 1px solid transparent;
	}
	.gl-def {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.65;
		color: var(--text-secondary);
	}
	.gl-doc {
		background: var(--bg-page);
		border: 1px solid var(--border);
		border-left: 3px solid var(--brand);
		border-radius: var(--r-md);
		padding: var(--sp-sm) var(--sp-md);
	}
	.gl-doc-title {
		margin: 0 0 4px;
		font-size: var(--fs-sm);
		font-weight: var(--fw-sb);
		color: var(--text-primary);
	}
	.gl-doc-snippet {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.6;
		color: var(--text-secondary);
	}
</style>
