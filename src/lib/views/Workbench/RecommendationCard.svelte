<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  PR8 · 角色视图默认推荐卡片。
  展示「为你推荐」的下一步视图(基于 recommendation.ts 的轻量推断),
  支持「去看看」跳转、「换成 ▾」手动覆盖、「不再提示」关闭。
-->

<script lang="ts">
	import { goto } from "$app/navigation";
	import { isLoggedIn, can } from "$lib/stores/auth";
	import { isEmptyDb } from "$lib/stores/db";
	import { rules } from "$lib/kernel";
	import { viewModeStore } from "$lib/stores/view-mode";
	import {
		resolveRecommendation,
		dismissRecommendation,
		overrideRecommendation,
		VIEW_LABELS,
		type RecommendedView,
	} from "$lib/stores/recommendation";

	// 最终推荐(结合上下文 + 用户覆盖/关闭)
	const rec = $derived.by(() =>
		resolveRecommendation({
			loggedIn: $isLoggedIn,
			isEmptyDb: $isEmptyDb,
			ruleCount: $rules.length,
			canAudit: can("view_audit_chain"),
			isDecisionMaker: $viewModeStore === "decision_maker",
		}),
	);

	const views = Object.keys(VIEW_LABELS) as RecommendedView[];

	function go() {
		if (rec) goto(rec.route);
	}
	function changeTo(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value as RecommendedView;
		overrideRecommendation(v);
	}
	function dismiss() {
		dismissRecommendation();
	}
</script>

{#if rec}
	<div class="rec-card" role="region" aria-label="为你推荐">
		<span class="rec-spark" aria-hidden="true">✨</span>
		<div class="rec-body">
			<div class="rec-title">为你推荐 · {rec.title}</div>
			<div class="rec-reason">{rec.reason}</div>
			<div class="rec-actions">
				<button class="rec-go" onclick={go}>去看看 →</button>
				<label class="rec-change">
					换成
					<select
						class="rec-select"
						onchange={changeTo}
						aria-label="更换推荐视图"
					>
						{#each views as v (v)}
							<option value={v} selected={v === rec.view}>
								{VIEW_LABELS[v]}
							</option>
						{/each}
					</select>
				</label>
				<button class="rec-dismiss" onclick={dismiss} title="不再提示">
					不再提示
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.rec-card {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		border-radius: var(--r-lg);
		background: var(--info-bg);
		border: 1px solid var(--brand);
		margin-bottom: 16px;
	}
	.rec-spark {
		font-size: 20px;
		flex-shrink: 0;
		margin-top: 1px;
	}
	.rec-body {
		flex: 1;
		min-width: 0;
	}
	.rec-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 2px;
	}
	.rec-reason {
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.5;
		margin-bottom: 8px;
	}
	.rec-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.rec-go {
		background: var(--brand);
		color: #fff;
		border: none;
		border-radius: var(--r-sm);
		padding: 5px 14px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
	}
	.rec-go:hover {
		opacity: 0.92;
	}
	.rec-change {
		font-size: 12px;
		color: var(--text-secondary);
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.rec-select {
		background: var(--bg-card);
		color: var(--text-primary);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 3px 6px;
		font-size: 12px;
	}
	.rec-dismiss {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 12px;
		text-decoration: underline;
	}
	.rec-dismiss:hover {
		color: var(--text-primary);
	}
</style>
