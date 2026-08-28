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
	import { browser } from '$app/environment';
	import { netConfig, setNetMode, setRemoteBaseUrl, setAuthToken } from '$lib/config/net-config';
	import { DEFAULT_LOCAL_BASE_URL } from '$lib/backend/types';
	import LlmSettings from './LlmSettings.svelte';
	import { CloudHttpBackend } from '$lib/backend/cloud-http-backend';
	import { toastInfo } from '$lib/stores/toast';
	import {
		resetBanner,
		resetTour,
		startTour,
		resetChecklist,
		resetViewHints,
		resetAllOnboarding,
	} from '$lib/stores/onboarding';

	// 关闭回调(由 +layout.svelte 传入,点击"返回"按钮时调用)
	// initialTab: 外部(命令面板 / 右栏折叠条)指定打开时默认选中的标签页
	let {
		onclose,
		initialTab = 'network'
	}: { onclose?: () => void; initialTab?: 'network' | 'llm' | 'onboarding' } = $props();

	type Tab = 'network' | 'llm' | 'onboarding';
	let activeTab = $state<Tab>('network');
	// initialTab 由外部(命令面板 / 右栏折叠条)在面板打开时指定默认 tab;
	// 放在 effect 闭包里同步,避免在 $state 初始化器里直接引用 prop 的告警,
	// 且仅在 initialTab 变化时重设,用户在面板内的切换不受影响。
	$effect(() => {
		activeTab = initialTab;
	});

	let remoteUrlInput = $state('');
	let authTokenInput = $state('');
	let isTestingNet = $state(false);
	let netTestResult = $state<{ ok: boolean; message: string } | null>(null);

	// 同步 store 到本地输入
	$effect(() => {
		remoteUrlInput = $netConfig.remoteBaseUrl;
	});

	$effect(() => {
		authTokenInput = $netConfig.authToken;
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

	function handleAuthTokenInput(event: Event) {
		authTokenInput = (event.target as HTMLInputElement).value;
	}

	function handleAuthTokenBlur() {
		setAuthToken(authTokenInput);
	}

	async function handleTestNetConnection() {
		const cfg = $netConfig;
		const url = cfg.mode === 'online' ? cfg.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
		isTestingNet = true;
		netTestResult = null;
		try {
			// 用临时 CloudHttpBackend 测试连接(不修改主 backend;带当前输入 token 以验证凭据)
			const testBackend = new CloudHttpBackend({
				mode: 'online',
				remoteBaseUrl: url,
				localBaseUrl: url,
				authToken: authTokenInput.trim() || undefined
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

	// === PR4:新手引导重显控制 ===
	// 清掉 GuidedHint 遗留的本地键(evrule-console-cloud:guided-hint:*),
	// 使其对应的视图首访提示立即重新出现(PR7 会把这些提示统一收归 onboardingStore)。
	function sweepLegacyViewHints(): void {
		if (!browser) return;
		try {
			const prefix = 'evorule-console-cloud:guided-hint:';
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const k = localStorage.key(i);
				if (k && k.startsWith(prefix)) localStorage.removeItem(k);
			}
		} catch {
			// 隐私模式等异常:静默
		}
	}

	// 重新显示引导横幅(下次进入工作台即出现)
	function handleReshowBanner() {
		resetBanner();
		toastInfo('引导横幅已重置,进入「工作台」即可看到', '新手引导');
	}

	// 重新播放 5 步交互式 Tour(全局 overlay 已挂载,从设置里也能直接看到)
	function handleReplayTour() {
		resetTour();
		startTour();
	}

	// 重置上手清单(6 步全部回到未完成)
	function handleResetChecklist() {
		resetChecklist();
		toastInfo('上手清单已重置', '新手引导');
	}

	// 重置所有视图首访提示(含遗留 GuidedHint 键)
	function handleResetViewHints() {
		resetViewHints();
		sweepLegacyViewHints();
		toastInfo('视图首访提示已重置,下次进入各视图会再次出现', '新手引导');
	}

	// 重置全部引导态(危险操作,二次确认)
	function handleResetAllOnboarding() {
		if (!browser || !window.confirm('确定要重置全部新手引导状态吗?这会清除横幅、Tour、清单与视图提示的记录。')) {
			return;
		}
		resetAllOnboarding();
		sweepLegacyViewHints();
		toastInfo('已全部重置新手引导状态', '新手引导');
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
		<button
			class="settings-tab"
			class:active={activeTab === 'onboarding'}
			onclick={() => (activeTab = 'onboarding')}
			role="tab"
			aria-selected={activeTab === 'onboarding'}
		>
			🚀 新手引导
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

				<!-- 认证 token(两模式通用:server 开启 EVORULE_AUTH_TOKEN 时必填) -->
				<div class="form-row">
					<label for="auth-token">认证 Token(evorule-server EVORULE_AUTH_TOKEN)</label>
					<input
						id="auth-token"
						type="password"
						value={authTokenInput}
						oninput={handleAuthTokenInput}
						onblur={handleAuthTokenBlur}
						placeholder="server 未开启认证可留空"
						autocomplete="off"
					/>
					<small class="hint">
						server 开启认证时必填,失焦自动保存;留空则请求不带凭据(仅免认证 server 可用)。
						凭据保存在本机浏览器 localStorage,请勿在共享设备上填写。
					</small>
				</div>

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
		{:else if activeTab === 'onboarding'}
			<section class="onboarding-settings">
				<header class="section-header">
					<h2>🚀 新手引导</h2>
					<p class="section-desc">
						关掉了引导又想再看?这里可以重新显示各类新手引导,无需重装或清缓存。
					</p>
				</header>

				<div class="ob-reshow-list">
					<div class="ob-reshow-row">
						<div class="ob-reshow-info">
							<h4>引导横幅</h4>
							<p>工作台顶部的欢迎横幅,含上手三步与快捷任务流入口。</p>
						</div>
						<button class="btn btn-secondary" onclick={handleReshowBanner}>重新显示</button>
					</div>

					<div class="ob-reshow-row">
						<div class="ob-reshow-info">
							<h4>5 步交互式 Tour</h4>
							<p>带聚光灯的高亮引导,带你跑通「连接 → 建库 → 规则 → 执行 → 审计」。</p>
						</div>
						<button class="btn btn-secondary" onclick={handleReplayTour}>立即重播</button>
					</div>

					<div class="ob-reshow-row">
						<div class="ob-reshow-info">
							<h4>上手清单</h4>
							<p>首页「开始使用」里的 6 步勾选清单,可一键复位重勾。</p>
						</div>
						<button class="btn btn-secondary" onclick={handleResetChecklist}>重置清单</button>
					</div>

					<div class="ob-reshow-row">
						<div class="ob-reshow-info">
							<h4>视图首访提示</h4>
							<p>各视图首次进入时的小提示(如规则、审计等),关闭后会记住不再弹。</p>
						</div>
						<button class="btn btn-secondary" onclick={handleResetViewHints}>重置提示</button>
					</div>
				</div>

				<div class="ob-danger">
					<div class="ob-reshow-info">
						<h4>重置全部引导</h4>
						<p>一次性清除横幅、Tour、清单与视图提示的全部记录(不可撤销)。</p>
					</div>
					<button class="btn btn-danger" onclick={handleResetAllOnboarding}>重置全部</button>
				</div>
			</section>
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
		color: var(--text-primary);
	}
	.subtitle {
		margin: var(--spacing-xs) 0 0;
		color: var(--text-secondary);
		font-size: var(--text-sm);
	}
	.btn-close {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--border);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.btn-close:hover {
		background: var(--border);
	}
	.settings-tabs {
		display: flex;
		gap: var(--spacing-xs);
		border-bottom: 1px solid var(--border);
		margin-bottom: var(--spacing-lg);
	}
	.settings-tab {
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
		transition: all var(--transition-fast);
	}
	.settings-tab:hover {
		color: var(--text-primary);
	}
	.settings-tab.active {
		color: var(--brand);
		border-bottom-color: var(--brand);
	}
	.settings-content {
		background: var(--bg-page);
		padding: var(--spacing-lg);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
	}
	.section-header h2 {
		margin: 0 0 var(--spacing-xs);
		font-size: var(--text-xl);
		color: var(--text-primary);
	}
	.section-desc {
		margin: 0 0 var(--spacing-md);
		font-size: var(--text-sm);
		color: var(--text-secondary);
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
		background: var(--bg-hover);
		border: 2px solid transparent;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-primary);
		transition: all var(--transition-fast);
	}
	.mode-btn:hover {
		background: var(--border);
	}
	.mode-btn.active {
		background: var(--brand);
		color: #fff;
		border-color: var(--brand-hover);
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
		color: var(--text-primary);
	}
	.form-row input {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		box-sizing: border-box;
	}
	.form-row input:focus {
		outline: none;
		border-color: var(--brand);
		box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-secondary);
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
		background: var(--border);
		color: var(--text-primary);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--border);
	}
	.alert {
		padding: var(--spacing-sm) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		margin: var(--spacing-sm) 0;
	}
	.alert-success {
		background: var(--success);
		color: #fff;
	}
	.alert-error {
		background: var(--danger);
		color: #fff;
	}
	.current-status {
		margin-top: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--bg-hover);
		border-radius: var(--radius-md);
	}
	.current-status h3 {
		margin: 0 0 var(--spacing-sm);
		font-size: var(--text-base);
		color: var(--text-primary);
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
		color: var(--text-secondary);
	}
	.current-status dd {
		margin: 0;
		color: var(--text-primary);
	}
	.current-status code {
		font-family: var(--font-mono);
		background: var(--border);
		padding: 0 var(--spacing-xs);
		border-radius: var(--radius-sm);
	}

	/* === 新手引导重显区(PR4) === */
	.ob-reshow-list {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}
	.ob-reshow-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		padding: var(--spacing-md);
		background: var(--bg-page);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.ob-danger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-md);
		margin-top: var(--spacing-md);
		padding: var(--spacing-md);
		background: var(--danger-bg);
		border: 1px solid var(--danger);
		border-radius: var(--radius-md);
	}
	.ob-reshow-info {
		min-width: 0;
	}
	.ob-reshow-info h4 {
		margin: 0 0 4px;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-primary);
	}
	.ob-reshow-info p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.ob-danger .ob-reshow-info h4 {
		color: var(--danger);
	}
</style>
