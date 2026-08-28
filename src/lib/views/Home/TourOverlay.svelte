<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PR3 · 首启交互式引导 Tour(零依赖 spotlight)。
  - 读取 onboardingStore 的 tour.active / tour.step,渲染当前步骤卡片
  - 若步骤定义了 target(对应页面元素的 data-tour 选择器),用 box-shadow 打"聚光灯"高亮
  - 找不到目标时卡片居中显示(不强制跳转路由,避免触发路由守卫弹回)
  - 控制:下一步 / 上一步 / 跳过 / 完成;完成→endTour,跳过→skipTour
  依赖:src/lib/stores/onboarding.ts
-->

<script lang="ts">
	import { browser } from "$app/environment";
	import {
		onboardingStore,
		TOUR_STEPS,
		nextTourStep,
		prevTourStep,
		skipTour,
		endTour,
	} from "$lib/stores/onboarding";

	const active = $derived($onboardingStore.tour.active);
	const stepIndex = $derived($onboardingStore.tour.step);
	const step = $derived(TOUR_STEPS[Math.min(stepIndex, TOUR_STEPS.length - 1)]);
	const isLast = $derived(stepIndex >= TOUR_STEPS.length - 1);

	// 目标元素包围盒(用于聚光灯 + 卡片定位)
	let targetRect = $state<{
		top: number;
		left: number;
		width: number;
		height: number;
	} | null>(null);
	// 卡片定位 style
	let cardStyle = $state("left:50%;top:50%;transform:translate(-50%,-50%)");

	function reposition() {
		if (!browser) return;
		if (!step?.target) {
			targetRect = null;
			return;
		}
		const el = document.querySelector(step.target);
		if (!el) {
			targetRect = null;
			return;
		}
		const r = el.getBoundingClientRect();
		targetRect = { top: r.top, left: r.left, width: r.width, height: r.height };
	}

	// 步骤变化 → 等两帧让 DOM 更新后再定位(覆盖 SPA 渲染 / 布局抖动)
	$effect(() => {
		// 显式依赖 stepIndex,使其变化时重跑
		stepIndex;
		if (!browser) return;
		requestAnimationFrame(() => requestAnimationFrame(reposition));
		const t = setTimeout(reposition, 400);
		return () => clearTimeout(t);
	});

	// 目标变化 → 重新计算卡片位置(目标存在则贴其下方,否则居中)
	$effect(() => {
		if (!browser) return;
		const rect = targetRect;
		if (!rect) {
			cardStyle = "left:50%;top:50%;transform:translate(-50%,-50%)";
			return;
		}
		const gap = 12;
		const cardW = 340;
		const cardH = 210;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		let top = rect.top + rect.height + gap;
		if (top + cardH > vh - gap) {
			top = Math.max(gap, rect.top - cardH - gap);
		}
		let left = Math.min(Math.max(gap, rect.left), vw - cardW - gap);
		cardStyle = `top:${top}px;left:${left}px;max-width:${cardW}px`;
	});
</script>

{#if active}
	<div class="tour-overlay" role="dialog" aria-modal="true" aria-label="新手引导">
		{#if targetRect}
			<div
				class="tour-spot"
				style={`top:${targetRect.top}px;left:${targetRect.left}px;width:${targetRect.width}px;height:${targetRect.height}px`}
			></div>
		{/if}
		<div class="tour-card" style={cardStyle}>
			<div class="tour-count">{stepIndex + 1} / {TOUR_STEPS.length}</div>
			<h3 class="tour-title">{step?.title}</h3>
			<p class="tour-desc">{step?.description}</p>
			<div class="tour-actions">
				<button class="tour-skip" onclick={skipTour}>跳过引导</button>
				<div class="tour-nav">
					{#if stepIndex > 0}
						<button class="tour-btn ghost" onclick={prevTourStep}>上一步</button>
					{/if}
					{#if isLast}
						<button class="tour-btn primary" onclick={endTour}>完成 🎉</button>
					{:else}
						<button class="tour-btn primary" onclick={nextTourStep}>下一步 →</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.tour-overlay {
		position: fixed;
		inset: 0;
		z-index: 1200;
		pointer-events: none;
	}
	/* 聚光灯:透明盒子 + 超大 box-shadow 把四周压暗 */
	.tour-spot {
		position: fixed;
		border-radius: 8px;
		box-shadow: 0 0 0 9999px rgba(2, 6, 23, 0.72);
		border: 2px solid var(--brand);
		pointer-events: none;
		transition:
			top 0.2s ease,
			left 0.2s ease,
			width 0.2s ease,
			height 0.2s ease;
	}
	.tour-card {
		position: fixed;
		pointer-events: auto;
		background: var(--bg-card);
		border: 1px solid var(--border-strong);
		border-radius: var(--r-lg);
		padding: 16px 18px;
		box-shadow: var(--sh-modal);
	}
	.tour-count {
		font-size: 11px;
		font-weight: 600;
		color: var(--brand);
		letter-spacing: 0.5px;
		margin-bottom: 6px;
	}
	.tour-title {
		margin: 0 0 8px;
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.tour-desc {
		margin: 0 0 14px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-secondary);
	}
	.tour-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tour-skip {
		background: transparent;
		border: none;
		color: var(--text-muted);
		font-size: 12px;
		cursor: pointer;
		padding: 4px 2px;
	}
	.tour-skip:hover {
		color: var(--text-secondary);
		text-decoration: underline;
	}
	.tour-nav {
		display: flex;
		gap: 8px;
	}
	.tour-btn {
		height: 32px;
		padding: 0 14px;
		border-radius: var(--r-sm);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.tour-btn.primary {
		background: var(--brand);
		color: #fff;
	}
	.tour-btn.primary:hover {
		background: var(--brand-hover);
	}
	.tour-btn.ghost {
		background: transparent;
		color: var(--text-secondary);
		border-color: var(--border);
	}
	.tour-btn.ghost:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
