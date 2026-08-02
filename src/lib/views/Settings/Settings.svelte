<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — 设置面板(联网 + LLM 两 tab) -->
<!--
  职责:
    - 两个 tab:联网配置 + LLM 配置
    - 联网 tab:online/offline 切换 + 远程 URL 输入 + 测试连接
    - LLM tab:启用开关 + 厂商预设 + apiKey 管理 + 测试连接
  注:Phase 6 替换 +layout.svelte 里的临时联网切换按钮
-->

<script lang="ts">
	import { netConfig, setNetMode, setRemoteBaseUrl } from '$lib/config/net-config';
	import { DEFAULT_LOCAL_BASE_URL } from '$lib/backend/types';
	import LlmSettings from './LlmSettings.svelte';
	import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';

	// 关闭回调(由 +layout.svelte 传入,点击"返回"按钮时调用)
	let { onclose }: { onclose?: () => void } = $props();

	type Tab = 'network' | 'llm';
	let activeTab = $state<Tab>('network');

	let remoteUrlInput = $state('');
	let isTestingNet = $state(false);
	let netTestResult = $state<{ ok: boolean; message: string } | null>(null);

	// 同步 store 到本地输入
	$effect(() => {
		remoteUrlInput = $netConfig.remoteBaseUrl;
	});

	function handleNetModeChange(mode: 'online' | 'offline') {
		setNetMode(mode);
		netTestResult = null;
	}

	function handleRemoteUrlInput(event: Event) {
		remoteUrlInput = (event.target as HTMLInputElement).value;
	}

	function handleRemoteUrlBlur() {
		setRemoteBaseUrl(remoteUrlInput);
	}

	async function handleTestNetConnection() {
		const cfg = $netConfig;
		const url = cfg.mode === 'online' ? cfg.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
		isTestingNet = true;
		netTestResult = null;
		try {
			// 用临时 CloudHttpBackend 测试连接(不修改主 backend)
			const testBackend = new CloudHttpBackend({
				mode: 'online',
				remoteBaseUrl: url,
				localBaseUrl: url
			});
			const ok = await testBackend.health();
			netTestResult = {
				ok,
				message: ok
					? `连接成功(${url})`
					: `连接失败(${url}) — 检查 evorule-server 是否启动`
			};
		} catch (e) {
			netTestResult = {
				ok: false,
				message: `连接失败: ${(e as Error).message}`
			};
		} finally {
			isTestingNet = false;
		}
	}
</script>

<div class="settings-page">
	<header class="settings-header">
		<div class="header-row">
			<div>
				<h1>⚙️ 设置</h1>
				<p class="subtitle">联网模式 + LLM 配置</p>
			</div>
			{#if onclose}
				<button class="btn-close" onclick={onclose} aria-label="返回视图" title="返回视图">
					← 返回
				</button>
			{/if}
		</div>
	</header>

	<!-- Tab 切换 -->
	<div class="settings-tabs" role="tablist">
		<button
			class="settings-tab"
			class:active={activeTab === 'network'}
			onclick={() => (activeTab = 'network')}
			role="tab"
			aria-selected={activeTab === 'network'}
		>
			🌐 联网配置
		</button>
		<button
			class="settings-tab"
			class:active={activeTab === 'llm'}
			onclick={() => (activeTab = 'llm')}
			role="tab"
			aria-selected={activeTab === 'llm'}
		>
			🤖 LLM 配置
		</button>
	</div>

	<main class="settings-content">
		{#if activeTab === 'network'}
			<section class="network-settings">
				<header class="section-header">
					<h2>🌐 联网模式</h2>
					<p class="section-desc">
						切换连本地 evorule-server(loopback)或远程 evorule-server。
						切换后 backend 立即用新 baseUrl(无需重启)。
					</p>
				</header>

				<!-- 模式选择 -->
				<div class="mode-toggle">
					<button
						class="mode-btn"
						class:active={$netConfig.mode === 'offline'}
						onclick={() => handleNetModeChange('offline')}
					>
						🖥️ 本地模式(127.0.0.1:18080)
					</button>
					<button
						class="mode-btn"
						class:active={$netConfig.mode === 'online'}
						onclick={() => handleNetModeChange('online')}
					>
						☁️ 联网模式
					</button>
				</div>

				<!-- 远程 URL 输入(仅 online 模式可见) -->
				{#if $netConfig.mode === 'online'}
					<div class="form-row">
						<label for="remote-url">远程 evorule-server URL</label>
						<input
							id="remote-url"
							type="text"
							value={remoteUrlInput}
							oninput={handleRemoteUrlInput}
							onblur={handleRemoteUrlBlur}
							placeholder="https://your-server.example.com"
						/>
						<small class="hint">修改后失焦自动保存,backend 会立即用新 URL</small>
					</div>
				{/if}

				<!-- 测试连接 -->
				<div class="form-actions">
					<button class="btn btn-secondary" onclick={handleTestNetConnection} disabled={isTestingNet}>
						{isTestingNet ? '⏳ 测试中...' : '🔌 测试连接'}
					</button>
				</div>

				{#if netTestResult}
					<div
						class="alert"
						class:alert-success={netTestResult.ok}
						class:alert-error={!netTestResult.ok}
					>
						{netTestResult.ok ? '✅' : '❌'} {netTestResult.message}
					</div>
				{/if}

				<!-- 当前状态 -->
				<div class="current-status">
					<h3>当前状态</h3>
					<dl>
						<dt>模式</dt>
						<dd>{$netConfig.mode === 'online' ? '☁️ 联网' : '🖥️ 本地'}</dd>
						<dt>baseUrl</dt>
						<dd><code>{$netConfig.mode === 'online' ? $netConfig.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL}</code></dd>
					</dl>
				</div>
			</section>
		{:else if activeTab === 'llm'}
			<LlmSettings />
		{/if}
	</main>
</div>

<style>
	.settings-page {
		max-width: 800px;
		margin: 0 auto;
		padding: var(--spacing-xl);
	}
	.settings-header {
		margin-bottom: var(--spacing-lg);
	}
	.header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--spacing-md);
	}
	.settings-header h1 {
		margin: 0;
		font-size: var(--text-2xl);
		color: var(--color-gray-900);
	}
	.subtitle {
		margin: var(--spacing-xs) 0 0;
		color: var(--color-gray-600);
		font-size: var(--text-sm);
	}
	.btn-close {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--color-gray-200);
		color: var(--color-gray-800);
		border: 1px solid var(--color-gray-300);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.btn-close:hover {
		background: var(--color-gray-300);
	}
	.settings-tabs {
		display: flex;
		gap: var(--spacing-xs);
		border-bottom: 1px solid var(--color-gray-200);
		margin-bottom: var(--spacing-lg);
	}
	.settings-tab {
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--color-gray-600);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
		transition: all var(--transition-fast);
	}
	.settings-tab:hover {
		color: var(--color-gray-900);
	}
	.settings-tab.active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}
	.settings-content {
		background: var(--color-gray-50);
		padding: var(--spacing-lg);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	.section-header h2 {
		margin: 0 0 var(--spacing-xs);
		font-size: var(--text-xl);
		color: var(--color-gray-900);
	}
	.section-desc {
		margin: 0 0 var(--spacing-md);
		font-size: var(--text-sm);
		color: var(--color-gray-600);
		line-height: 1.5;
	}
	.mode-toggle {
		display: flex;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-md);
	}
	.mode-btn {
		flex: 1;
		padding: var(--spacing-md);
		background: var(--color-gray-100);
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-gray-700);
		transition: all var(--transition-fast);
	}
	.mode-btn:hover {
		background: var(--color-gray-200);
	}
	.mode-btn.active {
		background: var(--color-primary);
		color: #fff;
		border-color: var(--color-primary-hover);
	}
	.form-row {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-md);
	}
	.form-row label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--color-gray-700);
	}
	.form-row input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-gray-300);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		box-sizing: border-box;
	}
	.form-row input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-gray-600);
	}
	.form-actions {
		display: flex;
		gap: var(--spacing-sm);
		margin: var(--spacing-md) 0;
	}
	.btn {
		padding: var(--spacing-sm) var(--spacing-md);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-secondary {
		background: var(--color-gray-200);
		color: var(--color-gray-800);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--color-gray-300);
	}
	.alert {
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		margin: var(--spacing-sm) 0;
	}
	.alert-success {
		background: var(--color-success);
		color: #fff;
	}
	.alert-error {
		background: var(--color-error);
		color: #fff;
	}
	.current-status {
		margin-top: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--color-gray-100);
		border-radius: var(--radius-md);
	}
	.current-status h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: var(--text-base);
		color: var(--color-gray-700);
	}
	.current-status dl {
		margin: 0;
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--spacing-xs) var(--spacing-md);
		font-size: var(--text-sm);
	}
	.current-status dt {
		font-weight: 500;
		color: var(--color-gray-600);
	}
	.current-status dd {
		margin: 0;
		color: var(--color-gray-900);
	}
	.current-status code {
		font-family: var(--font-mono);
		background: var(--color-gray-200);
		padding: 0 var(--spacing-xs);
		border-radius: var(--radius-sm);
	}
</style>
