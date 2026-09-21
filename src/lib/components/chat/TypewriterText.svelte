<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  TypewriterText — 两面共享消息文本渲染
  - animate=false(缺省):直接全文呈现。AgentWorkspace 真实流式路径,
    文本随服务端事件增长,不做二次动画
  - animate=true:完成后渐进呈现(视觉打字机)。LlmChatSidebar 非流式传输,
    整段回复到达后做呈现动画——只改视觉形态,不改传输方式
  prefers-reduced-motion 时动画降级为直接全文。
-->
<script lang="ts">
	import { browser } from '$app/environment';

	interface Props {
		text: string;
		/** 完成后渐进呈现(视觉打字机) */
		animate?: boolean;
		/** 呈现总帧数(字符按帧均分) */
		frames?: number;
		/** 帧间隔 ms */
		intervalMs?: number;
	}

	let { text, animate = false, frames = 60, intervalMs = 24 }: Props = $props();

	let shown = $state(0);

	function prefersReducedMotion(): boolean {
		return browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	$effect(() => {
		if (!animate || prefersReducedMotion()) {
			shown = text.length;
			return;
		}
		shown = 0;
		const total = Math.max(1, text.length);
		const step = Math.max(1, Math.ceil(total / Math.max(1, frames)));
		const timer = window.setInterval(() => {
			shown = Math.min(total, shown + step);
			if (shown >= total) window.clearInterval(timer);
		}, intervalMs);
		return () => window.clearInterval(timer);
	});
</script>

<!-- 单行根节点:pre-wrap 气泡内不容模板空白文本节点(会渲染成可见首尾空格) -->
<span>{text.slice(0, shown)}</span>
