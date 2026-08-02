<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud 根布局 — 顶部导航 + backend 注入 + assistant 注入(null) + 主题 -->
<!--
  Phase 1 最小验证:
    - 注入 HttpBackend(内核默认,Phase 2 换 CloudHttpBackend)
    - 注入 assistant = null(扩展槽为空,LLM 按钮不渲染;Phase 3-4 换 CloudLlmAssistant)
    - 渲染 5 视图 tab(复用内核 VIEW_LIST)
    - 主题切换 + 视图状态持久化(localStorage)
    - 连接徽标反映 evorule-server 是否在线
-->

<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import {
		currentView,
		setView,
		restoreView,
		VIEW_LIST,
		provideBackend,
		provideAssistant,
		CONSOLE_VERSION,
		type ExecutionBackend
	} from '@evorule/console';

	let { children } = $props();

	// 注入 backend — Phase 1 先用内核默认 HttpBackend(127.0.0.1:18080)
	// Phase 2 换 CloudHttpBackend(baseUrl 可配,支持远程 server)
	const backend = provideBackend() as ExecutionBackend;

	// 注入 assistant = null — 扩展槽为空,LLM 按钮不渲染(与 evorule-console 内核行为一致)
	// Phase 3-4 注入 CloudLlmAssistant 后,LLM 按钮才渲染
	provideAssistant(null);

	// 连接状态:null=检测中, true=已连接, false=未连接
	let connected = $state<boolean | null>(null);

	// 主题(light/dark)
	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		// === 主题恢复 ===
		const savedTheme = localStorage.getItem('theme');
		if (savedTheme === 'dark' || savedTheme === 'light') {
			theme = savedTheme;
		} else {
			theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.setAttribute('data-theme', theme);

		// === 视图恢复 ===
		restoreView();

		// === backend 健康检查 ===
		backend
			.health()
			.then((ok) => {
				connected = ok;
			})
			.catch(() => {
				connected = false;
			});
	});

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem('theme', theme);
	}
</script>

<div class="app">
	<header class="topbar">
		<div class="brand">
			<span class="brand-name">evorule-console-cloud</span>
			<span class="brand-tag">大众版 · 内核 v{CONSOLE_VERSION} · 联网 + 云 LLM</span>
		</div>

		<nav class="nav-tabs" aria-label="视图切换">
			{#each VIEW_LIST as view (view.id)}
				<button
					class="nav-tab"
					class:active={$currentView === view.id}
					onclick={() => setView(view.id)}
					title={view.essence}
					aria-pressed={$currentView === view.id}
				>
					<span class="tab-icon">{view.icon}</span>
					<span class="tab-label">{view.label}</span>
				</button>
			{/each}
		</nav>

		<div class="topbar-actions">
			<span
				class="conn-badge"
				class:online={connected === true}
				class:offline={connected === false}
				class:checking={connected === null}
				title={connected === false
					? '需要 evorule-server 跑在 127.0.0.1:18080(Phase 2 后可配远程)'
					: 'evorule-server 连接状态'}
			>
				<span class="conn-dot"></span>
				<span class="conn-text">
					{connected === null ? '检测中' : connected ? '已连接' : '未连接'}
				</span>
			</span>

			<button
				class="theme-toggle"
				onclick={toggleTheme}
				title="切换主题"
				aria-label="切换主题"
			>
				{theme === 'light' ? '🌙' : '☀️'}
			</button>
		</div>
	</header>

	<main class="main-content">
		{@render children()}
	</main>
</div>

<style>
	.app {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--color-gray-50);
	}

	/* === 顶部导航栏 === */
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--spacing-lg);
		padding: 0 var(--spacing-xl);
		background: var(--color-gray-900);
		color: #fff;
		box-shadow: var(--shadow-md);
		position: sticky;
		top: 0;
		z-index: 10;
		flex-wrap: wrap;
	}

	.brand {
		display: flex;
		flex-direction: column;
		padding: var(--spacing-sm) 0;
		flex-shrink: 0;
	}
	.brand-name {
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.brand-tag {
		font-size: var(--text-xs);
		color: var(--color-gray-400);
		margin-top: 2px;
	}

	/* === 导航 tabs === */
	.nav-tabs {
		display: flex;
		gap: var(--spacing-xs);
		flex: 1;
		justify-content: center;
	}
	.nav-tab {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		color: var(--color-gray-300);
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		cursor: pointer;
		font-size: var(--text-sm);
		transition:
			color var(--transition-fast),
			border-color var(--transition-fast);
	}
	.nav-tab:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.06);
	}
	.nav-tab.active {
		color: #fff;
		border-bottom-color: var(--color-primary);
		background: rgba(255, 255, 255, 0.04);
	}
	.tab-icon {
		font-size: var(--text-base);
	}
	.tab-label {
		font-weight: 500;
	}

	/* === 右侧操作区 === */
	.topbar-actions {
		display: flex;
		align-items: center;
		gap: var(--spacing-md);
		flex-shrink: 0;
	}
	.conn-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		font-size: var(--text-xs);
		color: var(--color-gray-400);
	}
	.conn-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full);
		background: var(--color-gray-500);
	}
	.conn-badge.online .conn-dot {
		background: var(--color-success);
	}
	.conn-badge.online .conn-text {
		color: var(--color-success);
	}
	.conn-badge.offline .conn-dot {
		background: var(--color-error);
	}
	.conn-badge.offline .conn-text {
		color: var(--color-error);
	}
	.conn-badge.checking .conn-dot {
		background: var(--color-warning);
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.theme-toggle {
		background: transparent;
		color: var(--color-gray-300);
		border: 1px solid var(--color-gray-700);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		font-size: var(--text-base);
		line-height: 1;
	}
	.theme-toggle:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	/* === 主内容区 === */
	.main-content {
		flex: 1;
		width: 100%;
		overflow: auto;
	}

	@media (max-width: 768px) {
		.topbar {
			padding: 0 var(--spacing-md);
		}
		.brand-tag {
			display: none;
		}
		.nav-tabs {
			gap: 0;
			justify-content: flex-start;
			overflow-x: auto;
		}
		.nav-tab {
			padding: var(--spacing-sm);
		}
		.tab-label {
			display: none;
		}
		.nav-tab.active .tab-label {
			display: inline;
		}
	}
</style>
