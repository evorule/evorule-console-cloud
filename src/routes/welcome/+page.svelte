<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  /welcome 首跑向导(UV-179 批次A)— 非技术用户四步引导:
    步1 欢迎 → 步2 治理连接 → 步3 LLM 增强(可选) → 步4 完成
  设计约束:
    - 确定性兜底为必选路径:LLM 步可跳过,无 Key 全程可用
    - 凭据只落本机:密码/Key 经 key-crypto 加密保存(复用 UV-178 批次B/G 链路),
      不进 prompt/日志/URL;本页纯引导,无任何凭据外发路径
    - 非阻塞:任何一步都可「跳过向导」;完成态落 onboarding store
  复用:governance-store.connect / governance-config / llm-config(零新机制)
-->

<script lang="ts">
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import {
		governanceStore,
		connect,
		disconnect
	} from '$lib/governance/governance-store';
	import {
		governanceConfig,
		updateGovernanceConfig,
		saveGovernancePasswordEncrypted,
		unlockGovernancePassword,
		clearGovernancePassword,
		PASSPHRASE_MIN_LEN as GOV_PASS_MIN
	} from '$lib/config/governance-config';
	import {
		llmConfig,
		updateLlmConfig,
		saveLlmApiKeyEncrypted,
		isLlmConfigured,
		PASSPHRASE_MIN_LEN as LLM_PASS_MIN
	} from '$lib/config/llm-config';
	import { completeWelcome, completeChecklistItem } from '$lib/stores/onboarding';
	import { toastSuccess, toastError } from '$lib/stores/toast';

	// ===== 步骤状态机 =====
	const STEP_TITLES = ['欢迎', '连接治理服务', 'AI 助手(可选)', '完成'];
	let step = $state(0);

	function goNext() {
		if (step < STEP_TITLES.length - 1) step += 1;
	}
	function goPrev() {
		if (step > 0) step -= 1;
	}
	/** 显式跳过向导 = 视为完成(不再提示;帮助页可重跑) */
	function skipWizard() {
		completeWelcome();
		goto('/');
	}
	function finish() {
		completeWelcome();
		goto('/');
	}

	// ===== 步2:治理连接 =====
	let baseUrl = $state('');
	let tenantId = $state('');
	let username = $state('');
	let password = $state('');
	let connecting = $state(false);
	let connError = $state<string | null>(null);
	// 连接成功后的「记住密码」子状态
	let showRemember = $state(false);
	let rememberPassphrase = $state('');
	let rememberMsg = $state<string | null>(null);
	// 加密态解锁子状态(已有加密密码但本会话未解锁)
	let unlockPassphrase = $state('');
	let unlockError = $state<string | null>(null);

	const govConnected = $derived($governanceStore.connected);

	// 初始化表单预填(store 现值;体验包默认 baseUrl)
	$effect.pre(() => {
		if (baseUrl === '') baseUrl = $governanceConfig.baseUrl;
		if (tenantId === '') tenantId = $governanceConfig.tenantId || 'default';
	});

	/** 填入体验包默认凭据(仅本机体验包;正式部署必须更换) */
	function fillDemoCredentials() {
		username = 'admin';
		password = 'evorule-demo';
	}

	/** 可达性探测(与治理页同法:no-cors 仅判网络层通断,无 CORS 依赖) */
	async function probeReachable(url: string): Promise<boolean> {
		try {
			const ctl = new AbortController();
			const timer = setTimeout(() => ctl.abort(), 5000);
			await fetch(url.replace(/\/+$/, '') + '/', {
				method: 'GET',
				mode: 'no-cors',
				signal: ctl.signal
			});
			clearTimeout(timer);
			return true;
		} catch {
			return false;
		}
	}

	async function handleConnect() {
		if (!baseUrl.trim() || !username.trim() || !password) {
			connError = '请填写完整连接信息(地址/用户名/密码)';
			return;
		}
		// 同步进 governanceConfig(治理页共享同一 store;密码是否落盘由「记住」决定)
		updateGovernanceConfig({
			baseUrl: baseUrl.trim(),
			tenantId: tenantId.trim() || 'default',
			username: username.trim()
		});
		connecting = true;
		connError = null;
		try {
			await connect(baseUrl.trim(), tenantId.trim() || 'default', username.trim(), password);
			completeChecklistItem('governance', true);
			toastSuccess('已连接治理服务', '首跑向导');
			showRemember = true;
		} catch (e) {
			const reachable = await probeReachable(baseUrl.trim());
			const raw = e instanceof Error ? e.message : String(e);
			connError = reachable
				? `服务可达但登录失败:${raw}\n请检查用户名/密码。`
				: `无法连接 ${baseUrl.trim()}。\n请确认 evorule-rule-serve(:18081)已启动;若刚启动请稍候重试。`;
		} finally {
			connecting = false;
		}
	}

	/** 加密记住密码(口令 ≥8 位;落 key-crypto,AES-256-GCM+PBKDF2) */
	async function handleRemember() {
		rememberMsg = null;
		const r = await saveGovernancePasswordEncrypted(password, rememberPassphrase);
		if (r.ok) {
			toastSuccess('密码已加密保存到本机', '首跑向导');
			showRemember = false;
			rememberPassphrase = '';
			goNext();
		} else if (r.error === 'passphrase-short') {
			rememberMsg = `口令至少 ${GOV_PASS_MIN} 位`;
		} else {
			rememberMsg = '保存失败(浏览器不支持 Web Crypto?)';
		}
	}

	/** 解锁已加密保存的密码 */
	async function handleUnlock() {
		unlockError = null;
		const r = await unlockGovernancePassword(unlockPassphrase);
		if (r.ok) {
			completeChecklistItem('governance', true);
			toastSuccess('已解锁并连接凭据', '首跑向导');
			unlockPassphrase = '';
		} else if (r.error === 'wrong-passphrase') {
			unlockError = '口令不正确';
		} else {
			unlockError = '浏览器不支持 Web Crypto,无法解锁';
		}
	}

	/** 忘记口令:清加密块,回落手输(不做任何"找回") */
	function handleForgotPassphrase() {
		clearGovernancePassword();
		unlockError = null;
		unlockPassphrase = '';
		password = '';
	}

	// ===== 步3:LLM 增强(可选) =====
	let apiEndpoint = $state('');
	let model = $state('');
	let apiKey = $state('');
	let llmPassphrase = $state('');
	let llmError = $state<string | null>(null);
	let savingLlm = $state(false);

	$effect.pre(() => {
		if (apiEndpoint === '') apiEndpoint = $llmConfig.apiEndpoint;
		if (model === '') model = $llmConfig.model;
	});

	const llmConfigured = $derived(isLlmConfigured($llmConfig));

	async function handleSaveLlm() {
		llmError = null;
		if (!apiEndpoint.trim() || !apiKey.trim()) {
			llmError = '端点与 API Key 不能为空(只想跳过请点「跳过」)';
			return;
		}
		savingLlm = true;
		try {
			updateLlmConfig({
				enabled: true,
				channel: 'browser',
				apiEndpoint: apiEndpoint.trim(),
				model: model.trim()
			});
			const r = await saveLlmApiKeyEncrypted(apiKey.trim(), llmPassphrase);
			if (r.ok) {
				completeChecklistItem('ai-llm', true);
				toastSuccess('AI 助手已配置(Key 加密保存在本机)', '首跑向导');
				apiKey = '';
				llmPassphrase = '';
				goNext();
			} else if (r.error === 'passphrase-short') {
				llmError = `口令至少 ${LLM_PASS_MIN} 位`;
			} else if (r.error === 'key-empty') {
				llmError = 'API Key 不能为空';
			} else {
				llmError = '保存失败(浏览器不支持 Web Crypto?)';
			}
		} finally {
			savingLlm = false;
		}
	}

	function skipLlm() {
		goNext();
	}
</script>

<div class="welcome-wrap">
	<!-- 顶部:品牌 + 步骤指示器 + 跳过 -->
	<header class="wz-header">
		<div class="wz-brand">evorule <span class="wz-brand-sub">首跑向导</span></div>
		<ol class="wz-steps" aria-label="向导步骤">
			{#each STEP_TITLES as title, i}
				<li
					class="wz-step"
					class:active={i === step}
					class:done={i < step}
					aria-current={i === step ? 'step' : undefined}
				>
					<span class="wz-step-dot">{i < step ? '✓' : i + 1}</span>
					<span class="wz-step-title">{title}</span>
				</li>
			{/each}
		</ol>
		<button class="wz-skip" onclick={skipWizard}>跳过向导</button>
	</header>

	<main class="wz-card">
		<!-- ===== 步1 欢迎 ===== -->
		{#if step === 0}
			<h1 class="wz-h1">欢迎使用 evorule 👋</h1>
			<p class="wz-lead">
				evorule 是给 AI 与业务规则装上的「行车记录仪 + 红绿灯」:
				每一步都被记录、可验证、可追溯。
			</p>
			<ul class="wz-points">
				<li>🔒 <strong>数据都在你自己的电脑上</strong>——凭据加密保存本机,不上传任何第三方。</li>
				<li>🧭 <strong>接下来约 3 分钟</strong>:连接治理服务 → (可选)配置 AI 助手 → 开始使用。</li>
				<li>🔁 <strong>随时可重来</strong>——本向导可在「帮助」页重新运行,跳过的步骤以后也能补上。</li>
			</ul>
			<div class="wz-actions">
				<span></span>
				<button class="wz-btn primary" onclick={goNext}>开始 →</button>
			</div>

		<!-- ===== 步2 治理连接 ===== -->
		{:else if step === 1}
			<h1 class="wz-h1">连接治理服务</h1>
			<p class="wz-lead">
				治理服务(evorule-rule)管理你的规则资产。本机体验包启动后即在本机运行。
			</p>

			{#if govConnected}
				<div class="wz-ok">✓ 已连接治理服务,可以继续。</div>
				<div class="wz-actions">
					<button class="wz-btn ghost" onclick={() => { disconnect(); }}>断开重连</button>
					<button class="wz-btn primary" onclick={goNext}>下一步 →</button>
				</div>
			{:else if $governanceConfig.locked}
				<!-- 加密密码已保存但本会话未解锁 -->
				<p class="wz-note">
					检测到本机已加密保存过治理密码。输入主口令解锁即可连接;
					忘记口令?点下方链接清除后重新输入。
				</p>
				<div class="wz-form">
					<label class="wz-label" for="wz-unlock">主口令</label>
					<input
						id="wz-unlock"
						class="wz-input"
						type="password"
						bind:value={unlockPassphrase}
						onkeydown={(e) => e.key === 'Enter' && handleUnlock()}
						placeholder="之前设置的主口令"
					/>
					{#if unlockError}<p class="wz-error">{unlockError}</p>{/if}
					<button class="wz-btn primary" onclick={handleUnlock}>解锁并继续</button>
					<button class="wz-link" onclick={handleForgotPassphrase}>忘记口令?</button>
				</div>
			{:else}
				<div class="wz-form">
					<label class="wz-label" for="wz-baseurl">服务地址</label>
					<input id="wz-baseurl" class="wz-input" type="text" bind:value={baseUrl} placeholder="http://127.0.0.1:18081" />

					<div class="wz-row">
						<div class="wz-field">
							<label class="wz-label" for="wz-tenant">租户</label>
							<input id="wz-tenant" class="wz-input" type="text" bind:value={tenantId} />
						</div>
						<div class="wz-field">
							<label class="wz-label" for="wz-user">用户名</label>
							<input id="wz-user" class="wz-input" type="text" bind:value={username} autocomplete="username" />
						</div>
						<div class="wz-field">
							<label class="wz-label" for="wz-pass">密码</label>
							<input id="wz-pass" class="wz-input" type="password" bind:value={password} autocomplete="current-password" />
						</div>
					</div>

					<p class="wz-hint">
						💡 本机体验包默认账号 <strong>admin</strong> / 密码 <strong>evorule-demo</strong>
						——仅限体验包,正式部署请务必更换。
						<button class="wz-link" onclick={fillDemoCredentials}>一键填入</button>
					</p>

					{#if connError}<p class="wz-error wz-error-pre">{connError}</p>{/if}

					{#if showRemember}
						<!-- 连接成功:可选加密记住密码(刷新后免重输) -->
						<div class="wz-remember">
							<p class="wz-note">
								✓ 连接成功!想以后刷新也不用重新输密码吗?
								设一个主口令(至少 {GOV_PASS_MIN} 位),密码将<strong>加密保存在本机</strong>。
							</p>
							<div class="wz-row">
								<div class="wz-field">
									<label class="wz-label" for="wz-gov-passphrase">主口令(用于加密,不必记住原密码)</label>
									<input id="wz-gov-passphrase" class="wz-input" type="password" bind:value={rememberPassphrase} />
								</div>
								<button class="wz-btn primary" onclick={handleRemember}>加密记住</button>
							</div>
							{#if rememberMsg}<p class="wz-error">{rememberMsg}</p>{/if}
							<button class="wz-link" onclick={goNext}>暂不记住,直接继续 →</button>
						</div>
					{:else}
						<button class="wz-btn primary" onclick={handleConnect} disabled={connecting}>
							{connecting ? '连接中…' : '连接'}
						</button>
					{/if}
				</div>
			{/if}
			{#if govConnected || showRemember}
				<div class="wz-actions wz-actions-top">
					<button class="wz-btn ghost" onclick={goPrev}>← 上一步</button>
				</div>
			{/if}

		<!-- ===== 步3 LLM 增强(可选) ===== -->
		{:else if step === 2}
			<h1 class="wz-h1">AI 助手 <span class="wz-optional">可选 · 跳过完全不影响使用</span></h1>
			<p class="wz-lead">
				配置后可以用自然语言让 AI 帮你写规则草稿、解释执行结果。
				<strong>没有 API Key 也完全可以正常使用 evorule</strong>,随时可在「设置 → LLM 配置」补配。
			</p>

			{#if llmConfigured}
				<div class="wz-ok">✓ AI 助手已配置,可随时在「设置」中调整。</div>
				<div class="wz-actions">
					<button class="wz-btn ghost" onclick={goPrev}>← 上一步</button>
					<button class="wz-btn primary" onclick={goNext}>下一步 →</button>
				</div>
			{:else}
				<div class="wz-form">
					<label class="wz-label" for="wz-llm-endpoint">API 端点(OpenAI 兼容)</label>
					<input id="wz-llm-endpoint" class="wz-input" type="text" bind:value={apiEndpoint} />

					<label class="wz-label" for="wz-llm-model">模型名</label>
					<input id="wz-llm-model" class="wz-input" type="text" bind:value={model} />

					<label class="wz-label" for="wz-llm-key">API Key</label>
					<input id="wz-llm-key" class="wz-input" type="password" bind:value={apiKey} autocomplete="off" />

					<label class="wz-label" for="wz-llm-passphrase">主口令(至少 {LLM_PASS_MIN} 位,Key 将加密保存在本机)</label>
					<input id="wz-llm-passphrase" class="wz-input" type="password" bind:value={llmPassphrase} />

					{#if llmError}<p class="wz-error">{llmError}</p>{/if}

					<p class="wz-hint">🔒 Key 只加密保存在你电脑的浏览器里,不会上传给任何第三方,也不进入任何对话与日志。</p>

					<div class="wz-actions">
						<button class="wz-btn ghost" onclick={goPrev}>← 上一步</button>
						<div class="wz-actions-right">
							<button class="wz-btn ghost" onclick={skipLlm}>跳过,暂不配置</button>
							<button class="wz-btn primary" onclick={handleSaveLlm} disabled={savingLlm}>
								{savingLlm ? '保存中…' : '保存并继续'}
							</button>
						</div>
					</div>
				</div>
			{/if}

		<!-- ===== 步4 完成 ===== -->
		{:else}
			<h1 class="wz-h1">一切就绪 🎉</h1>
			<p class="wz-lead">现在去体验你的第一条规则吧:</p>
			<ul class="wz-points">
				<li>
					🧩 <strong>费用合规场景包</strong>(财务人员首站)——
					<a href="/marketplace" onclick={(e) => { e.preventDefault(); finish(); }}>打开「资产市场」</a>
					,选择官方资产一键部署。
				</li>
				<li>
					📜 <strong>治理中心</strong>——
					<a href="/governance" onclick={(e) => { e.preventDefault(); finish(); }}>查看与管理规则资产</a>
					的 5 态生命周期与版本链。
				</li>
				<li>❓ 用到哪儿卡住了,左侧「帮助」页随时可查,也能<strong>重新运行本向导</strong>。</li>
			</ul>
			<div class="wz-actions">
				<button class="wz-btn ghost" onclick={goPrev}>← 上一步</button>
				<button class="wz-btn primary" onclick={finish}>进入 evorule →</button>
			</div>
		{/if}
	</main>

	<footer class="wz-footer">evorule · 一切数据只保存在你自己的电脑上</footer>
</div>

<style>
	.welcome-wrap {
		min-height: calc(100vh - 52px);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 24px 16px 40px;
		gap: 20px;
	}
	.wz-header {
		width: 100%;
		max-width: 760px;
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.wz-brand {
		font-size: 16px;
		font-weight: 700;
		color: var(--text-primary);
		white-space: nowrap;
	}
	.wz-brand-sub {
		font-size: 12px;
		font-weight: 500;
		color: var(--brand);
		margin-left: 6px;
	}
	.wz-steps {
		flex: 1;
		display: flex;
		justify-content: center;
		gap: 8px;
		list-style: none;
		margin: 0;
		padding: 0;
		flex-wrap: wrap;
	}
	.wz-step {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.wz-step.active {
		color: var(--text-primary);
		font-weight: 600;
	}
	.wz-step.done {
		color: var(--success, #34d399);
	}
	.wz-step-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		font-size: 11px;
		flex-shrink: 0;
	}
	.wz-step.active .wz-step-dot {
		border-color: var(--brand);
		background: var(--brand);
		color: #fff;
	}
	.wz-step-title {
		white-space: nowrap;
	}
	.wz-skip {
		background: transparent;
		border: none;
		color: var(--text-muted);
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
	}
	.wz-skip:hover {
		color: var(--text-secondary);
		text-decoration: underline;
	}
	.wz-card {
		width: 100%;
		max-width: 760px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		padding: 28px 32px;
		box-shadow: var(--sh-modal);
	}
	.wz-h1 {
		margin: 0 0 10px;
		font-size: 22px;
		font-weight: 700;
		color: var(--text-primary);
	}
	.wz-optional {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		margin-left: 10px;
	}
	.wz-lead {
		margin: 0 0 16px;
		font-size: 14px;
		line-height: 1.7;
		color: var(--text-secondary);
	}
	.wz-points {
		margin: 0 0 20px;
		padding: 0 0 0 4px;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 14px;
		line-height: 1.7;
		color: var(--text-secondary);
	}
	.wz-points a {
		color: var(--brand);
		text-decoration: none;
	}
	.wz-points a:hover {
		text-decoration: underline;
	}
	.wz-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		margin-top: 8px;
	}
	.wz-actions-top {
		margin-top: 20px;
		justify-content: flex-start;
	}
	.wz-actions-right {
		display: flex;
		gap: 10px;
	}
	.wz-btn {
		height: 38px;
		padding: 0 22px;
		border-radius: var(--r-sm);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.wz-btn.primary {
		background: var(--brand);
		color: #fff;
	}
	.wz-btn.primary:hover {
		background: var(--brand-hover);
	}
	.wz-btn.primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.wz-btn.ghost {
		background: transparent;
		color: var(--text-secondary);
		border-color: var(--border);
	}
	.wz-btn.ghost:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	.wz-link {
		background: transparent;
		border: none;
		padding: 0;
		color: var(--brand);
		font-size: 12px;
		cursor: pointer;
	}
	.wz-link:hover {
		text-decoration: underline;
	}
	.wz-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.wz-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
		margin-top: 6px;
	}
	.wz-input {
		height: 38px;
		padding: 0 12px;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--bg-input);
		color: var(--text-primary);
		font-size: 14px;
		width: 100%;
		box-sizing: border-box;
	}
	.wz-input:focus {
		outline: none;
		border-color: var(--brand);
	}
	.wz-row {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.wz-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
		min-width: 140px;
	}
	.wz-hint {
		font-size: 12px;
		line-height: 1.6;
		color: var(--text-muted);
		margin: 4px 0 0;
	}
	.wz-note {
		font-size: 13px;
		line-height: 1.7;
		color: var(--text-secondary);
		margin: 8px 0;
	}
	.wz-remember {
		border: 1px dashed var(--border-strong);
		border-radius: var(--r-sm);
		padding: 12px 14px;
		margin-top: 8px;
	}
	.wz-error {
		font-size: 12px;
		color: var(--danger, #f87171);
		margin: 2px 0;
		white-space: pre-line;
	}
	.wz-error-pre {
		white-space: pre-line;
	}
	.wz-ok {
		font-size: 14px;
		color: var(--success, #34d399);
		font-weight: 500;
		margin: 8px 0 16px;
	}
	.wz-footer {
		font-size: 12px;
		color: var(--text-muted);
	}
	@media (max-width: 640px) {
		.wz-card {
			padding: 20px 16px;
		}
		.wz-step-title {
			display: none;
		}
	}
</style>
