<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — LLM 配置面板 -->
<!--
  职责:
    - 启用/禁用 LLM 开关
    - 选择厂商预设(智谱/通义/DeepSeek/OpenAI/自定义)
    - apiEndpoint 输入(预设自动填,可手动改)
    - apiKey 密码框(不显示明文)
    - model 下拉(预设提供选项)
    - 测试连接按钮(调用 testConnection 验证)
    - 保存配置(写 llmConfig store + 提示用户刷新页面以重注入)

  apiKey 安全(UV-178 批次B):
    - 缺省:口令加密后落盘(AES-GCM+PBKDF2,config/key-crypto.ts);
      本会话未解锁时显示解锁面板(locked)
    - 明文保存为显式选择(旧配置自动兼容为 plain 形态,行为不变)
    - 不进日志/错误/URL(由 cloud-llm-assistant.ts 保证)
    - 设置面板明示"key/口令均不上传服务器"

  刷新提示:
    - 修改配置后,LLM provider 需要重新注入 Svelte context
    - 当前实现:保存后调用 location.reload() 强制重注入
    - UX 提示:"配置已保存,正在刷新页面以应用..."
-->

<script lang="ts">
	import {
		llmConfig,
		setLlmEnabled,
		setLlmChannel,
		updateLlmConfig,
		resetLlmConfig,
		saveLlmApiKeyPlain,
		saveLlmApiKeyEncrypted,
		unlockLlmApiKey,
		PASSPHRASE_MIN_LEN
	} from '$lib/config/llm-config';
	import { hasWebCrypto } from '$lib/config/key-crypto';
	import { LLM_PRESETS, findPreset, getPresetOptions } from '$lib/config/llm-presets';
	import { CloudLlmAssistant } from '$lib/assistant/cloud-llm-assistant';
	import AiPluginActivationCard from './AiPluginActivationCard.svelte';
	import { t } from '$lib/locale';

	let apiKeyInput = $state('');
	let showApiKey = $state(false);
	let isTesting = $state(false);
	let testResult = $state<{ ok: boolean; message: string; serverUnreachable?: boolean } | null>(
		null
	);
	let isSaving = $state(false);
	let savedNotice = $state(false);

	// === UV-178 批次B:凭据保存形态 + 解锁 ===
	// 加密保存为缺省;plain 仅旧配置兼容或显式选择
	let saveMode = $state<'encrypted' | 'plain'>(
		$llmConfig.keyStorage === 'plain' ? 'plain' : 'encrypted'
	);
	let passphrase = $state('');
	let passphraseConfirm = $state('');
	let saveErr = $state('');
	let unlockPass = $state('');
	let unlockErr = $state('');
	// 非安全上下文(http 局域网直连)无 WebCrypto → 隐藏加密选项
	const cryptoOk = hasWebCrypto();

	// 同步当前 store 中的 apiKey 到输入框(初始化)
	$effect(() => {
		apiKeyInput = $llmConfig.apiKey;
	});

	function handleProviderChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		const provider = select.value;
		const preset = findPreset(provider);
		if (!preset) return;

		if (preset.needsAdapter) {
			// 文心一言等不兼容的,不让选
			return;
		}

		// 应用预设:endpoint + model(保留 apiKey 不变,让用户自己填)
		updateLlmConfig({
			provider: preset.provider,
			apiEndpoint: preset.apiEndpoint,
			model: preset.defaultModel
		});

		// 预设占位 Key(如 Ollama 固定 'ollama'):仅当用户未填 Key 时自动填入,
		// 避免覆盖用户从其他厂商带来的真实 Key
		if (preset.presetApiKey && !apiKeyInput.trim()) {
			updateLlmConfig({ apiKey: preset.presetApiKey });
		}

		// 清空测试结果(切换厂商后需重测)
		testResult = null;
	}

	function handleEndpointInput(event: Event) {
		const input = event.target as HTMLInputElement;
		updateLlmConfig({ apiEndpoint: input.value.trim() });
	}

	function handleApiKeyInput(event: Event) {
		const input = event.target as HTMLInputElement;
		apiKeyInput = input.value;
		// 不立即写 store,等保存按钮统一写(避免每次按键触发持久化)
		// 但为了让 testConnection 能用最新 key,直接更新 store
		updateLlmConfig({ apiKey: apiKeyInput });
	}

	function handleModelChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		updateLlmConfig({ model: select.value });
	}

	function handleToggleEnabled(event: Event) {
		const checkbox = event.target as HTMLInputElement;
		setLlmEnabled(checkbox.checked);
	}

	async function handleTestConnection() {
		const cfg = $llmConfig;
		// server 通道:凭据在服务端,只要求 enabled(browser 通道仍要求三项齐备)
		if (cfg.channel !== 'server' && (!cfg.apiEndpoint || !cfg.apiKey || !cfg.model)) {
			testResult = {
				ok: false,
				message: t('llm.err.incompleteConfig')
			};
			return;
		}

		isTesting = true;
		testResult = null;
		try {
			const assistant = new CloudLlmAssistant(cfg);
			const result = await assistant.testConnection();
			testResult = result;
		} catch (e) {
			testResult = {
				ok: false,
				message: t('llm.err.testFail', { message: (e as Error).message })
			};
		} finally {
			isTesting = false;
		}
	}

	async function handleUnlock() {
		unlockErr = '';
		const r = await unlockLlmApiKey(unlockPass);
		if (r.ok) {
			unlockPass = '';
			// apiKeyInput 由 $effect 从 store 同步;解锁后建议刷新使 provider 注入生效
			if (confirm(t('llm.confirmSave'))) {
				location.reload();
			}
		} else {
			unlockErr = r.error;
		}
	}

	async function handleSave() {
		saveErr = '';
		if ($llmConfig.channel === 'browser') {
			const key = apiKeyInput;
			const keyNeedsPersist =
				key !== $llmConfig.apiKey || $llmConfig.keyStorage !== 'encrypted' || $llmConfig.locked;
			if (saveMode === 'encrypted') {
				// Key 未变且已是加密态 → 无需重新加密(避免每次保存都输口令)
				if (keyNeedsPersist) {
					if (!cryptoOk) {
						saveErr = 'no-crypto';
						return;
					}
					if (!key.trim()) {
						saveErr = 'key-empty';
						return;
					}
					if (passphrase.trim().length < PASSPHRASE_MIN_LEN) {
						saveErr = 'passphrase-short';
						return;
					}
					if (passphrase !== passphraseConfirm) {
						saveErr = 'passphrase-mismatch';
						return;
					}
					isSaving = true;
					const r = await saveLlmApiKeyEncrypted(key, passphrase);
					isSaving = false;
					if (!r.ok) {
						saveErr = r.error;
						return;
					}
					passphrase = '';
					passphraseConfirm = '';
				}
			} else {
				// 显式明文保存(空 Key 视为清除)
				saveLlmApiKeyPlain(key);
			}
		}
		isSaving = true;
		savedNotice = true;
		setTimeout(() => {
			isSaving = false;
			// 现取语义下配置改动即时生效;唯一例外:页面加载时 LLM 尚未配置的
			// 场景,注入的是 null(按钮不渲染),需刷新一次让 AI 按钮出现
			if (confirm(t('llm.confirmSave'))) {
				location.reload();
			} else {
				savedNotice = false;
			}
		}, 500);
	}

	function handleReset() {
		if (confirm(t('llm.confirmReset'))) {
			resetLlmConfig();
			apiKeyInput = '';
			passphrase = '';
			passphraseConfirm = '';
			unlockPass = '';
			saveErr = '';
			unlockErr = '';
			saveMode = 'encrypted';
			testResult = null;
		}
	}

	// 当前选中的预设(用于显示帮助链接 + 备选模型)
	let currentPreset = $derived(findPreset($llmConfig.provider));
</script>

<section class="llm-settings">
	<header class="section-header">
		<h2>{t('llm.title')}</h2>
		<p class="section-desc">
			{t('llm.desc')}
		</p>
	</header>

	<!-- 1. 启用开关 -->
	<div class="form-row">
		<label class="switch-label">
			<input
				type="checkbox"
				checked={$llmConfig.enabled}
				onchange={handleToggleEnabled}
			/>
			<span>{t('llm.enableLabel')}</span>
		</label>
		<small class="hint">{t('llm.disableHint')}</small>
	</div>

	<!-- UV-178 批次C:初始态激活入径(一行入口,一键进入 server 激活卡) -->
	{#if !$llmConfig.enabled}
		<div class="onboard-row">
			<small class="hint">{t('llm.onboardHint')}</small>
			<button
				type="button"
				class="onboard-btn"
				onclick={() => {
					setLlmEnabled(true);
					setLlmChannel('server');
				}}
			>
				{t('llm.onboardBtn')} →
			</button>
		</div>
	{/if}

	{#if $llmConfig.enabled}
		<!-- 2. 执行通道(UV-172 P2:browser=现状;server=ai-plugin 托管执行) -->
	<div class="form-row">
		<label for="llm-channel">{t('llm.channelLabel')}</label>
		<select
			id="llm-channel"
			value={$llmConfig.channel}
			onchange={(e) =>
				updateLlmConfig({ channel: (e.target as HTMLSelectElement).value as 'browser' | 'server' })}
		>
			<option value="browser">{t('llm.channelBrowser')}</option>
			<option value="server">{t('llm.channelServer')}</option>
		</select>
		{#if $llmConfig.channel === 'server'}
			<small class="hint">{t('llm.channelServerHint')}</small>
		{/if}
	</div>

		{#if $llmConfig.channel === 'server'}
			<!-- UV-177:激活状态卡(三态检测+分步引导;逻辑在 assistant/ai-plugin-status.ts) -->
			<AiPluginActivationCard />
		{/if}

	{#if $llmConfig.channel === 'browser'}
		<!-- 3. 厂商预设 -->
		<div class="form-row">
			<label for="llm-provider">{t('llm.providerLabel')}</label>
			<select id="llm-provider" onchange={handleProviderChange} value={$llmConfig.provider}>
				{#each getPresetOptions() as opt (opt.value)}
					<option value={opt.value} disabled={opt.disabled}>
						{opt.label}
					</option>
				{/each}
			</select>
			{#if currentPreset?.helpUrl}
				<a
					href={currentPreset.helpUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="help-link"
				>
					{t('llm.helpLink')}
				</a>
			{/if}
		</div>

		{#if currentPreset?.needsAdapter}
			<div class="alert alert-info">
				ℹ️ {currentPreset.adapterNote}
			</div>
		{/if}

		<!-- 4. apiEndpoint -->
		<div class="form-row">
			<label for="llm-endpoint">{t('llm.endpointLabel')}</label>
			<input
				id="llm-endpoint"
				type="text"
				value={$llmConfig.apiEndpoint}
				oninput={handleEndpointInput}
				placeholder="https://api.example.com/v1/chat/completions"
				disabled={currentPreset?.needsAdapter}
			/>
		</div>

		<!-- 5. apiKey(UV-178 批次B:locked=加密态未解锁 → 解锁面板;否则 Key 行 + 保存形态) -->
		{#if $llmConfig.locked}
			<div class="form-row unlock-box">
				<label for="llm-unlock">{t('llm.sec.unlockTitle')}</label>
				<div class="api-key-row">
					<input
						id="llm-unlock"
						type="password"
						bind:value={unlockPass}
						placeholder={t('llm.sec.passphrasePlaceholder')}
						autocomplete="off"
						onkeydown={(e) => {
							if (e.key === 'Enter') void handleUnlock();
						}}
					/>
					<button type="button" class="toggle-visibility" onclick={() => void handleUnlock()}>
						{t('llm.sec.unlockBtn')}
					</button>
				</div>
				{#if unlockErr}
					<small class="err">{t(`llm.sec.err.${unlockErr}`)}</small>
				{/if}
				<small class="hint">{t('llm.sec.unlockHint')}</small>
				<button type="button" class="forgot-link" onclick={handleReset}>
					{t('llm.sec.forgotBtn')}
				</button>
			</div>
		{:else}
			<div class="form-row">
				<label for="llm-apikey">{t('llm.apikeyLabel')}</label>
				<div class="api-key-row">
					<input
						id="llm-apikey"
						type={showApiKey ? 'text' : 'password'}
						value={apiKeyInput}
						oninput={handleApiKeyInput}
						placeholder="sk-..."
						autocomplete="off"
						disabled={currentPreset?.needsAdapter}
					/>
					<button
						type="button"
						class="toggle-visibility"
						onclick={() => (showApiKey = !showApiKey)}
						tabindex="0"
						aria-label={showApiKey ? t('llm.hideKey') : t('llm.showKey')}
					>
						{showApiKey ? '🙈' : '👁️'}
					</button>
				</div>
				<!-- 保存形态(加密为缺省;明文仅显式选择) -->
				<div class="sec-mode" role="radiogroup" aria-label={t('llm.sec.storageLabel')}>
					<span class="sec-mode-label">{t('llm.sec.storageLabel')}</span>
					<label class="radio-label">
						<input type="radio" bind:group={saveMode} value="encrypted" disabled={!cryptoOk} />
						{t('llm.sec.storageEncrypted')}
					</label>
					<label class="radio-label">
						<input type="radio" bind:group={saveMode} value="plain" />
						{t('llm.sec.storagePlain')}
					</label>
				</div>
				{#if !cryptoOk}
					<small class="hint">{t('llm.sec.noCrypto')}</small>
				{/if}
				{#if $llmConfig.keyStorage === 'plain'}
					<small class="hint warn">{t('llm.sec.plainHint')}</small>
				{/if}
				{#if saveMode === 'encrypted'}
					<div class="sec-pass-row">
						<input
							type="password"
							bind:value={passphrase}
							placeholder={t('llm.sec.passphraseLabel')}
							autocomplete="new-password"
							aria-label={t('llm.sec.passphraseLabel')}
						/>
						<input
							type="password"
							bind:value={passphraseConfirm}
							placeholder={t('llm.sec.passphraseConfirm')}
							autocomplete="new-password"
							aria-label={t('llm.sec.passphraseConfirm')}
						/>
					</div>
					<small class="hint">{t('llm.sec.passphraseNote')}</small>
				{/if}
				{#if saveErr}
					<small class="err">{t(`llm.sec.err.${saveErr}`)}</small>
				{/if}
				<small class="hint">
					{t('llm.keyHint')}
				</small>
			</div>
		{/if}
	{/if}

		<!-- 6. model(两通道共用:server 通道为可选覆盖,留空用插件缺省) -->
		<div class="form-row">
			<label for="llm-model">{t('llm.modelLabel')}</label>
			{#if currentPreset && currentPreset.models.length > 0}
				<select id="llm-model" onchange={handleModelChange} value={$llmConfig.model}>
					{#each currentPreset.models as m (m)}
						<option value={m}>{m}</option>
					{/each}
				</select>
			{:else}
				<input
					id="llm-model"
					type="text"
					value={$llmConfig.model}
					oninput={(e) =>
						updateLlmConfig({ model: (e.target as HTMLInputElement).value.trim() })}
					placeholder="model-name"
					disabled={currentPreset?.needsAdapter}
				/>
			{/if}
		</div>

		<!-- 6. 操作按钮 -->
		<div class="form-actions">
			<button
				class="btn btn-secondary"
				onclick={handleTestConnection}
				disabled={isTesting || currentPreset?.needsAdapter}
			>
				{isTesting ? t('common.testing') : t('llm.testBtn')}
			</button>
			<button class="btn btn-secondary" onclick={handleReset}>{t('llm.reset')}</button>
			<button class="btn btn-primary" onclick={handleSave} disabled={isSaving}>
				{isSaving ? t('llm.saving') : t('llm.saveApply')}
			</button>
		</div>

		<!-- 7. 测试结果 -->
		{#if testResult}
			<div class="alert" class:alert-success={testResult.ok} class:alert-error={!testResult.ok}>
				{testResult.ok ? '✅' : '❌'} {testResult.message}
			</div>
		{/if}

		<!-- 7b. server 通道不可达诊断(UV-177):指向激活引导卡,不遮蔽原始错误 -->
		{#if testResult && !testResult.ok && testResult.serverUnreachable}
			<div class="alert alert-info">{t('llm.err.aiPluginHint')}</div>
		{/if}

		<!-- 8. 保存提示 -->
		{#if savedNotice}
			<div class="alert alert-info">{t('llm.savedNotice')}</div>
		{/if}
	{:else}
		<div class="alert alert-info">
			{t('llm.disabledNotice')}
		</div>
	{/if}

	<!-- 本地 LLM:Ollama 预设已可用(OpenAI 兼容端点直连本机);L2 指 llama.cpp 等深度集成 -->
	<hr class="divider" />
	<div class="l2-placeholder">
		<h3>{t('llm.localTitle')}</h3>
		<p class="hint">
			{t('llm.localSupport')}
			<code>ollama serve</code>
			{t('llm.localSupport2')}
		</p>
		<p class="hint muted">
			{t('llm.localDeep')}
		</p>
	</div>
</section>

<style>
	.llm-settings {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-md);
	}
	.section-header h2 {
		margin: 0 0 var(--spacing-xs);
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
	}
	.section-desc {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.form-row {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}
	.form-row label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-primary);
	}
	.form-row input,
	.form-row select {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		background: var(--bg-page);
		box-sizing: border-box;
	}
	.form-row input:focus,
	.form-row select:focus {
		outline: none;
		border-color: var(--brand);
		box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
	}
	.form-row input:disabled,
	.form-row select:disabled {
		background: var(--bg-hover);
		color: var(--text-secondary);
		cursor: not-allowed;
	}
	.switch-label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-weight: 500;
		cursor: pointer;
	}
	.switch-label input {
		width: auto;
		padding: 0;
		margin: 0;
	}
	.api-key-row {
		display: flex;
		gap: var(--spacing-xs);
	}
	.api-key-row input {
		flex: 1;
	}
	.toggle-visibility {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--border);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-base);
	}
	.toggle-visibility:hover {
		background: var(--border);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.hint.warn {
		color: var(--warning, #d97706);
	}
	.err {
		font-size: var(--text-xs);
		color: var(--danger);
	}
	/* UV-178 批次B:解锁面板 + 保存形态 */
	.unlock-box {
		padding: var(--spacing-sm);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.sec-mode {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}
	.sec-mode-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.radio-label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-primary);
		cursor: pointer;
	}
	.radio-label input {
		width: auto;
		padding: 0;
		margin: 0;
	}
	.forgot-link {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		font-size: var(--text-xs);
		color: var(--brand);
		cursor: pointer;
		text-decoration: underline;
	}
	/* UV-178 批次C:初始态激活入径(一行入口) */
	.onboard-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
		padding: var(--spacing-sm) var(--spacing-md);
		background: color-mix(in srgb, var(--brand) 8%, var(--bg-card));
		border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--border));
		border-radius: var(--radius-md);
	}
	.onboard-row .hint {
		flex: 1;
		min-width: 200px;
	}
	.onboard-btn {
		padding: var(--spacing-xs) var(--spacing-md);
		border-radius: var(--radius-md);
		font-size: var(--text-xs);
		cursor: pointer;
		background: var(--brand);
		color: #fff;
		border: 1px solid var(--brand);
		white-space: nowrap;
	}
	.sec-pass-row {
		display: flex;
		gap: var(--spacing-xs);
		flex-wrap: wrap;
	}
	.sec-pass-row input {
		flex: 1;
		min-width: 140px;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		background: var(--bg-page);
		box-sizing: border-box;
	}
	.sec-pass-row input:focus {
		outline: none;
		border-color: var(--brand);
	}
	.hint.muted {
		color: var(--text-secondary);
		font-style: italic;
	}
	.help-link {
		font-size: var(--text-xs);
		color: var(--brand);
		text-decoration: none;
		align-self: flex-start;
	}
	.help-link:hover {
		text-decoration: underline;
	}
	.form-actions {
		display: flex;
		gap: var(--spacing-sm);
		flex-wrap: wrap;
	}
	.btn {
		padding: var(--spacing-sm) var(--spacing-md);
		border: none;
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-weight: 500;
		transition: all var(--transition-fast);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary {
		background: var(--brand);
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--brand-hover);
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
	}
	.alert-success {
		background: var(--success);
		color: #fff;
	}
	.alert-error {
		background: var(--danger);
		color: #fff;
	}
	.alert-info {
		background: var(--info);
		color: #fff;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--border);
		margin: var(--spacing-md) 0;
	}
	.l2-placeholder h3 {
		margin: 0 0 var(--spacing-xs);
		font-size: var(--text-base);
		color: var(--text-secondary);
	}
	.l2-placeholder p {
		margin: var(--spacing-xs) 0;
	}
</style>
