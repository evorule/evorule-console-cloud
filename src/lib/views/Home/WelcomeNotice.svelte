<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  WelcomeNotice(UV-179 批次A)— 首跑向导非阻塞提示条。
  登录后、向导未完成且未被显式关闭时显示;点击进 /welcome;
  「不再提示」只关提示条(可在帮助页重跑向导)。不劫持任何操作。
  依赖:src/lib/stores/onboarding.ts + session store
-->

<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onboardingStore, dismissWelcomeNotice } from '$lib/stores/onboarding';
	import { sessionStore } from '$lib/stores/session';

	const visible = $derived(
		!$onboardingStore.welcome.completed &&
			!$onboardingStore.welcome.dismissed &&
			$sessionStore.loggedIn &&
			$page.url.pathname !== '/welcome'
	);
</script>

{#if visible}
	<div class="wn-bar" role="status">
		<span class="wn-text">
			👋 首次使用?<strong>花 3 分钟完成初始设置</strong>(连接治理服务,可选 AI 助手)
		</span>
		<div class="wn-actions">
			<button class="wn-btn primary" onclick={() => goto('/welcome')}>打开向导</button>
			<button class="wn-btn ghost" onclick={dismissWelcomeNotice} aria-label="不再提示">
				不再提示
			</button>
		</div>
	</div>
{/if}

<style>
	.wn-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px;
		background: var(--bg-card);
		border-bottom: 1px solid var(--border);
		flex-wrap: wrap;
	}
	.wn-text {
		font-size: 13px;
		color: var(--text-secondary);
	}
	.wn-text strong {
		color: var(--text-primary);
	}
	.wn-actions {
		display: flex;
		gap: 8px;
	}
	.wn-btn {
		height: 28px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.wn-btn.primary {
		background: var(--brand);
		color: #fff;
	}
	.wn-btn.primary:hover {
		background: var(--brand-hover);
	}
	.wn-btn.ghost {
		background: transparent;
		color: var(--text-muted);
		border-color: var(--border);
	}
	.wn-btn.ghost:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
</style>
