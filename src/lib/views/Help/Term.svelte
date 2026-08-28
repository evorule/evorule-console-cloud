<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PR4 · 行内术语引用 Term。
  在正文里嵌入一个带 ? 的小按钮,点击展开术语解释(不跳转)。
  用法:<Term id="blake3" /> 或 <Term id="blake3" label="自定义文案" />
  依赖:src/lib/data/glossary.ts
-->

<script lang="ts">
	import { GLOSSARY } from "$lib/data/glossary";

	let { id, label }: { id: string; label?: string } = $props();

	const entry = $derived(GLOSSARY.find((t) => t.id === id));
	let open = $state(false);

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		open = !open;
	}
</script>

{#if entry}
	<span class="term-wrap">
		<button
			class="term-ref"
			class:open
			onclick={toggle}
			aria-expanded={open}
			aria-label={`术语解释:${entry.term}`}
		>
			{label ?? entry.term}<sup class="term-q">?</sup>
		</button>
		{#if open}
			<span class="term-pop" role="tooltip">
				<strong>{entry.term}</strong>
				{entry.definition}
			</span>
		{/if}
	</span>
{/if}

<style>
	.term-wrap {
		position: relative;
		display: inline;
	}
	.term-ref {
		color: var(--brand);
		background: transparent;
		border: none;
		border-bottom: 1px dotted var(--brand);
		cursor: help;
		font: inherit;
		padding: 0;
	}
	.term-ref:hover,
	.term-ref.open {
		color: var(--brand-hover);
	}
	.term-q {
		font-size: 0.7em;
		margin-left: 1px;
	}
	.term-pop {
		position: absolute;
		z-index: 50;
		top: calc(100% + 6px);
		left: 0;
		width: 280px;
		max-width: 80vw;
		display: block;
		padding: 10px 12px;
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-md);
		box-shadow: var(--sh-modal);
		font-size: 12px;
		line-height: 1.6;
		color: var(--text-secondary);
		text-align: left;
	}
	.term-pop strong {
		display: block;
		color: var(--text-primary);
		margin-bottom: 4px;
		font-size: 13px;
	}
</style>
