<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — 右侧 LLM 交互侧栏（VS Code 风格：上对话区 + 底部输入框） -->
<!--
  职责:
    - 与云 LLM 多轮连续对话(经审计桥 callChatApiAudited,prompt/回复入审计链)
    - 未配置 LLM 时显示提示，引导到「设置 → LLM 配置」
    - 只读交互，不生成草案/不改规则（与三定向任务边界一致）

  安全:
    - apiKey 只经 llm-fetch.ts 注入 Authorization header，不进日志/URL/提示
    - 错误消息由 llm-fetch.ts 脱敏后再展示
-->

<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { llmConfig, isLlmConfigured } from '$lib/config/llm-config';
	import { callChatApiAudited } from '$lib/assistant/audited-llm';
	import { EVORULE_RULE_SPEC } from '$lib/assistant/prompts';
	import ChatBubble from '$lib/components/chat/ChatBubble.svelte';
	import TypewriterText from '$lib/components/chat/TypewriterText.svelte';

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
	}

	const SYSTEM_PROMPT = `你是 evorule 规则工程工作台的智能助手，帮助用户编写、解释、测试 evorule JSON 规则集。

${EVORULE_RULE_SPEC}

请用中文回答，言简意赅。回答规则相关问题时优先依据上述规范。`;

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);
	let listEl: HTMLElement | undefined;

	// 新消息或 loading 结束时滚动到底部
	$effect(() => {
		void messages;
		if (listEl) {
			requestAnimationFrame(() => {
				if (listEl) listEl.scrollTop = listEl.scrollHeight;
			});
		}
	});

	function configured(): boolean {
		return isLlmConfigured($llmConfig);
	}

	async function send(): Promise<void> {
		const text = input.trim();
		if (!text || loading) return;

		if (!configured()) {
			errorMsg = 'LLM 未配置，请在「设置 → LLM 配置」中填写 apiEndpoint + apiKey + model';
			return;
		}

		// 先取历史（不含新消息），再追加新消息
		const history = messages.map((m) => ({ role: m.role, content: m.content }));
		messages = [...messages, { role: 'user', content: text }];
		input = '';
		loading = true;
		errorMsg = null;

		try {
			const cfg = $llmConfig;
			// 经审计桥执行:对话 prompt 全文与回复入 evorule 审计链(侧车协议)
			const reply = await callChatApiAudited({
				apiEndpoint: cfg.apiEndpoint,
				apiKey: cfg.apiKey,
				model: cfg.model,
				userMessage: text,
				systemMessage: SYSTEM_PROMPT,
				history,
				temperature: 0.4,
				auditPurpose: 'chat'
			});
			messages = [...messages, { role: 'assistant', content: reply }];
		} catch (e) {
			errorMsg = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function clear(): void {
		messages = [];
		errorMsg = null;
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}

	// === 接力 CTA(整合方案批1,2026-09-20 裁定):「转执行」把当前话题转交编程 Agent ===
	// 互斥后两面间唯一切换路径(?session= 深链范式;侧栏无 server 会话,携带
	// 最后一条用户消息文本作上下文)。会话台经 ?handoff= 一次性消费预填输入行。
	const hasHandoffCtx = $derived(
		messages.some((m) => m.role === 'user') || input.trim().length > 0
	);

	function handoffToAgent(): void {
		const lastUser = [...messages].reverse().find((m) => m.role === 'user');
		const ctx = lastUser?.content.trim() || input.trim();
		if (!ctx) return;
		void goto(`${base}/agent?handoff=${encodeURIComponent(ctx)}`);
	}
</script>

<aside class="llm-sidebar">
	<header class="llm-header">
		<span class="llm-title" title="规则助理(草稿笔) — 规则问答与草稿辅助,不执行编排">规则助理</span>
		<div class="llm-actions">
			<button
				class="llm-handoff"
				onclick={handoffToAgent}
				disabled={!hasHandoffCtx}
				title="把当前话题转交编程 Agent(会话台)执行"
			>
				转执行
			</button>
			<button class="llm-clear" onclick={clear} title="清空对话">清空</button>
		</div>
	</header>

	<div class="llm-messages" bind:this={listEl}>
		{#if !configured()}
			<div class="llm-empty">
				<p class="empty-title">LLM 尚未配置</p>
				<p class="empty-hint">请在「设置 → LLM 配置」中填写接口信息后使用。</p>
			</div>
		{:else if messages.length === 0}
			<div class="llm-empty">
				<p class="empty-title">有什么可以帮你？</p>
				<p class="empty-hint">你可以询问 evorule 规则编写、解释、测试等问题。</p>
			</div>
		{:else}
			{#each messages as m, i (i)}
				<!-- 非流式传输:最新一条 assistant 回复到达后渐进呈现(视觉打字机),历史消息直接全文;
				     单行结构:pre-wrap 气泡内不容模板空白文本节点 -->
				<ChatBubble side={m.role === 'user' ? 'user' : 'assistant'}><TypewriterText text={m.content} animate={m.role === 'assistant' && !loading && i === messages.length - 1} /></ChatBubble>
			{/each}
			{#if loading}
				<ChatBubble side="assistant"><span class="chat-typing-hint">思考中…</span></ChatBubble>
			{/if}
		{/if}

		{#if errorMsg}
			<div class="llm-error">{errorMsg}</div>
		{/if}
	</div>

	<footer class="llm-input">
		<input
			type="text"
			placeholder="输入消息，Enter 发送"
			bind:value={input}
			onkeydown={onKeydown}
			disabled={!configured()}
			aria-label="LLM 对话输入"
		/>
		<button
			class="llm-send"
			onclick={() => void send()}
			disabled={loading || !input.trim() || !configured()}
		>
			发送
		</button>
	</footer>
</aside>

<style>
	.llm-sidebar {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--sidebar-bg);
		color: var(--sidebar-text);
	}

	.llm-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--sp-sm) var(--sp-md);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		flex-shrink: 0;
	}
	.llm-title {
		font-size: var(--fs-xs);
		font-weight: var(--fw-sb);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: rgba(255, 255, 255, 0.7);
	}
	.llm-clear {
		font-size: var(--fs-xs);
		color: rgba(255, 255, 255, 0.5);
		padding: 2px var(--sp-sm);
		border-radius: var(--r-sm);
		transition: background var(--tr-fast), color var(--tr-fast);
	}
	.llm-clear:hover {
		background: var(--sidebar-hover);
		color: #fff;
	}

	/* 接力 CTA(批1):互斥后两面间唯一切换路径,brand 色显性提示 */
	.llm-actions {
		display: flex;
		align-items: center;
		gap: var(--sp-xs);
	}
	.llm-handoff {
		font-size: var(--fs-xs);
		color: var(--brand);
		padding: 2px var(--sp-sm);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-sm);
		transition: background var(--tr-fast), color var(--tr-fast), opacity var(--tr-fast);
	}
	.llm-handoff:hover:not(:disabled) {
		background: var(--bg-active);
	}
	.llm-handoff:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.llm-messages {
		flex: 1;
		overflow-y: auto;
		padding: var(--sp-md);
		display: flex;
		flex-direction: column;
		gap: var(--sp-sm);
		min-height: 0;
	}

	.llm-empty {
		margin: auto;
		text-align: center;
		padding: var(--sp-lg) var(--sp-sm);
	}
	.empty-title {
		color: rgba(255, 255, 255, 0.8);
		font-size: var(--fs-sm);
		font-weight: var(--fw-med);
	}
	.empty-hint {
		color: rgba(255, 255, 255, 0.4);
		font-size: var(--fs-xs);
		margin-top: var(--sp-xs);
		line-height: 1.5;
	}

	/* 共享气泡视觉注入(ChatBubble/TypewriterText):沿用侧栏暗色配色 */
	.llm-messages {
		--bubble-max-width: 85%;
		--bubble-pad: var(--sp-sm) var(--sp-md);
		--bubble-radius: var(--r-md);
		--bubble-fs: var(--fs-sm);
		--bubble-lh: 1.5;
		--bubble-bg-user: var(--brand);
		--bubble-fg-user: #fff;
		--bubble-bg-assistant: rgba(255, 255, 255, 0.08);
		--bubble-fg-assistant: rgba(255, 255, 255, 0.9);
		--bubble-tail: var(--r-sm);
	}
	.chat-typing-hint {
		opacity: 0.6;
		font-style: italic;
	}

	.llm-error {
		padding: var(--sp-sm);
		border-radius: var(--r-sm);
		background: var(--danger-bg);
		color: var(--danger);
		font-size: var(--fs-xs);
		line-height: 1.4;
		word-break: break-word;
	}

	.llm-input {
		display: flex;
		gap: var(--sp-xs);
		padding: var(--sp-sm);
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		flex-shrink: 0;
	}
	.llm-input input {
		flex: 1;
		height: 34px;
		padding: 0 var(--sp-sm);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: var(--r-sm);
		background: rgba(255, 255, 255, 0.06);
		color: #fff;
		font-size: var(--fs-sm);
		outline: none;
		min-width: 0;
		transition: border-color var(--tr-fast), background var(--tr-fast);
	}
	.llm-input input::placeholder {
		color: rgba(255, 255, 255, 0.35);
	}
	.llm-input input:focus {
		border-color: var(--brand);
		background: rgba(255, 255, 255, 0.1);
	}
	.llm-input input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.llm-send {
		height: 34px;
		padding: 0 var(--sp-md);
		border-radius: var(--r-sm);
		background: var(--brand);
		color: #fff;
		font-size: var(--fs-sm);
		font-weight: var(--fw-med);
		flex-shrink: 0;
		transition: background var(--tr-fast);
	}
	.llm-send:hover:not(:disabled) {
		background: var(--brand-hover);
	}
	.llm-send:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>