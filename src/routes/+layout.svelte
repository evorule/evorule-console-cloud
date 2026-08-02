<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud 根布局 — 顶部导航 + backend 注入 + assistant 注入(null) + 主题 + 联网切换 -->
<!--
  Phase 2: 用 CloudHttpBackend 替代内核 HttpBackend
    - 支持联网/离线双模式(netConfig store)
    - reconfigure 时实例不变,视图自动用新 baseUrl
  Phase 3-4: assistant 从 null 换成 CloudLlmAssistant
  Phase 6: topbar 加正式"设置"入口(替换临时联网按钮)
-->

<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import {
		currentView,
		setView,
		restoreView,
		VIEW_LIST,
		provideBackend,
		provideAssistant,
		CONSOLE_VERSION
	} from '@evorule/console';
	import type { ViewId } from '@evorule/console';
	import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
	import { netConfig, toggleNetMode } from '$lib/config/net-config';
	import { llmConfig, isLlmConfigured } from '$lib/config/llm-config';
	import { CloudLlmAssistant } from '$lib/assistant/cloud-llm-assistant';
	import Settings from '$lib/views/Settings/Settings.svelte';

	let { children } = $props();

	// === 设置入口(Phase 6: 不修改内核 VIEW_LIST,大众版独立管理) ===
	let showSettings = $state(false);

	function openSettings() {
		showSettings = true;
	}

	function closeSettings() {
		showSettings = false;
	}

	// 用户点击 nav-tab 时,关闭设置(回到视图模式)
	function handleNavClick(viewId: ViewId) {
		showSettings = false;
		setView(viewId);
	}

	// === 注入 backend(Phase 2: CloudHttpBackend 双模式) ===
	// 取 netConfig 初始值,创建 CloudHttpBackend
	const initialNet = get(netConfig);
	const cloudBackend = new CloudHttpBackend({
		mode: initialNet.mode,
		remoteBaseUrl: initialNet.remoteBaseUrl
	});
	// provideBackend 注入(返回 ExecutionBackend 接口类型,视图用)
	// cloudBackend 变量保留用于 reconfigure(reconfigure 是 CloudHttpBackend 特有方法)
	const backend = provideBackend(cloudBackend);

	// 监听 netConfig 变化,reconfigure backend(实例不变,视图自动用新 baseUrl)
	$effect(() => {
		const cfg = $netConfig;
		cloudBackend.reconfigure({ mode: cfg.mode, remoteBaseUrl: cfg.remoteBaseUrl });
	});

	// === 注入 LLM assistant(Phase 3+4: 条件注入 CloudLlmAssistant) ===
	// 配置完备(enabled + endpoint + key + model)→ 注入,内核 LLM 按钮渲染
	// 配置不完备 → 注入 null,行为与内核一致(LLM 按钮不渲染)
	//
	// 重要:Svelte 的 setContext 必须在组件初始化期间同步调用,
	//       不能放在 $effect 内($effect 在初始化之后运行,setContext 无效)。
	//       因此这里同步读取 llmConfig 当前值并注入。
	//
	// 配置变更处理:
	//   - 大众版设置面板修改 llmConfig 后,提示用户刷新页面以重新注入
	//   - 或用户切换 tab 触发组件重新挂载(视图层)
	//   - 这种"刷新生效"模式与基础版的"重启服务器生效"心智一致
	const initialLlm = get(llmConfig);
	if (isLlmConfigured(initialLlm)) {
		const assistant = new CloudLlmAssistant(initialLlm);
		provideAssistant(assistant);
	} else {
		provideAssistant(null);
	}

	// llmConfig 后续变化(运行时切换)无法重注入 context,
	// 但 CloudLlmAssistant 内部已防御性拷贝配置,所以这种"刷新生效"模式是预期的。
	// 设置面板在保存配置后会调用 location.reload() 强制重注入。

	// === 连接状态 ===
	let connected = $state<boolean | null>(null);

	// === 主题 ===
	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		// 主题恢复
		const savedTheme = localStorage.getItem('theme');
		if (savedTheme === 'dark' || savedTheme === 'light') {
			theme = savedTheme;
		} else {
			theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		document.documentElement.setAttribute('data-theme', theme);

		// 视图恢复
		restoreView();

		// backend 健康检查(反映当前 baseUrl 是否在线)
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
					class:active={$currentView === view.id && !showSettings}
					onclick={() => handleNavClick(view.id)}
					title={view.essence}
					aria-pressed={$currentView === view.id && !showSettings}
				>
					<span class="tab-icon">{view.icon}</span>
					<span class="tab-label">{view.label}</span>
				</button>
			{/each}
			<!-- 设置入口(Phase 6: 大众版独有,不修改内核 VIEW_LIST) -->
			<button
				class="nav-tab settings-tab"
				class:active={showSettings}
				onclick={openSettings}
				title="设置(联网模式 + LLM 配置)"
				aria-pressed={showSettings}
			>
				<span class="tab-icon">⚙️</span>
				<span class="tab-label">设置</span>
			</button>
		</nav>

		<div class="topbar-actions">
			<!-- 联网状态徽标(快捷切换,正式配置在 Settings 面板) -->
			<button
				class="net-toggle"
				class:online={$netConfig.mode === 'online'}
				class:offline={$netConfig.mode === 'offline'}
				onclick={toggleNetMode}
				title={$netConfig.mode === 'online'
					? `联网模式 · {$netConfig.remoteBaseUrl} · 点击切回本地`
					: '离线模式 · 127.0.0.1:18080 · 点击切到联网(详细配置在设置面板)'}
				aria-label="切换联网/离线模式"
			>
				<span class="net-icon">{$netConfig.mode === 'online' ? '☁️' : '🖥️'}</span>
				<span class="net-text">{$netConfig.mode === 'online' ? '联网' : '本地'}</span>
			</button>

			<span
				class="conn-badge"
				class:online={connected === true}
				class:offline={connected === false}
				class:checking={connected === null}
				title={connected === false
					? 'evorule-server 未响应(检查地址或启动服务器)'
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
			{#if showSettings}
				<Settings onclose={closeSettings} />
			{:else}
				{@render children()}
			{/if}
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

	/* 设置 tab 视觉区分(大众版独有,不属于内核 5 视图) */
	.nav-tab.settings-tab {
		border-left: 1px solid var(--color-gray-700);
		margin-left: var(--spacing-sm);
		padding-left: var(--spacing-md);
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

	/* 临时联网切换按钮 */
	.net-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--spacing-xs);
		background: transparent;
		color: var(--color-gray-300);
		border: 1px solid var(--color-gray-700);
		border-radius: var(--radius-md);
		padding: var(--spacing-xs) var(--spacing-sm);
		cursor: pointer;
		font-size: var(--text-xs);
		transition: all var(--transition-fast);
	}
	.net-toggle:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}
	.net-toggle.online {
		border-color: var(--color-info);
		color: var(--color-info);
	}
	.net-toggle.offline {
		border-color: var(--color-gray-600);
	}
	.net-icon {
		font-size: var(--text-sm);
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
		.net-toggle .net-text {
			display: none;
		}
	}
</style>
