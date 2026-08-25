<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  P11 缺口 3:视图首次访问提示 GuidedHint。
  P11_UX_GAPS_FIX_DESIGN.md §4.4 定义。
  职责:首次进入某视图时显示引导提示,关闭后 localStorage 记录,不再重复显示。
-->

<script lang="ts">
	import { browser } from "$app/environment";
	import { toastInfo } from "$lib/stores/toast";

	interface Props {
		/** 提示 ID(唯一标识,localStorage key 的一部分) */
		hintId: string;
		/** 提示标题 */
		title: string;
		/** 提示正文 */
		body: string;
		/** 可选:CTA 按钮文案 */
		ctaLabel?: string;
		/** 可选:CTA 按钮回调 */
		ctaAction?: () => void;
		/** 可选:提示类型(影响图标和配色) */
		variant?: "info" | "tip" | "warning";
	}

	let {
		hintId,
		title,
		body,
		ctaLabel,
		ctaAction,
		variant = "tip",
	}: Props = $props();

	const STORAGE_PREFIX = "evorule-console-cloud:guided-hint:";

	// 检查是否已看过(localStorage 记录)
	let dismissed = $state(false);

	if (browser) {
		try {
			// svelte-ignore state_referenced_locally
			dismissed = localStorage.getItem(`${STORAGE_PREFIX}${hintId}`) === "seen";
		} catch {
			dismissed = false;
		}
	}

	function handleDismiss() {
		dismissed = true;
		if (browser) {
			try {
				localStorage.setItem(`${STORAGE_PREFIX}${hintId}`, "seen");
			} catch {
				// localStorage 不可用时静默失败(隐私模式等)
			}
		}
	}

	function handleCta() {
		if (ctaAction) {
			ctaAction();
		}
		handleDismiss();
	}

	function handleRemindLater() {
		handleDismiss();
		toastInfo("稍后可从「设置」重新显示引导提示", "已关闭引导");
	}

	const icon = $derived(
		variant === "warning" ? "⚠️" : variant === "info" ? "ℹ️" : "💡",
	);
</script>

{#if !dismissed}
	<div class="guided-hint hint-{variant}" role="region" aria-label={title}>
		<span class="gh-icon">{icon}</span>
		<div class="gh-body">
			<div class="gh-title">{title}</div>
			<div class="gh-text">{body}</div>
			{#if ctaLabel && ctaAction}
				<button class="gh-cta" onclick={handleCta}>{ctaLabel}</button>
			{/if}
		</div>
		<button
			class="gh-close"
			onclick={handleRemindLater}
			title="关闭(不再显示)"
			aria-label="关闭引导提示"
		>
			✕
		</button>
	</div>
{/if}

<style>
	.guided-hint {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		border: 1px solid;
	}
	.hint-tip {
		background: var(--color-info-bg, #eff6ff);
		border-color: var(--color-info, #3b82f6);
	}
	.hint-info {
		background: var(--color-gray-50, #f9fafb);
		border-color: var(--color-gray-300, #d1d5db);
	}
	.hint-warning {
		background: var(--color-warning-bg, #fef3c7);
		border-color: var(--color-warning, #f59e0b);
	}

	.gh-icon {
		font-size: 20px;
		flex-shrink: 0;
		margin-top: 2px;
	}
	.gh-body {
		flex: 1;
		min-width: 0;
	}
	.gh-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary, #1f2937);
		margin-bottom: 4px;
	}
	.gh-text {
		font-size: 13px;
		color: var(--color-text-secondary, #6b7280);
		line-height: 1.5;
	}
	.gh-cta {
		margin-top: 8px;
		padding: 4px 14px;
		background: var(--color-primary, #3b82f6);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}
	.gh-cta:hover {
		opacity: 0.9;
	}
	.gh-close {
		background: transparent;
		border: none;
		font-size: 14px;
		cursor: pointer;
		color: var(--color-text-secondary, #6b7280);
		padding: 2px 4px;
		flex-shrink: 0;
		line-height: 1;
	}
	.gh-close:hover {
		color: var(--color-text-primary, #1f2937);
	}
</style>
