<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — 设置面板 Agent 会话台连接 tab -->
<!--
  职责:
    - 启用开关 + evo-agent serve 地址 + 鉴权 Token 管理(加密/明文/清除/解锁/锁定)
    - 测试连接(GET /agents,验证可达性与凭据,展示角色清单)
  边界:LLM 模型配置在 evo-agent 侧,此处仅连接与凭据
-->

<script lang="ts">
	import {
		agentConfig,
		setAgentEnabled,
		setAgentBaseUrl,
		setAgentToken,
		saveAgentTokenEncrypted,
		saveAgentTokenPlain,
		unlockAgentToken,
		lockAgentToken,
		clearAgentToken,
		resetAgentConfig,
		isAgentConfigured,
		testAgentConnection,
		PASSPHRASE_MIN_LEN,
		type AgentSummary,
		type SaveAgentTokenError
	} from '$lib/config/agent-config';
	import { t } from '$lib/locale';

	let baseUrlInput = $state('');
	let tokenInput = $state('');
	let passphraseInput = $state('');
	let showPassphrase = $state(false);
	let isTesting = $state(false);
	let testResult = $state<{ ok: boolean; message: string; agents?: AgentSummary[] } | null>(null);
	let actionMessage = $state<{ ok: boolean; text: string } | null>(null);

	// 同步 store 到本地输入
	$effect(() => {
		baseUrlInput = $agentConfig.baseUrl;
	});
	$effect(() => {
		tokenInput = $agentConfig.authToken;
	});

	function handleBaseUrlInput(event: Event) {
		baseUrlInput = (event.target as HTMLInputElement).value;
	}

	function handleBaseUrlBlur() {
		setAgentBaseUrl(baseUrlInput);
	}

	function handleTokenInput(event: Event) {
		tokenInput = (event.target as HTMLInputElement).value;
		setAgentToken(tokenInput);
	}

	function handleEnabledChange(event: Event) {
		setAgentEnabled((event.target as HTMLInputElement).checked);
		testResult = null;
	}

	function tokenStateText(): string {
		const cfg = $agentConfig;
		if (cfg.tokenStorage === 'encrypted') {
			return cfg.locked ? t('settings.agent.state.locked') : t('settings.agent.state.encrypted');
		}
		if (cfg.tokenStorage === 'plain') return t('settings.agent.state.plain');
		return t('settings.agent.state.none');
	}

	function handleSaveEncrypted() {
		actionMessage = null;
		if (!passphraseInput.trim() || passphraseInput.trim().length < PASSPHRASE_MIN_LEN) {
			actionMessage = {
				ok: false,
				text: t('settings.agent.err.passphraseShort', { min: PASSPHRASE_MIN_LEN })
			};
			return;
		}
		void (async () => {
			const result = await saveAgentTokenEncrypted(tokenInput, passphraseInput);
			if (result.ok) {
				passphraseInput = '';
				actionMessage = { ok: true, text: t('settings.agent.toast.encryptedSaved') };
			} else {
				actionMessage = { ok: false, text: saveErrorText(result.error) };
			}
		})();
	}

	function handleSavePlain() {
		actionMessage = null;
		if (!window.confirm(t('settings.agent.confirm.plain'))) return;
		saveAgentTokenPlain(tokenInput);
		actionMessage = { ok: true, text: t('settings.agent.toast.plainSaved') };
	}

	function handleUnlock() {
		actionMessage = null;
		void (async () => {
			const result = await unlockAgentToken(passphraseInput);
			if (result.ok) {
				passphraseInput = '';
				actionMessage = { ok: true, text: t('settings.agent.toast.unlocked') };
			} else {
				actionMessage = { ok: false, text: unlockErrorText(result.error) };
			}
		})();
	}

	function handleLock() {
		actionMessage = null;
		lockAgentToken();
		actionMessage = { ok: true, text: t('settings.agent.toast.locked') };
	}

	function handleClear() {
		actionMessage = null;
		clearAgentToken();
		tokenInput = '';
		passphraseInput = '';
		actionMessage = { ok: true, text: t('settings.agent.toast.cleared') };
	}

	function handleReset() {
		actionMessage = null;
		if (!window.confirm(t('settings.agent.confirm.reset'))) return;
		resetAgentConfig();
		baseUrlInput = $agentConfig.baseUrl;
		tokenInput = '';
		passphraseInput = '';
		testResult = null;
	}

	function saveErrorText(err: SaveAgentTokenError): string {
		switch (err) {
			case 'token-empty':
				return t('settings.agent.err.tokenEmpty');
			case 'passphrase-short':
				return t('settings.agent.err.passphraseShort', { min: PASSPHRASE_MIN_LEN });
			case 'crypto-unavailable':
				return t('settings.agent.err.cryptoUnavailable');
			case 'encrypt-failed':
				return t('settings.agent.err.encryptFailed');
		}
	}

	function unlockErrorText(err: 'wrong-passphrase' | 'no-encrypted-token' | 'crypto-unavailable'): string {
		switch (err) {
			case 'wrong-passphrase':
				return t('settings.agent.err.wrongPassphrase');
			case 'no-encrypted-token':
				return t('settings.agent.err.noEncryptedToken');
			case 'crypto-unavailable':
				return t('settings.agent.err.cryptoUnavailable');
		}
	}

	async function handleTestConnection() {
		isTesting = true;
		testResult = null;
		const result = await testAgentConnection($agentConfig);
		isTesting = false;
		if (result.ok) {
			const names = result.agents.map((a) => a.agent_type);
			testResult = {
				ok: true,
				message: t('settings.agent.testSuccess', { count: result.agents.length, roles: names.join(', ') }),
				agents: result.agents
			};
		} else {
			testResult = {
				ok: false,
				message: t('settings.agent.testFail', { message: result.message })
			};
		}
	}
</script>

<section class="agent-settings">
	<header class="section-header">
		<h2>{t('settings.agent.title')}</h2>
		<p class="section-desc">{t('settings.agent.desc')}</p>
	</header>

	<!-- 启用开关 -->
	<div class="form-row form-row-inline">
		<label for="agent-enabled">
			<input id="agent-enabled" type="checkbox" checked={$agentConfig.enabled} onchange={handleEnabledChange} />
			{t('settings.agent.enableLabel')}
		</label>
		<small class="hint">{t('settings.agent.enableHint')}</small>
	</div>

	<!-- 服务地址 -->
	<div class="form-row">
		<label for="agent-base-url">{t('settings.agent.baseUrlLabel')}</label>
		<input
			id="agent-base-url"
			type="text"
			value={baseUrlInput}
			oninput={handleBaseUrlInput}
			onblur={handleBaseUrlBlur}
			placeholder="http://127.0.0.1:8081"
		/>
		<small class="hint">{t('settings.agent.baseUrlHint')}</small>
	</div>

	<!-- 鉴权 Token -->
	<div class="form-row">
		<label for="agent-token">{t('settings.agent.tokenLabel')}</label>
		<input
			id="agent-token"
			type="password"
			value={tokenInput}
			oninput={handleTokenInput}
			placeholder={t('settings.agent.tokenPlaceholder')}
			autocomplete="off"
		/>
		<small class="hint">{t('settings.agent.tokenHint')}</small>
		<div class="token-state">
			<span>{t('settings.agent.tokenState')}{tokenStateText()}</span>
		</div>
	</div>

	<!-- 口令输入(加密保存 / 解锁共用) -->
	{#if $agentConfig.tokenStorage !== 'plain'}
		<div class="form-row">
			<label for="agent-passphrase">{t('settings.agent.passphraseLabel')}</label>
			<div class="pass-row">
				<input
					id="agent-passphrase"
					type={showPassphrase ? 'text' : 'password'}
					value={passphraseInput}
					oninput={(e) => (passphraseInput = (e.target as HTMLInputElement).value)}
					placeholder={t('settings.agent.passphrasePlaceholder')}
					autocomplete="off"
				/>
				<button class="btn btn-secondary btn-sm" type="button" onclick={() => (showPassphrase = !showPassphrase)}>
					{showPassphrase ? t('settings.agent.hidePassphrase') : t('settings.agent.showPassphrase')}
				</button>
			</div>
			<small class="hint">{t('settings.agent.passphraseHint')}</small>
		</div>
	{/if}

	<!-- Token 管理动作 -->
	<div class="form-actions">
		{#if $agentConfig.tokenStorage === 'encrypted'}
			{#if $agentConfig.locked}
				<button class="btn btn-secondary" type="button" onclick={handleUnlock}>
					{t('settings.agent.unlock')}
				</button>
			{:else}
				<button class="btn btn-secondary" type="button" onclick={handleSaveEncrypted}>
					{t('settings.agent.resaveEncrypted')}
				</button>
				<button class="btn btn-secondary" type="button" onclick={handleLock}>
					{t('settings.agent.lock')}
				</button>
			{/if}
		{:else}
			<button class="btn btn-primary" type="button" onclick={handleSaveEncrypted} disabled={!tokenInput}>
				{t('settings.agent.saveEncrypted')}
			</button>
			<button class="btn btn-secondary" type="button" onclick={handleSavePlain} disabled={!tokenInput}>
				{t('settings.agent.savePlain')}
			</button>
		{/if}
		<button class="btn btn-secondary" type="button" onclick={handleClear} disabled={$agentConfig.tokenStorage === 'none' && !tokenInput}>
			{t('settings.agent.clear')}
		</button>
		<button class="btn btn-secondary" type="button" onclick={handleReset}>
			{t('settings.agent.reset')}
		</button>
	</div>

	{#if actionMessage}
		<div class="alert" class:alert-success={actionMessage.ok} class:alert-error={!actionMessage.ok}>
			{actionMessage.ok ? '✅' : '❌'} {actionMessage.text}
		</div>
	{/if}

	<!-- 测试连接 -->
	<div class="form-actions">
		<button class="btn btn-secondary" onclick={handleTestConnection} disabled={isTesting || !isAgentConfigured($agentConfig)}>
			{isTesting ? t('common.testing') : t('settings.agent.testBtn')}
		</button>
	</div>

	{#if testResult}
		<div class="alert" class:alert-success={testResult.ok} class:alert-error={!testResult.ok}>
			{testResult.ok ? '✅' : '❌'} {testResult.message}
		</div>
		{#if testResult.ok && testResult.agents}
			<div class="agents-list">
				{#each testResult.agents as a (a.agent_type)}
					<div class="agent-card">
						<div class="agent-card-head">
							<code>{a.agent_type}</code>
							<span class="agent-ver">v{a.version}</span>
						</div>
						<p class="agent-desc">{a.description}</p>
						<small class="agent-tools">{t('settings.agent.toolsCount', { count: a.tools.length })}</small>
					</div>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- 当前状态 -->
	<div class="current-status">
		<h3>{t('settings.agent.currentStatus')}</h3>
		<dl>
			<dt>{t('settings.agent.statusEnabled')}</dt>
			<dd>{$agentConfig.enabled ? t('settings.agent.statusOn') : t('settings.agent.statusOff')}</dd>
			<dt>baseUrl</dt>
			<dd><code>{$agentConfig.baseUrl}</code></dd>
			<dt>{t('settings.agent.statusToken')}</dt>
			<dd>{tokenStateText()}</dd>
		</dl>
	</div>
</section>

<style>
	.agent-settings {
		display: block;
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
	.form-row {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
		margin-bottom: var(--spacing-md);
	}
	.form-row-inline {
		flex-direction: column;
		gap: 2px;
	}
	.form-row-inline label {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-primary);
		cursor: pointer;
	}
	.form-row-inline input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: var(--brand);
	}
	.form-row label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-primary);
	}
	.form-row input[type='text'],
	.form-row input[type='password'] {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		box-sizing: border-box;
		background: var(--bg-card);
		color: var(--text-primary);
	}
	.form-row input:focus {
		outline: none;
		border-color: var(--brand);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.token-state {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.pass-row {
		display: flex;
		gap: var(--spacing-sm);
	}
	.pass-row input {
		flex: 1;
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
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
	.btn-sm {
		padding: var(--spacing-xs) var(--spacing-sm);
		font-size: var(--text-xs);
	}
	.btn-primary {
		background: var(--brand);
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--brand-hover, var(--brand));
	}
	.btn-secondary {
		background: var(--border);
		color: var(--text-primary);
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
	.agents-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--spacing-sm);
		margin: var(--spacing-sm) 0 var(--spacing-md);
	}
	.agent-card {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.agent-card-head {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-sm);
	}
	.agent-card-head code {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--brand);
	}
	.agent-ver {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.agent-desc {
		margin: 4px 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		line-height: 1.4;
	}
	.agent-tools {
		font-size: var(--text-xs);
		color: var(--text-secondary);
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
</style>
