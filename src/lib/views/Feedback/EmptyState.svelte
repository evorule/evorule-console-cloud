<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一空态组件
    - 4 类:no_data / no_permission / load_failed / not_configured
    - 每类有标准图标 + 标题 + 描述 + CTA
    - 支持自定义 noun / cta 文案
-->

<script lang="ts">
  import type { EmptyStateType } from "$lib/stores/empty-state-types";

  interface Props {
    type: EmptyStateType;
    noun: string;
    ctaLabel?: string;
    ctaAction?: () => void;
    description?: string;
  }

  let { type, noun, ctaLabel, ctaAction, description }: Props = $props();

  const config = $derived(
    {
      no_data: {
        icon: "📭",
        title: `还没有${noun}`,
        desc: description ?? `点击下方按钮,创建你的第一条${noun}`,
      },
      no_permission: {
        icon: "🔒",
        title: "无权限",
        desc: description ?? `你没有查看${noun}的权限,请联系管理员`,
      },
      load_failed: {
        icon: "⚠️",
        title: `${noun}加载失败`,
        desc: description ?? "请检查网络或后端服务,然后重试",
      },
      not_configured: {
        icon: "⚙️",
        title: `${noun}未配置`,
        desc: description ?? `请先配置${noun},才能使用此功能`,
      },
    }[type],
  );
</script>

<div class="empty-state">
  <div class="empty-icon">{config.icon}</div>
  <h3 class="empty-title">{config.title}</h3>
  <p class="empty-desc">{config.desc}</p>
  {#if ctaLabel && ctaAction}
    <button class="empty-cta" onclick={ctaAction}>{ctaLabel}</button>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    text-align: center;
  }
  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.6;
  }
  .empty-title {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 8px 0;
  }
  .empty-desc {
    color: var(--color-text-secondary, #6b7280);
    font-size: 14px;
    margin: 0 0 16px 0;
    max-width: 360px;
  }
  .empty-cta {
    padding: 8px 20px;
    background: var(--color-primary, #3b82f6);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }
  .empty-cta:hover {
    opacity: 0.9;
  }
</style>
