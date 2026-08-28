<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Region 5 — 8 个跳单页按钮
    网格布局,一键跳到常用视图/治理页
    登录限定项(发布队列/版本历史/审计记录/治理中心)未登录时禁用 + 提示
-->

<script lang="ts">
  interface JumpTarget {
    id: string;
    label: string;
    icon: string;
    path: string;
    /** 需要登录才能访问 */
    loginRequired: boolean;
  }

  const JUMP_TARGETS: JumpTarget[] = [
    { id: "rules", label: "规则库", icon: "📐", path: "/view/rules", loginRequired: false },
    { id: "execution", label: "执行台", icon: "▶", path: "/view/execution", loginRequired: false },
    { id: "state", label: "状态", icon: "📦", path: "/view/state", loginRequired: false },
    { id: "audit", label: "审计", icon: "🔍", path: "/view/audit", loginRequired: false },
    { id: "timetravel", label: "时间旅行", icon: "⏱", path: "/view/timetravel", loginRequired: false },
    { id: "export", label: "导出", icon: "📤", path: "/export", loginRequired: true },
    { id: "publish-queue", label: "发布队列", icon: "📥", path: "/publish-queue", loginRequired: true },
    { id: "governance", label: "治理中心", icon: "🗂️", path: "/governance", loginRequired: true },
  ];

  interface Props {
    loggedIn: boolean;
    onNav: (path: string, loginRequired: boolean) => void;
  }

  let { loggedIn, onNav }: Props = $props();
</script>

<div class="region-jump">
  <h2 class="region-title"><span class="icon">↗</span>快速跳单页</h2>
  <div class="jump-grid">
    {#each JUMP_TARGETS as target (target.id)}
      <button
        class="jump-btn"
        class:disabled={target.loginRequired && !loggedIn}
        onclick={() => onNav(target.path, target.loginRequired)}
        title={target.loginRequired && !loggedIn ? "需登录" : target.label}
      >
        <span class="icon">{target.icon}</span>
        <span>{target.label}</span>
        {#if target.loginRequired && !loggedIn}
          <span class="lock">🔒</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .region-jump {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .region-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .region-title .icon {
    font-size: 16px;
  }
  .jump-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .jump-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s, border-color 0.15s;
  }
  .jump-btn:hover:not(.disabled) {
    background: var(--primary-bg, rgba(29, 99, 237, 0.15));
    border-color: var(--primary, #2563eb);
  }
  .jump-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .jump-btn .icon {
    font-size: 18px;
  }
  .jump-btn .lock {
    margin-left: auto;
    font-size: 11px;
  }
  @media (max-width: 1024px) {
    .jump-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
