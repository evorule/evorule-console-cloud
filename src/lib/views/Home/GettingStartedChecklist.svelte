<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PR3 · 常驻「上手清单」(Getting Started)。
  - 读取 onboardingStore.checklist(6 步),可逐项勾选 / 跳转到对应路由
  - 进度实时显示(done/total)
  - 设计:对齐 app.css 新 token,Zero 依赖
  依赖:src/lib/stores/onboarding.ts, $app/navigation
-->

<script lang="ts">
	import { goto } from "$app/navigation";
	import {
		onboardingStore,
		toggleChecklistItem,
		type ChecklistItem,
	} from "$lib/stores/onboarding";

	const items = $derived($onboardingStore.checklist);
	const progress = $derived({
		done: items.filter((i) => i.done).length,
		total: items.length,
	});
	// 完成度百分比(用于进度条)
	const pct = $derived(progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0);

	function go(item: ChecklistItem) {
		goto(item.route);
	}
</script>

<div class="gsc">
	<div class="gsc-head">
		<h3 class="gsc-title">🚀 上手清单</h3>
		<span class="gsc-progress" class:all-done={progress.done === progress.total}>
			{progress.done}/{progress.total}{progress.done === progress.total ? " · 全部完成 🎉" : ""}
		</span>
	</div>
	<div class="gsc-bar">
		<div class="gsc-bar-fill" style={`width:${pct}%`}></div>
	</div>

	<ul class="gsc-list">
		{#each items as item (item.id)}
			<li class="gsc-item" class:done={item.done}>
				<button
					class="gsc-check"
					class:checked={item.done}
					onclick={() => toggleChecklistItem(item.id)}
					aria-pressed={item.done}
					aria-label={item.done ? "标记为未完成" : "标记为完成"}
				>
					{#if item.done}✓{/if}
				</button>
				<div class="gsc-body">
					<div class="gsc-name">{item.title}</div>
					<div class="gsc-desc">{item.description}</div>
				</div>
				<button class="gsc-go" onclick={() => go(item)}>去做 →</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.gsc {
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		padding: 16px 18px;
		box-shadow: var(--sh-card);
	}
	.gsc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	.gsc-title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.gsc-progress {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.gsc-progress.all-done {
		color: var(--success);
	}
	.gsc-bar {
		height: 6px;
		background: var(--bg-hover);
		border-radius: var(--r-full);
		overflow: hidden;
		margin-bottom: 12px;
	}
	.gsc-bar-fill {
		height: 100%;
		background: var(--brand);
		border-radius: var(--r-full);
		transition: width var(--tr-normal);
	}
	.gsc-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.gsc-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px;
		border-radius: var(--r-md);
		transition: background var(--tr-fast);
	}
	.gsc-item:hover {
		background: var(--bg-hover);
	}
	.gsc-item.done .gsc-name {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	.gsc-check {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border-radius: var(--r-sm);
		border: 1.5px solid var(--border-strong);
		background: transparent;
		color: #fff;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all var(--tr-fast);
	}
	.gsc-check.checked {
		background: var(--success);
		border-color: var(--success);
	}
	.gsc-body {
		flex: 1;
		min-width: 0;
	}
	.gsc-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-primary);
	}
	.gsc-desc {
		font-size: 12px;
		color: var(--text-secondary);
		line-height: 1.4;
		margin-top: 2px;
	}
	.gsc-go {
		flex-shrink: 0;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--brand);
		font-size: 12px;
		font-weight: 500;
		padding: 5px 10px;
		border-radius: var(--r-sm);
		cursor: pointer;
		transition: all var(--tr-fast);
	}
	.gsc-go:hover {
		background: var(--bg-active);
		border-color: var(--brand);
	}
</style>
