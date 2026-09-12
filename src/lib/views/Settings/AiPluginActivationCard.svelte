<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console-cloud — ai-plugin 激活状态卡(UV-177) -->
<!--
  职责:
    - 消费 GET /api/health plugins 节,三态呈现 server 通道 AI 激活状态
      (未启用→三步引导含可复制片段 / 已启用未达→拉起进程指引 / 就绪)
    - 仅在 LlmSettings 选中「服务端执行」通道时渲染(父级控制)
    - 明示"插件清单为启动期读盘注册,改后需重启 server"(不承诺热切换)
    - 分发版已内置 ai-plugin 分发件(UV-178 批次A):片段区分分发版/源码版两形态

  边界:
    - 纯展示层:只读 /api/health,不提供任何写配置/收凭据表单
    - 状态判定逻辑在 assistant/ai-plugin-status.ts(纯函数,单测锁定)
-->

<script lang="ts">
	import { netConfig } from '$lib/config/net-config';
	import { DEFAULT_LOCAL_BASE_URL } from '$lib/backend/types';
	import {
		fetchAiPluginStatus,
		type AiPluginStatus
	} from '$lib/assistant/ai-plugin-status';
	import { t } from '$lib/locale';

	let status = $state<AiPluginStatus | null>(null); // null=检测中
	let copiedKey = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	// 与 Settings 联网页同一套基址解析(online=远程 URL,offline=本机缺省)
	function serverBaseUrl(): string {
		return $netConfig.mode === 'online' ? $netConfig.remoteBaseUrl : DEFAULT_LOCAL_BASE_URL;
	}

	async function refresh() {
		status = null;
		status = await fetchAiPluginStatus(serverBaseUrl(), $netConfig.authToken || undefined);
	}

	// 挂载即检测;netConfig 变更(切模式/改 URL)自动重检
	$effect(() => {
		void $netConfig.mode;
		void $netConfig.remoteBaseUrl;
		void refresh();
	});

	function copy(key: string, text: string) {
		void navigator.clipboard
			.writeText(text)
			.then(() => {
				copiedKey = key;
				if (copyTimer) clearTimeout(copyTimer);
				copyTimer = setTimeout(() => (copiedKey = null), 2000);
			})
			.catch(() => {
				// 剪贴板不可用(非安全上下文等):静默,用户可手动选择文本
			});
	}

	// ---- 可复制片段(与 evorule-server 分发包/源码仓两种布局逐字对齐) ----
	const MANIFEST_SNIPPET =
		'"ai-plugin": { "enabled": true, "manifest": "plugins/ai-plugin/plugin.json" }';
	const CFG_SNIPPET = 'cp plugins/ai-plugin/config.example.json plugins/ai-plugin/ai-plugin.json';
	// UV-178 批次B:凭据环境变量注入(推荐,不落盘;文件 llm_api_key 为兼容形态)
	const ENV_SNIPPET = [
		'# Windows (PowerShell,当前会话)',
		'$env:EVORULE_AI_PLUGIN_LLM_API_KEY="sk-..."',
		'# Windows (持久化到用户环境,新终端生效)',
		'setx EVORULE_AI_PLUGIN_LLM_API_KEY "sk-..."',
		'# Linux / macOS',
		'export EVORULE_AI_PLUGIN_LLM_API_KEY="sk-..."'
	].join('\n');
	const RUN_SNIPPET = [
		'# 分发版(包内已内置 exe;在 evorule 所在目录执行)',
		'cd plugins\\ai-plugin',
		'.\\evorule-ai-plugin.exe --config ai-plugin.json',
		'# 源码版:先在 plugins/ai-plugin 目录 cargo build --release,',
		'#   再运行 .\\target\\release\\evorule-ai-plugin.exe --config ai-plugin.json'
	].join('\n');
</script>

<section class="ai-activation" aria-label={t('llm.aiPlugin.title')}>
	<header class="aa-header">
		<h3>{t('llm.aiPlugin.title')}</h3>
		<button type="button" class="aa-refresh" onclick={() => void refresh()}>
			{t('llm.aiPlugin.refresh')}
		</button>
	</header>

	{#if status === null}
		<p class="aa-state checking">{t('llm.aiPlugin.checking')}</p>
	{:else if status.state === 'ready'}
		<div class="aa-state ready">
			<p class="aa-title">{t('llm.aiPlugin.state.ready.title')}</p>
			<p class="aa-desc">{t('llm.aiPlugin.state.ready.desc')}</p>
		</div>
	{:else if status.state === 'unreachable'}
		<div class="aa-state warn">
			<p class="aa-title">{t('llm.aiPlugin.state.unreachable.title')}</p>
			<p class="aa-desc">{t('llm.aiPlugin.state.unreachable.desc')}</p>
			<pre class="aa-snippet"><code>{RUN_SNIPPET}</code></pre>
			<button type="button" class="aa-copy" onclick={() => copy('run', RUN_SNIPPET)}>
				{copiedKey === 'run' ? t('llm.aiPlugin.copied') : t('llm.aiPlugin.copyBtn')}
			</button>
			{#if status.lastError}
				<p class="aa-error">{t('llm.aiPlugin.lastError', { error: status.lastError })}</p>
			{/if}
			<p class="aa-note">{t('llm.aiPlugin.distNote')}</p>
		</div>
	{:else if status.state === 'no_probe'}
		<div class="aa-state warn">
			<p class="aa-title">{t('llm.aiPlugin.state.noProbe.title')}</p>
			<p class="aa-desc">{t('llm.aiPlugin.state.noProbe.desc')}</p>
		</div>
	{:else if status.state === 'disabled'}
		<div class="aa-state disabled">
			<p class="aa-title">{t('llm.aiPlugin.state.disabled.title')}</p>
			<p class="aa-desc">{t('llm.aiPlugin.state.disabled.desc')}</p>

			<div class="aa-step">
				<p class="aa-step-title">{t('llm.aiPlugin.step1.title')}</p>
				<p class="aa-desc">{t('llm.aiPlugin.step1.desc')}</p>
				<pre class="aa-snippet"><code>{MANIFEST_SNIPPET}</code></pre>
				<button type="button" class="aa-copy" onclick={() => copy('manifest', MANIFEST_SNIPPET)}>
					{copiedKey === 'manifest' ? t('llm.aiPlugin.copied') : t('llm.aiPlugin.copyBtn')}
				</button>
			</div>

			<div class="aa-step">
				<p class="aa-step-title">{t('llm.aiPlugin.step2.title')}</p>
				<p class="aa-desc">{t('llm.aiPlugin.step2.desc')}</p>
				<pre class="aa-snippet"><code>{ENV_SNIPPET}</code></pre>
				<button type="button" class="aa-copy" onclick={() => copy('env', ENV_SNIPPET)}>
					{copiedKey === 'env' ? t('llm.aiPlugin.copied') : t('llm.aiPlugin.copyBtn')}
				</button>
				<pre class="aa-snippet"><code>{CFG_SNIPPET}</code></pre>
				<button type="button" class="aa-copy" onclick={() => copy('cfg', CFG_SNIPPET)}>
					{copiedKey === 'cfg' ? t('llm.aiPlugin.copied') : t('llm.aiPlugin.copyBtn')}
				</button>
			</div>

			<div class="aa-step">
				<p class="aa-step-title">{t('llm.aiPlugin.step3.title')}</p>
				<p class="aa-desc">{t('llm.aiPlugin.step3.desc')}</p>
				<pre class="aa-snippet"><code>{RUN_SNIPPET}</code></pre>
				<button type="button" class="aa-copy" onclick={() => copy('run', RUN_SNIPPET)}>
					{copiedKey === 'run' ? t('llm.aiPlugin.copied') : t('llm.aiPlugin.copyBtn')}
				</button>
			</div>

			<p class="aa-note">{t('llm.aiPlugin.distNote')}</p>
		</div>
	{:else}
		<div class="aa-state unknown">
			<p class="aa-title">{t('llm.aiPlugin.state.unknown.title')}</p>
			<p class="aa-desc">{t('llm.aiPlugin.state.unknown.desc')}</p>
		</div>
	{/if}
</section>

<style>
	.ai-activation {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--spacing-md);
		background: var(--bg-hover);
	}
	.aa-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-sm);
		margin-bottom: var(--spacing-sm);
	}
	.aa-header h3 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-primary);
	}
	.aa-refresh {
		padding: 2px var(--spacing-sm);
		background: var(--border);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.aa-refresh:hover {
		background: var(--bg-page);
	}
	.aa-title {
		margin: 0 0 var(--spacing-xs);
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
	.aa-desc {
		margin: 0 0 var(--spacing-xs);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.aa-state.checking {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.aa-state.ready {
		border-left: 3px solid var(--success);
		padding-left: var(--spacing-sm);
	}
	.aa-state.warn {
		border-left: 3px solid var(--warning, #d97706);
		padding-left: var(--spacing-sm);
	}
	.aa-state.disabled {
		border-left: 3px solid var(--danger);
		padding-left: var(--spacing-sm);
	}
	.aa-state.unknown {
		border-left: 3px solid var(--border);
		padding-left: var(--spacing-sm);
	}
	.aa-step {
		margin: var(--spacing-sm) 0;
		padding: var(--spacing-sm);
		background: var(--bg-page);
		border-radius: var(--radius-sm);
	}
	.aa-step-title {
		margin: 0 0 var(--spacing-xs);
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
	.aa-snippet {
		margin: 0 0 var(--spacing-xs);
		padding: var(--spacing-sm);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--text-primary);
		white-space: pre;
	}
	.aa-copy {
		padding: 2px var(--spacing-sm);
		background: var(--border);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--text-xs);
	}
	.aa-copy:hover {
		background: var(--bg-page);
	}
	.aa-error {
		margin: var(--spacing-xs) 0 0;
		font-size: var(--text-xs);
		color: var(--danger);
		word-break: break-all;
	}
	.aa-note {
		margin: var(--spacing-sm) 0 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		font-style: italic;
	}
</style>
