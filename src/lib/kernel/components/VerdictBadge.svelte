<!--
  SPDX-License-Identifier: AGPL-3.0-or-later
  Copyright (C) 2026 EvoRule Project
  VerdictBadge — 确定性边界徽标组件 (D.3.1)

  依据: 设计文档/00_架构边界原则.md §六 (确定性边界)
        实施文档_界面升级_v1.0.md §D.3.1
        设计文档/01_界面升级.txt §一 (硬朗工业风设计令牌)

  职责:
    用 kind prop 区分 3 类确定性边界,在 UI 上明确标注每个信号来自
    evorule 确定性层 还是 应用层判定/推导,避免用户混淆边界。

  7 种 kind 分 3 类边界:
    - evorule 确定性信号:
        evorule-error  ⚠️ 琥珀  evorule 引擎抛出的异常/错误
        chain-verified  🔗 绿    审计链完整性验证通过
        chain-broken    ❌ 红    审计链完整性验证失败
    - 应用层判定 (非 evorule 确定性):
        verdict-pass    ✅ 绿    应用层判定为通过
        verdict-block   🚫 红    应用层判定为拦截
        verdict-none    — 灰    无判定/未匹配契约
    - 应用层推导:
        metric          📊 灰    应用层聚合指标 (不进审计链)

  Props:
    kind         必填,7 种之一
    value?       徽标文本 (compact=false 时显示)
    showBoundary hover 时是否显示边界标注 tooltip (默认 true)
    compact?     紧凑模式,仅图标无文本 (默认 false)
-->
<script lang="ts">
  interface Props {
    kind:
      | 'evorule-error'
      | 'verdict-pass'
      | 'verdict-block'
      | 'verdict-none'
      | 'chain-verified'
      | 'chain-broken'
      | 'metric';
    value?: string;
    showBoundary?: boolean;
    compact?: boolean;
  }

  let { kind, value, showBoundary = true, compact = false }: Props = $props();

  // 各 kind 的视觉配置: 图标 / 默认文本 / 边界标注
  const KIND_CONFIG: Record<
    Props['kind'],
    { icon: string; defaultText: string; boundary: string; tone: string }
  > = {
    'evorule-error': {
      icon: '⚠',
      defaultText: 'evorule 错误',
      boundary: 'evorule 确定性信号',
      tone: 'warning'
    },
    'chain-verified': {
      icon: '🔗',
      defaultText: '链完整',
      boundary: 'evorule 确定性信号',
      tone: 'success'
    },
    'chain-broken': {
      icon: '✗',
      defaultText: '链断裂',
      boundary: 'evorule 确定性信号',
      tone: 'danger'
    },
    'verdict-pass': {
      icon: '✓',
      defaultText: '通过',
      boundary: '应用层判定(非 evorule 确定性)',
      tone: 'success'
    },
    'verdict-block': {
      icon: '⨯',
      defaultText: '拦截',
      boundary: '应用层判定(非 evorule 确定性)',
      tone: 'danger'
    },
    'verdict-none': {
      icon: '—',
      defaultText: '无判定',
      boundary: '应用层判定(非 evorule 确定性)',
      tone: 'neutral'
    },
    metric: {
      icon: '▣',
      defaultText: '指标',
      boundary: '应用层推导(不进审计链)',
      tone: 'neutral'
    }
  };

  let config = $derived(KIND_CONFIG[kind]);
  let displayText = $derived(value ?? config.defaultText);
</script>

<div
  class="verdict-badge {config.tone}"
  class:compact
  role="img"
  aria-label="{config.boundary}: {displayText}"
>
  <span class="icon" aria-hidden="true">{config.icon}</span>
  {#if !compact}
    <span class="text">{displayText}</span>
  {/if}
  {#if showBoundary}
    <span class="boundary-tooltip">{config.boundary}</span>
  {/if}
</div>

<style>
  .verdict-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: 2px var(--spacing-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: 1.3;
    white-space: nowrap;
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .icon {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
  }

  .text {
    font-family: var(--font-mono);
  }

  /* compact 模式: 仅图标,方形 */
  .compact {
    padding: 2px 4px;
  }

  /* tone: 边框/前景色着色,背景保持卡片色 (硬朗风: 1px 边框区分,无填充阴影) */
  .success {
    border-color: var(--success);
    color: var(--success);
  }
  .danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .warning {
    border-color: var(--warning);
    color: var(--warning);
  }
  .neutral {
    border-color: var(--text-secondary);
    color: var(--text-secondary);
  }

  /* tooltip: hover / focus 显示边界标注 (硬朗风: 100ms 淡入) */
  .boundary-tooltip {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    padding: var(--spacing-xs) var(--spacing-sm);
    background: var(--text-primary);
    color: var(--bg-card);
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-normal);
    z-index: 10;
  }

  .boundary-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: var(--text-primary);
  }

  .verdict-badge:hover .boundary-tooltip,
  .verdict-badge:focus-visible .boundary-tooltip {
    opacity: 1;
  }

  .verdict-badge:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
