<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  ChatBubble — 两面共享聊天气泡(AgentWorkspace 会话流 / LlmChatSidebar 侧栏)
  渲染结构归一:对齐(user 右 / assistant 左)+ 气泡容器 + 流式光标;
  视觉差异经 CSS 变量注入(--bubble-*),行为差异不抹平:
  - AgentWorkspace:真实流式,文本随 LlmDelta 事件增长,streaming=true 尾随光标
  - LlmChatSidebar:非流式传输,渐进呈现由 TypewriterText 承担
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** user = 右对齐 / assistant = 左对齐 */
		side: 'user' | 'assistant';
		/** 流式进行中(assistant 尾随光标) */
		streaming?: boolean;
		children: Snippet;
	}

	let { side, streaming = false, children }: Props = $props();
</script>

<div class="chat-bubble" class:user={side === 'user'} class:assistant={side === 'assistant'}>
	<!-- 单行 body:pre-wrap 气泡内不容模板空白文本节点(会渲染成可见首尾空格) -->
	<div class="chat-bubble-body">{@render children()}{#if streaming && side === 'assistant'}<span class="chat-bubble-cursor" aria-hidden="true"></span>{/if}</div>
</div>

<style>
	.chat-bubble {
		display: flex;
		width: 100%;
		min-width: 0;
	}
	.chat-bubble.user {
		justify-content: flex-end;
	}
	.chat-bubble.assistant {
		justify-content: flex-start;
	}
	.chat-bubble-body {
		max-width: var(--bubble-max-width, 85%);
		padding: var(--bubble-pad, 8px 12px);
		border-radius: var(--bubble-radius, 10px);
		background: var(--bubble-bg, rgba(127, 127, 127, 0.12));
		color: var(--bubble-fg, inherit);
		font-size: var(--bubble-fs, inherit);
		line-height: var(--bubble-lh, 1.5);
		white-space: pre-wrap;
		word-break: break-word;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.chat-bubble.user .chat-bubble-body {
		background: var(--bubble-bg-user, var(--bubble-bg, rgba(127, 127, 127, 0.12)));
		color: var(--bubble-fg-user, var(--bubble-fg, inherit));
		border-bottom-right-radius: var(--bubble-tail, 4px);
	}
	.chat-bubble.assistant .chat-bubble-body {
		background: var(--bubble-bg-assistant, var(--bubble-bg, rgba(127, 127, 127, 0.12)));
		color: var(--bubble-fg-assistant, var(--bubble-fg, inherit));
		border-bottom-left-radius: var(--bubble-tail, 4px);
	}
	.chat-bubble-cursor {
		display: inline-block;
		width: 7px;
		height: 13px;
		margin-left: 2px;
		vertical-align: -2px;
		background: var(--bubble-cursor, currentColor);
	}
	@media (prefers-reduced-motion: no-preference) {
		.chat-bubble-cursor {
			animation: chat-bubble-blink 1s steps(2) infinite;
		}
	}
	@keyframes chat-bubble-blink {
		50% {
			opacity: 0;
		}
	}
</style>
