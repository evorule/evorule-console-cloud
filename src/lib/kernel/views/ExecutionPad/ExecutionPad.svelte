<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!-- evorule-console 执行台 — 展现 evorule "确定性执行 + JSON-in/out" -->
<!--
  依据: docs/SPEC.md §2.1, §3
  职责:
    - session 管理(createSession / listSessions / selectSession)
    - 输入 JSON + 提交命令(submitCommand)
    - 展示执行结果(同输入同输出,可视化"确定性")
    - 命令历史(可重复上次命令,验证确定性)

  设计:
    - 从 rules store 拿当前选中的规则作为 instruction 模板
    - 用户可在 textarea 中编辑 instruction(JSON)
    - 提交后展示 CommandResult(JSON)+ 当前 version
    - "重复上次"按钮 — 重发相同 instruction,验证 version 递增(确定性演化)
-->

<script lang="ts">
	import {
		sessions,
		currentSessionId,
		commandHistory,
		isLoading,
		lastError,
		reactorVersion,
		refreshSessions,
		createSession,
		selectSession,
		closeSession,
		submitCommand
	} from '$lib/kernel/stores/session';
	import { selectedRule } from '$lib/kernel/stores/rules';
	import { useBackendOrNull } from '$lib/kernel/backend/backend-context';
	import { useAssistantOrNull } from '$lib/kernel/assistant/assistant-context';
	import JsonTree from '../StateView/JsonTree.svelte';

	// LLM 扩展槽:大众版注入 assistant + callback 后,渲染 AI 生成输入按钮
	// evorule-console 自身不注入(assistant 为 null),按钮不渲染
	let { onaiGenerateInput }: { onaiGenerateInput?: () => void } = $props();
	const assistant = useAssistantOrNull();

	const backend = useBackendOrNull();

	// 输入框内容(可由规则模板填充,也可自由编辑)
	let instructionText = $state(
		JSON.stringify(
			{
				type: 'set',
				params: { attr: '__exec__.payload.x', operation: 'set', value: 1 }
			},
			null,
			2
		)
	);
	let instructionError = $state<string | null>(null);

	// 最近一次提交的结果(用于"确定性"对比)
	let lastInstruction = $state<object | null>(null);
	let lastResult = $state<{ result: unknown; version: number | null } | null>(null);
	let repeatResult = $state<{ result: unknown; version: number | null } | null>(null);

	// 是否在做"重复"对比
	let isComparing = $state(false);

	// 拉取 sessions 列表(组件挂载时)
	$effect(() => {
		if (backend) {
			refreshSessions(backend);
		}
	});

	// 当选中的规则变化时,提示用户可以用规则填充
	$effect(() => {
		const rule = $selectedRule;
		if (rule) {
			// 仅在用户没编辑过时填充(简单策略)
			// 真实实现可加"应用规则"按钮,这里只更新 placeholder 提示
		}
	});

	function parseInstruction(): object | null {
		try {
			const parsed = JSON.parse(instructionText);
			instructionError = null;
			return parsed;
		} catch (e) {
			instructionError = (e as Error).message;
			return null;
		}
	}

	async function handleSubmit() {
		if (!backend) return;
		const instruction = parseInstruction();
		if (!instruction) return;

		lastInstruction = instruction;
		lastResult = null;
		repeatResult = null;
		isComparing = false;

		const result = await submitCommand(backend, instruction);
		if (result) {
			lastResult = { result, version: $reactorVersion };
		}
	}

	async function handleRepeat() {
		if (!backend || !lastInstruction) return;
		repeatResult = null;
		isComparing = true;

		const result = await submitCommand(backend, lastInstruction);
		if (result) {
			repeatResult = { result, version: $reactorVersion };
		}
	}

	function handleApplyRule() {
		const rule = $selectedRule;
		if (!rule) return;
		// 阶段 C.2.3: rule.content 改为懒加载可选字段
		// (RuleRecord 不含 content,需从 RuleVersionRecord 取;未加载时提示)
		if (!rule.content) {
			instructionError = `规则 "${rule.name}" 内容未加载,无法应用(阶段 D 补全 content 预取)`;
			return;
		}
		try {
			const parsed = JSON.parse(rule.content);
			// 取规则的 transform[0] 作为 instruction 模板
			if (Array.isArray(parsed.transform) && parsed.transform.length > 0) {
				instructionText = JSON.stringify(parsed.transform[0], null, 2);
				instructionError = null;
			}
		} catch (e) {
			instructionError = `规则解析失败: ${(e as Error).message}`;
		}
	}

	async function handleCreateSession() {
		if (!backend) return;
		await createSession(backend);
	}

	async function handleSelectSession(id: number) {
		if (!backend) return;
		await selectSession(backend, id);
		// 清空对比
		lastResult = null;
		repeatResult = null;
		isComparing = false;
	}

	// UV-078 W1-A2:会话删除(执行台主路径)。A2 初版只改了 ttd session-list.js
	// (时间旅行页的列表),漏了执行台这份内联列表 —— 浏览器实测 FAIL 后补齐。
	// 交互对齐 ttd 版:悬停显示 × 、二次 confirm 同文案、失败走 lastError 显式呈现。
	async function handleDeleteSession(id: number) {
		if (!backend) return;
		if (!confirm(`确认删除会话 #${id}?其审计链与 WAL 将一并移除,不可恢复。`)) return;
		const wasCurrent = $currentSessionId === id;
		await closeSession(backend, id); // store 层处理列表移除 + 当前会话自动切换/清空
		if (wasCurrent) {
			// 会话上下文已变,清空本地对比状态
			lastResult = null;
			repeatResult = null;
			isComparing = false;
		}
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString('zh-CN');
	}

	let isSameResult = $derived(
		isComparing &&
			lastResult &&
			repeatResult &&
			JSON.stringify(lastResult.result) === JSON.stringify(repeatResult.result)
	);
</script>

<div class="execution-pad">
	<header class="pad-header">
		<div class="title-group">
			<h1>执行台</h1>
			<span class="subtitle">确定性执行 + JSON-in/out — 同输入同输出</span>
		</div>
	</header>

	{#if !backend}
		<div class="empty-state">
			<span class="empty-icon">🔌</span>
			<p>backend 未注入</p>
			<p class="empty-hint">开发期需要 evorule-server 跑在 127.0.0.1:18080</p>
		</div>
	{:else}
		<div class="pad-body">
			<aside class="session-panel">
				<header class="panel-header">
					<h2>Sessions</h2>
					<button class="btn-mini btn-primary" onclick={handleCreateSession} disabled={$isLoading}>
						+ 新建
					</button>
				</header>
				{#if $sessions.length === 0}
					<div class="empty-mini">无 session</div>
				{:else}
					<ul class="session-list">
						{#each $sessions as id (id)}
							<li class="session-row">
								<button
									class="session-item"
									class:selected={$currentSessionId === id}
									onclick={() => handleSelectSession(id)}
								>
									#{id}
								</button>
								<button
									class="session-del"
									title="删除此会话"
									aria-label="删除会话 {id}"
									onclick={() => handleDeleteSession(id)}
								>
									×
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</aside>

			<main class="pad-main">
				{#if $lastError}
					<div class="error-banner" role="alert">
						<span>⚠</span>
						<span>{$lastError}</span>
					</div>
				{/if}

				{#if $currentSessionId === null}
					<div class="empty-state">
						<span class="empty-icon">📋</span>
						<p>没有当前 session</p>
						<p class="empty-hint">点击左侧 "+ 新建" 创建一个 session</p>
					</div>
				{:else}
					<section class="input-section">
						<header class="section-header">
							<h2>提交命令</h2>
							<div class="section-actions">
								{#if $selectedRule}
									<button class="btn-mini" onclick={handleApplyRule}>
										应用规则: {$selectedRule.name}
									</button>
								{/if}
								{#if assistant && onaiGenerateInput}
									<button class="btn-mini btn-ai" onclick={() => onaiGenerateInput?.()}>
										✨ AI 生成输入
									</button>
								{/if}
							</div>
						</header>

						<div class="instruction-editor">
							<div class="editor-label">Instruction (JSON)</div>
							<textarea
								bind:value={instructionText}
								spellcheck="false"
								autocomplete="off"
								placeholder="在此输入 instruction JSON..."
							></textarea>
							{#if instructionError}
								<div class="parse-error">JSON 错误: <code>{instructionError}</code></div>
							{/if}
						</div>

						<div class="submit-bar">
							<button
								class="btn btn-primary"
								onclick={handleSubmit}
								disabled={$isLoading || instructionError !== null}
							>
								{$isLoading ? '提交中...' : '提交命令'}
							</button>
							{#if lastInstruction}
								<button class="btn" onclick={handleRepeat} disabled={$isLoading}>
									重复上次(验证确定性)
								</button>
							{/if}
							<span class="version-indicator">
								current version: <strong>{$reactorVersion ?? '-'}</strong>
							</span>
						</div>
					</section>

					{#if lastResult}
						<section class="result-section">
							<header class="section-header">
								<h2>执行结果</h2>
								{#if isComparing && repeatResult}
									<span class="comparison-badge" class:same={isSameResult} class:different={!isSameResult}>
										{#if isSameResult}
											✅ 两次结果一致 — 确定性 ✓
										{:else}
											⚠ 两次结果不同 — 非确定性?
										{/if}
									</span>
								{/if}
							</header>

							<div class="result-grid" class:comparing={isComparing && repeatResult}>
								<div class="result-card">
									<header class="result-card-header">
										最近提交
										{#if lastResult.version !== null}
											<span class="version">v{lastResult.version}</span>
										{/if}
									</header>
									<div class="result-tree">
										<JsonTree data={lastResult.result} rootLabel="CommandResult" />
									</div>
								</div>

								{#if isComparing && repeatResult}
									<div class="result-card">
										<header class="result-card-header">
											重复提交
											{#if repeatResult.version !== null}
												<span class="version">v{repeatResult.version}</span>
											{/if}
										</header>
										<div class="result-tree">
											<JsonTree data={repeatResult.result} rootLabel="CommandResult" />
										</div>
									</div>
								{/if}
							</div>
						</section>
					{/if}

					{#if $commandHistory.length > 0}
						<section class="history-section">
							<header class="section-header">
								<h2>命令历史 ({$commandHistory.length})</h2>
							</header>
							<ul class="history-list">
								{#each $commandHistory.slice().reverse() as entry (entry.timestamp)}
									<li class="history-item">
										<div class="history-meta">
											<span class="history-time">{formatTime(entry.timestamp)}</span>
											{#if entry.versionBefore !== undefined}
												<span class="history-version">v{entry.versionBefore} →</span>
											{/if}
											<span class="history-accepted" class:ok={entry.result.accepted} class:fail={!entry.result.accepted}>
												{entry.result.accepted ? '✓ accepted' : '✗ rejected'}
											</span>
											{#if entry.result.version !== undefined}
												<span class="history-version">v{entry.result.version}</span>
											{/if}
										</div>
										<details>
											<summary>instruction</summary>
											<pre class="history-instruction">{JSON.stringify(entry.instruction, null, 2)}</pre>
										</details>
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				{/if}
			</main>
		</div>
	{/if}
</div>

<style>
	.execution-pad {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.pad-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-md) var(--spacing-lg);
		border-bottom: 1px solid var(--border);
		background: var(--bg-card);
	}

	.title-group h1 {
		margin: 0;
		font-size: var(--text-xl);
		color: var(--text-primary);
	}

	.subtitle {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		margin-left: var(--spacing-sm);
	}

	.pad-body {
		flex: 1;
		display: grid;
		grid-template-columns: 200px 1fr;
		overflow: hidden;
		min-height: 0;
	}

	.session-panel {
		border-right: 1px solid var(--border);
		background: var(--bg-card);
		overflow-y: auto;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 1;
	}

	.panel-header h2 {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		text-transform: uppercase;
		font-weight: var(--font-semibold);
	}

	.session-list {
		list-style: none;
		margin: 0;
		padding: var(--spacing-xs);
	}

	.session-list li {
		margin-bottom: 2px;
	}

	/* UV-078 W1-A2:会话行 = 选择按钮 + 删除按钮(悬停显示) */
	.session-row {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.session-row .session-item {
		flex: 1;
		min-width: 0;
		width: auto; /* 覆盖下方 .session-item 的 width:100%(行内与删除按钮共存) */
	}
	.session-del {
		display: none;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		line-height: 1;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font-size: 14px;
		cursor: pointer;
	}
	.session-row:hover .session-del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.session-del:hover {
		background: var(--danger-bg, #fee2e2);
		color: var(--danger, #dc2626);
	}

	.session-item {
		width: 100%;
		text-align: left;
		padding: var(--spacing-sm) var(--spacing-md);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-primary);
	}

	.session-item:hover {
		background: var(--bg-hover);
	}

	.session-item.selected {
		background: color-mix(in srgb, var(--brand) 14%, var(--bg-card));
		color: var(--brand);
		font-weight: var(--font-semibold);
	}

	.empty-mini {
		padding: var(--spacing-md);
		color: var(--text-secondary);
		font-size: var(--text-xs);
		text-align: center;
	}

	.pad-main {
		overflow-y: auto;
		padding: var(--spacing-lg);
	}

	.input-section,
	.result-section,
	.history-section {
		margin-bottom: var(--spacing-lg);
		padding: var(--spacing-md);
		background: var(--bg-card);
		border: var(--card-border);
		border-radius: var(--radius-md);
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--spacing-md);
		padding-bottom: var(--spacing-sm);
		border-bottom: 1px solid var(--border);
	}

	.section-header h2 {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-primary);
		font-weight: var(--font-semibold);
	}

	.section-actions {
		display: flex;
		gap: var(--spacing-sm);
	}

	.instruction-editor {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-xs);
	}

	.editor-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		font-weight: var(--font-semibold);
	}

	textarea {
		width: 100%;
		min-height: 180px;
		padding: var(--spacing-md);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.6;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		resize: vertical;
		color: var(--text-primary);
	}

	textarea:focus {
		outline: none;
		border-color: var(--brand);
		box-shadow: var(--focus-ring);
	}

	.parse-error {
		padding: var(--spacing-sm) var(--spacing-md);
		background: color-mix(in srgb, var(--danger) 10%, var(--bg-card));
		border: 1px solid var(--danger);
		border-radius: var(--radius-sm);
		color: var(--danger);
		font-size: var(--text-sm);
	}

	.parse-error code {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.submit-bar {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		margin-top: var(--spacing-md);
	}

	.btn {
		padding: var(--spacing-sm) var(--spacing-md);
		border: 1px solid var(--border);
		background: var(--bg-card);
		color: var(--text-primary);
		border-radius: var(--radius-md);
		cursor: pointer;
		font-size: var(--text-sm);
		font-family: var(--font-sans);
		font-weight: var(--font-medium);
		transition: background var(--transition-fast),
			border-color var(--transition-fast), color var(--transition-fast);
	}

	.btn:hover:not(:disabled) {
		background: var(--bg-hover);
		border-color: var(--text-secondary);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary {
		background: var(--brand);
		border-color: var(--brand);
		color: #ffffff;
	}

	.btn-primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--brand) 88%, #000);
		border-color: color-mix(in srgb, var(--brand) 88%, #000);
	}

	.btn-mini {
		padding: 2px 8px;
		font-size: var(--text-xs);
		border: 1px solid var(--border);
		background: var(--bg-card);
		border-radius: var(--radius-sm);
		cursor: pointer;
		color: var(--text-primary);
		font-family: var(--font-sans);
		font-weight: var(--font-medium);
		transition: background var(--transition-fast);
	}

	.btn-mini:hover:not(:disabled) {
		background: var(--bg-hover);
	}

	.btn-mini.btn-primary {
		background: var(--brand);
		border-color: var(--brand);
		color: #ffffff;
	}

	.btn-mini.btn-primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--brand) 88%, #000);
		border-color: color-mix(in srgb, var(--brand) 88%, #000);
	}

	.btn-mini.btn-ai {
		background: color-mix(in srgb, var(--brand) 10%, var(--bg-card));
		border-color: color-mix(in srgb, var(--brand) 50%, transparent);
		color: var(--brand);
	}

	.btn-mini.btn-ai:hover:not(:disabled) {
		background: color-mix(in srgb, var(--brand) 16%, var(--bg-card));
		border-color: color-mix(in srgb, var(--brand) 65%, transparent);
	}

	.version-indicator {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.version-indicator strong {
		color: var(--text-primary);
		font-family: var(--font-mono);
	}

	.result-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--spacing-md);
	}

	.result-grid.comparing {
		grid-template-columns: 1fr 1fr;
	}

	.result-card {
		border: var(--card-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--bg-card);
	}

	.result-card-header {
		padding: var(--spacing-sm) var(--spacing-md);
		background: var(--bg-primary);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
		color: var(--text-primary);
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--border);
	}

	.version {
		font-family: var(--font-mono);
		background: var(--bg-card);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		color: var(--text-primary);
	}

	.result-tree {
		padding: var(--spacing-md);
		max-height: 400px;
		overflow: auto;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-primary);
	}

	.comparison-badge {
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: var(--font-semibold);
	}

	.comparison-badge.same {
		background: color-mix(in srgb, var(--success) 14%, var(--bg-card));
		border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
		color: var(--success);
	}

	.comparison-badge.different {
		background: color-mix(in srgb, var(--danger) 14%, var(--bg-card));
		border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
		color: var(--danger);
	}

	.history-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.history-item {
		padding: var(--spacing-sm) 0;
		border-bottom: 1px solid var(--border);
	}

	.history-item:last-child {
		border-bottom: none;
	}

	.history-meta {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		font-size: var(--text-xs);
		margin-bottom: var(--spacing-xs);
	}

	.history-time {
		color: var(--text-secondary);
		font-family: var(--font-mono);
	}

	.history-version {
		color: var(--text-secondary);
		font-family: var(--font-mono);
	}

	.history-accepted.ok {
		color: var(--success);
		font-weight: var(--font-semibold);
	}

	.history-accepted.fail {
		color: var(--danger);
		font-weight: var(--font-semibold);
	}

	.history-instruction {
		margin: 0;
		padding: var(--spacing-sm);
		background: var(--bg-primary);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-x: auto;
		color: var(--text-primary);
	}

	.error-banner {
		display: flex;
		align-items: center;
		gap: var(--spacing-sm);
		padding: var(--spacing-sm) var(--spacing-md);
		background: color-mix(in srgb, var(--danger) 10%, var(--bg-card));
		border: 1px solid var(--danger);
		border-radius: var(--radius-md);
		color: var(--danger);
		margin-bottom: var(--spacing-md);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 300px;
		color: var(--text-secondary);
		text-align: center;
	}

	.empty-icon {
		font-size: 48px;
		margin-bottom: var(--spacing-md);
	}

	.empty-hint {
		font-size: var(--text-xs);
		margin-top: var(--spacing-xs);
	}

	@media (max-width: 768px) {
		.pad-body {
			grid-template-columns: 1fr;
		}
		.result-grid.comparing {
			grid-template-columns: 1fr;
		}
	}
</style>
