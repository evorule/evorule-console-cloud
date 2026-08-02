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

  apiKey 安全:
    - localStorage 明文(大众版可接受,提示用户)
    - 不进日志/错误/URL(由 cloud-llm-assistant.ts 保证)
    - 设置面板明示"key 存于本地,不上传到服务器"

  刷新提示:
    - 修改配置后,LLM provider 需要重新注入 Svelte context
    - 当前实现:保存后调用 location.reload() 强制重注入
    - UX 提示:"配置已保存,正在刷新页面以应用..."
-->

<script lang="ts">
	import {
		llmConfig,
		setLlmEnabled,
		updateLlmConfig,
		resetLlmConfig
	} from '$lib/config/llm-config';
	import { LLM_PRESETS, findPreset, getPresetOptions } from '$lib/config/llm-presets';
	import { CloudLlmAssistant } from '$lib/assistant/cloud-llm-assistant';

	let apiKeyInput = $state('');
	let showApiKey = $state(false);
	let isTesting = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);
	let isSaving = $state(false);
	let savedNotice = $state(false);

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
		if (!cfg.apiEndpoint || !cfg.apiKey || !cfg.model) {
			testResult = {
				ok: false,
				message: '请先填写完整配置(endpoint + apiKey + model)'
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
				message: `测试失败: ${(e as Error).message}`
			};
		} finally {
			isTesting = false;
		}
	}

	function handleSave() {
		// apiKey 已经在 onInput 时实时写入 store,这里只是触发 UI 反馈
		// llmConfig 是响应式 store,持久化自动完成
		isSaving = true;
		savedNotice = true;
		setTimeout(() => {
			isSaving = false;
			// 提示用户刷新页面以重注入 LLM provider
			if (
				confirm(
					'配置已保存。\n\n由于 LLM provider 需要在组件初始化时注入,需要刷新页面才能让新配置生效。\n\n是否立即刷新页面?'
				)
			) {
				location.reload();
			} else {
				savedNotice = false;
			}
		}, 500);
	}

	function handleReset() {
		if (confirm('确定要重置 LLM 配置吗?apiKey 会被清空。')) {
			resetLlmConfig();
			apiKeyInput = '';
			testResult = null;
		}
	}

	// 当前选中的预设(用于显示帮助链接 + 备选模型)
	let currentPreset = $derived(findPreset($llmConfig.provider));
</script>

<section class="llm-settings">
	<header class="section-header">
		<h2>🤖 LLM 配置</h2>
		<p class="section-desc">
			配置云 LLM 实现自然语言 → 规则草案 / 解释 / 测试输入 三大辅助功能。
			LLM 仅作辅助层,不参与确定性执行,所有输出需用户审核采用。
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
			<span>启用 LLM 辅助</span>
		</label>
		<small class="hint">关闭后行为与 evorule-console 内核一致(LLM 按钮不渲染)</small>
	</div>

	{#if $llmConfig.enabled}
		<!-- 2. 厂商预设 -->
		<div class="form-row">
			<label for="llm-provider">厂商预设</label>
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
					如何获取 apiKey? ↗
				</a>
			{/if}
		</div>

		{#if currentPreset?.needsAdapter}
			<div class="alert alert-info">
				ℹ️ {currentPreset.adapterNote}
			</div>
		{/if}

		<!-- 3. apiEndpoint -->
		<div class="form-row">
			<label for="llm-endpoint">API Endpoint(OpenAI 兼容)</label>
			<input
				id="llm-endpoint"
				type="text"
				value={$llmConfig.apiEndpoint}
				oninput={handleEndpointInput}
				placeholder="https://api.example.com/v1/chat/completions"
				disabled={currentPreset?.needsAdapter}
			/>
		</div>

		<!-- 4. apiKey -->
		<div class="form-row">
			<label for="llm-apikey">API Key</label>
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
					aria-label={showApiKey ? '隐藏 apiKey' : '显示 apiKey'}
				>
					{showApiKey ? '🙈' : '👁️'}
				</button>
			</div>
			<small class="hint">
				🔒 apiKey 存于浏览器本地(localStorage),不上传到任何服务器。
				请避免在共享电脑上使用,或定期清理浏览器数据。
			</small>
		</div>

		<!-- 5. model -->
		<div class="form-row">
			<label for="llm-model">模型</label>
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
				{isTesting ? '⏳ 测试中...' : '🔌 测试连接'}
			</button>
			<button class="btn btn-secondary" onclick={handleReset}>重置</button>
			<button class="btn btn-primary" onclick={handleSave} disabled={isSaving}>
				{isSaving ? '⏳ 保存中...' : '💾 保存并应用'}
			</button>
		</div>

		<!-- 7. 测试结果 -->
		{#if testResult}
			<div class="alert" class:alert-success={testResult.ok} class:alert-error={!testResult.ok}>
				{testResult.ok ? '✅' : '❌'} {testResult.message}
			</div>
		{/if}

		<!-- 8. 保存提示 -->
		{#if savedNotice}
			<div class="alert alert-info">ℹ️ 配置已保存,刷新页面以应用新配置...</div>
		{/if}
	{:else}
		<div class="alert alert-info">
			ℹ️ LLM 已禁用。规则库/执行台视图将与 evorule-console 内核一致,不渲染 AI 按钮。
			启用后可配置云 LLM 厂商(智谱 GLM 有免费额度)。
		</div>
	{/if}

	<!-- L2 占位(Phase 7 规划文档,Phase 6 仅占位) -->
	<hr class="divider" />
	<div class="l2-placeholder">
		<h3>🖥️ 本地 LLM(L2,付费扩展,敬请期待)</h3>
		<p class="hint">
			基于 Ollama / llama.cpp 的本地 LLM 集成,无需联网,数据不出本机。
			适合对数据隐私要求高的企业用户。
		</p>
		<p class="hint muted">规划中,大众版 v0.1.0 不含此功能。详见 docs/L2_LOCAL_LLM_PLAN.md</p>
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
		color: var(--color-gray-900);
	}
	.section-desc {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-gray-600);
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
		color: var(--color-gray-700);
	}
	.form-row input,
	.form-row select {
		width: 100%;
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--color-gray-300);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		background: var(--color-gray-50);
		box-sizing: border-box;
	}
	.form-row input:focus,
	.form-row select:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
	}
	.form-row input:disabled,
	.form-row select:disabled {
		background: var(--color-gray-100);
		color: var(--color-gray-500);
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
		background: var(--color-gray-200);
		border: 1px solid var(--color-gray-300);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-base);
	}
	.toggle-visibility:hover {
		background: var(--color-gray-300);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--color-gray-600);
	}
	.hint.muted {
		color: var(--color-gray-400);
		font-style: italic;
	}
	.help-link {
		font-size: var(--text-xs);
		color: var(--color-primary);
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
		background: var(--color-primary);
		color: #fff;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
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
	}
	.alert-success {
		background: var(--color-success);
		color: #fff;
	}
	.alert-error {
		background: var(--color-error);
		color: #fff;
	}
	.alert-info {
		background: var(--color-info);
		color: #fff;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--color-gray-200);
		margin: var(--spacing-md) 0;
	}
	.l2-placeholder h3 {
		margin: 0 0 var(--spacing-xs);
		font-size: var(--text-base);
		color: var(--color-gray-600);
	}
	.l2-placeholder p {
		margin: var(--spacing-xs) 0;
	}
</style>
