<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PR5 · 命令面板(Command Palette,零依赖,不引入 fuse.js)。
  - 顶栏搜索框点击 / 全局 Ctrl+K 打开
  - 原生子串匹配 + 位置评分排序(无第三方搜索库)
  - 键盘:↑/↓ 移动,Enter 执行,Esc 关闭
  - 命令组:导航 / 引导 / 任务流 / 操作
  依赖:goto、$lib/data/task-flows、startTaskFlow、$lib/config/net-config、
        onboarding store;onOpenGlossary/onOpenSettings 由 +layout 注入
-->

<script lang="ts">
	import { goto } from "$app/navigation";
	import { taskFlowsDef } from "$lib/data/task-flows";
	import { startTaskFlow } from "$lib/stores/task-flow";
	import { toggleNetMode } from "$lib/config/net-config";
	import { resetBanner, resetTour, startTour } from "$lib/stores/onboarding";

	let {
		onclose,
		onOpenGlossary,
		onOpenSettings,
	}: {
		onclose: () => void;
		onOpenGlossary?: () => void;
		onOpenSettings?: () => void;
	} = $props();

	interface Command {
		id: string;
		title: string;
		group: string;
		hint?: string;
		keywords?: string;
		run: () => void;
	}

	function buildCommands(): Command[] {
		const nav: Command[] = [
			{ id: "nav-workbench", title: "工作台", group: "导航", hint: "极简 dashboard,随时可进", keywords: "workbench dashboard 首页", run: () => goto("/workbench") },
			{ id: "nav-help", title: "帮助中心", group: "导航", hint: "5 分钟上手 + 详细指南", keywords: "help 帮助 文档", run: () => goto("/help") },
			{ id: "nav-governance", title: "治理中心", group: "导航", hint: "数据集 / 规则 / 5 态生命周期", keywords: "governance 规则 治理", run: () => goto("/governance") },
			{ id: "nav-audit", title: "审计记录", group: "导航", hint: "BLAKE3 审计链 + 因果回溯", keywords: "audit 审计", run: () => goto("/audit") },
			{ id: "nav-publish", title: "发布队列", group: "导航", hint: "发布审批 / 紧急回滚", keywords: "publish 发布 队列", run: () => goto("/publish-queue") },
			{ id: "nav-version", title: "版本历史", group: "导航", hint: "生产规则集版本时间线", keywords: "version 版本 历史", run: () => goto("/version-history") },
			{ id: "nav-export", title: "导出中心", group: "导航", hint: "结果导出 × 4 种格式", keywords: "export 导出", run: () => goto("/export") },
			{ id: "nav-login", title: "登录 / 账号", group: "导航", hint: "登录以解锁授权能力", keywords: "login 登录 账号", run: () => goto("/login") },
		];

		const guide: Command[] = [
			{ id: "guide-glossary", title: "打开术语表", group: "引导", hint: "evorule 黑话速查", keywords: "glossary 术语 帮助", run: () => onOpenGlossary?.() },
			{ id: "guide-settings", title: "打开设置", group: "引导", hint: "联网 / LLM / 新手引导", keywords: "settings 设置 配置", run: () => onOpenSettings?.() },
			{ id: "guide-tour", title: "重新播放新手引导 Tour", group: "引导", hint: "5 步交互引导", keywords: "tour 引导 新手", run: () => { resetTour(); startTour(); } },
			{ id: "guide-banner", title: "重新显示引导横幅", group: "引导", hint: "工作台顶部欢迎横幅", keywords: "banner 横幅 引导", run: () => resetBanner() },
		];

		const flows: Command[] = taskFlowsDef.map((f) => ({
			id: `flow-${f.id}`,
			title: `启动任务流:${f.name}`,
			group: "任务流",
			hint: f.description ?? "",
			keywords: `taskflow 任务流 ${f.id} ${f.name}`,
			run: () => startTaskFlow(f.id, false),
		}));

		const ops: Command[] = [
			{ id: "op-netmode", title: "切换 联网 / 离线 模式", group: "操作", hint: "本地 loopback 与远程 server 切换", keywords: "net mode 联网 离线", run: () => toggleNetMode() },
		];

		return [...nav, ...guide, ...flows, ...ops];
	}

	const allCommands = buildCommands();

	let query = $state("");
	let activeIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();

	// 子串匹配 + 最早出现位置评分(越小越靠前);空查询返回全量(保序)
	function score(c: Command, q: string): number {
		const hay = `${c.title} ${c.keywords ?? ""} ${c.group}`.toLowerCase();
		return hay.indexOf(q);
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return allCommands;
		return allCommands
			.filter((c) => score(c, q) >= 0)
			.sort((a, b) => score(a, q) - score(b, q));
	});

	// 查询变化时把高亮复位到第一项
	$effect(() => {
		query;
		activeIndex = 0;
	});

	// 打开即聚焦搜索框
	$effect(() => {
		inputEl?.focus();
	});

	function runCmd(c: Command | undefined) {
		if (!c) return;
		c.run();
		onclose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			onclose();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
		} else if (e.key === "Enter") {
			e.preventDefault();
			runCmd(filtered[activeIndex]);
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	// 渲染时插入分组标题:当前项与上一项目组不同则显示组头
	function showGroupHeader(i: number): boolean {
		if (i === 0) return true;
		return filtered[i].group !== filtered[i - 1].group;
	}
</script>

<svelte:window onkeydown={handleKey} />

<div class="palette-backdrop" role="presentation" onclick={handleBackdrop}>
	<div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
		<div class="palette-search">
			<svg class="palette-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
			<input
				bind:this={inputEl}
				bind:value={query}
				type="text"
				placeholder="搜索页面、引导、任务流、操作…"
				aria-label="搜索命令"
				onkeydown={handleKey}
			/>
			<span class="palette-esc">Esc</span>
		</div>

		<div class="palette-list">
			{#if filtered.length === 0}
				<div class="palette-empty">没有匹配的命令</div>
			{:else}
				{#each filtered as c, i (c.id)}
					{#if showGroupHeader(i)}
						<div class="palette-group">{c.group}</div>
					{/if}
					<button
						class="palette-item"
						class:active={i === activeIndex}
						onmouseenter={() => (activeIndex = i)}
						onclick={() => runCmd(c)}
					>
						<span class="palette-item-title">{c.title}</span>
						{#if c.hint}
							<span class="palette-item-hint">{c.hint}</span>
						{/if}
						{#if i === activeIndex}
							<span class="palette-item-enter">↵</span>
						{/if}
					</button>
				{/each}
			{/if}
		</div>

		<div class="palette-footer">
			<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
			<span><kbd>↵</kbd> 执行</span>
			<span><kbd>Esc</kbd> 关闭</span>
			<span class="palette-footer-tip">Ctrl/⌘ + K 随时唤起</span>
		</div>
	</div>
</div>

<style>
	.palette-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1350;
		background: rgba(2, 6, 23, 0.55);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 12vh;
	}
	.palette {
		width: 100%;
		max-width: 560px;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xl);
		box-shadow: var(--sh-modal);
		overflow: hidden;
	}
	.palette-search {
		position: relative;
		display: flex;
		align-items: center;
		padding: 0 var(--sp-md);
		border-bottom: 1px solid var(--border);
	}
	.palette-search-icon {
		width: 18px;
		height: 18px;
		color: var(--text-muted);
		flex-shrink: 0;
	}
	.palette-search input {
		flex: 1;
		height: 48px;
		padding: 0 var(--sp-sm);
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: var(--fs-base);
		outline: none;
	}
	.palette-search input::placeholder {
		color: var(--text-muted);
	}
	.palette-esc {
		font-size: 11px;
		color: var(--text-muted);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 2px 6px;
		flex-shrink: 0;
	}
	.palette-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: var(--sp-xs);
	}
	.palette-empty {
		text-align: center;
		color: var(--text-secondary);
		padding: var(--sp-2xl) 0;
		font-size: var(--fs-sm);
	}
	.palette-group {
		font-size: 11px;
		font-weight: var(--fw-sb);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted);
		padding: var(--sp-sm) var(--sp-sm) var(--sp-xxs);
	}
	.palette-item {
		display: flex;
		align-items: center;
		gap: var(--sp-sm);
		width: 100%;
		text-align: left;
		padding: 9px var(--sp-sm);
		border-radius: var(--r-sm);
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--text-primary);
		font-size: var(--fs-sm);
	}
	.palette-item.active {
		background: var(--bg-active);
	}
	.palette-item-title {
		flex-shrink: 0;
		font-weight: var(--fw-med);
	}
	.palette-item-hint {
		flex: 1;
		min-width: 0;
		color: var(--text-muted);
		font-size: var(--fs-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.palette-item-enter {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--brand);
	}
	.palette-footer {
		display: flex;
		align-items: center;
		gap: var(--sp-md);
		padding: var(--sp-sm) var(--sp-md);
		border-top: 1px solid var(--border);
		font-size: 11px;
		color: var(--text-muted);
	}
	.palette-footer kbd {
		font-family: var(--font-mono);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 1px 5px;
		margin-right: 3px;
	}
	.palette-footer-tip {
		margin-left: auto;
	}
</style>
