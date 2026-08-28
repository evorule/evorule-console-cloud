<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:统一空态组件(设计系统 v3 深色 token)
    - 4 类:no_data / no_permission / load_failed / not_configured
    - 每类有标准图标 + 标题 + 描述 + 可选「为什么空」补充 + 主/次 CTA
    - 支持自定义 noun / description / detail / cta 文案
    - 全站统一空状态出口,禁止各视图另造空态文案
-->

<script lang="ts">
  import type { EmptyStateType } from "$lib/stores/empty-state-types";

  interface Props {
    type: EmptyStateType;
    /** 空态主体名词,如 "规则" / "数据集" / "生产环境" */
    noun: string;
    /** 主 CTA 文案(与 ctaAction 同时出现) */
    ctaLabel?: string;
    /** 主 CTA 动作 */
    ctaAction?: () => void;
    /** 次 CTA 文案(ghost 样式,如「查看文档」「了解更多」) */
    secondaryLabel?: string;
    /** 次 CTA 动作 */
    secondaryAction?: () => void;
    /** 覆盖默认描述 */
    description?: string;
    /** 补充说明:解释「为什么空」(如后端未启动 / 库为空) */
    detail?: string;
  }

  let {
    type,
    noun,
    ctaLabel,
    ctaAction,
    secondaryLabel,
    secondaryAction,
    description,
    detail,
  }: Props = $props();

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

<div class="empty-state" role="status" aria-live="polite">
  <div class="empty-icon">{config.icon}</div>
  <h3 class="empty-title">{config.title}</h3>
  <p class="empty-desc">{config.desc}</p>
  {#if detail}
    <p class="empty-detail">{detail}</p>
  {/if}
  {#if ctaLabel && ctaAction}
    <div class="empty-actions">
      <button class="empty-cta" onclick={ctaAction}>{ctaLabel}</button>
      {#if secondaryLabel && secondaryAction}
        <button class="empty-cta-secondary" onclick={secondaryAction}>
          {secondaryLabel}
        </button>
      {/if}
    </div>
  {:else if secondaryLabel && secondaryAction}
    <div class="empty-actions">
      <button class="empty-cta-secondary" onclick={secondaryAction}>
        {secondaryLabel}
      </button>
    </div>
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
    background: var(--bg-card, #0d1117);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
    border-radius: var(--r-lg, 8px);
  }
  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.7;
  }
  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary, #f1f5f9);
    margin: 0 0 8px 0;
  }
  .empty-desc {
    color: var(--text-secondary, #94a3b8);
    font-size: 14px;
    margin: 0 0 8px 0;
    max-width: 420px;
    line-height: 1.5;
  }
  .empty-detail {
    color: var(--text-secondary, #94a3b8);
    font-size: 12px;
    margin: 0 0 16px 0;
    max-width: 420px;
    line-height: 1.5;
    opacity: 0.85;
    padding: 8px 12px;
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
    border-radius: var(--r-sm, 4px);
  }
  .empty-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .empty-cta {
    padding: 8px 20px;
    background: var(--brand, #1d63ed);
    color: #fff;
    border: none;
    border-radius: var(--r-sm, 4px);
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: opacity 0.15s ease;
  }
  .empty-cta:hover {
    opacity: 0.9;
  }
  .empty-cta:focus-visible {
    outline: 2px solid var(--brand, #1d63ed);
    outline-offset: 2px;
  }
  .empty-cta-secondary {
    padding: 8px 18px;
    background: transparent;
    color: var(--text-primary, #f1f5f9);
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.15));
    border-radius: var(--r-sm, 4px);
    cursor: pointer;
    font-size: 14px;
    transition: background 0.15s ease;
  }
  .empty-cta-secondary:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.06));
  }
  .empty-cta-secondary:focus-visible {
    outline: 2px solid var(--border-strong, rgba(255, 255, 255, 0.15));
    outline-offset: 2px;
  }
</style>
