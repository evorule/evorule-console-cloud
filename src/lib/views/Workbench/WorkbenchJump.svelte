<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  Region 5 — 9 个跳单页按钮
    网格布局,一键跳到常用视图/治理页
    登录限定项(发布队列/治理中心)未登录时禁用 + 提示
    UV-014 导航发现性:补「市场」入口(此前全局无任何入口指向 /marketplace);
    「审计」(本地链,免登录)与「治理中心」(治理角色登录)title 澄清语义
-->

<script lang="ts">
  interface JumpTarget {
    id: string;
    label: string;
    icon: string;
    path: string;
    /** 需要登录才能访问 */
    loginRequired: boolean;
    /** 未登录时的锁定原因说明(UV-014 前置引导) */
    lockHint?: string;
  }

  const JUMP_TARGETS: JumpTarget[] = [
    { id: "rules", label: "规则库", icon: "📐", path: "/view/rules", loginRequired: false },
    { id: "execution", label: "执行台", icon: "▶", path: "/view/execution", loginRequired: false },
    { id: "state", label: "状态", icon: "📦", path: "/view/state", loginRequired: false },
    { id: "audit", label: "审计", icon: "🔍", path: "/view/audit", loginRequired: false },
    { id: "timetravel", label: "时间旅行", icon: "⏱", path: "/view/timetravel", loginRequired: false },
    { id: "marketplace", label: "市场", icon: "🛒", path: "/marketplace", loginRequired: false },
    { id: "export", label: "导出", icon: "📤", path: "/export", loginRequired: true },
    { id: "publish-queue", label: "发布队列", icon: "📥", path: "/publish-queue", loginRequired: true },
    { id: "governance", label: "治理中心", icon: "🗂️", path: "/governance", loginRequired: true },
  ];

  interface Props {
    loggedIn: boolean;
    onNav: (path: string, loginRequired: boolean) => void;
  }

  let { loggedIn, onNav }: Props = $props();

  /** 悬停说明:语义澄清 + 未登录锁定前置引导(UV-014) */
  function hintOf(t: JumpTarget, loggedIn: boolean): string {
    if (t.loginRequired && !loggedIn) return t.lockHint || "需登录";
    switch (t.id) {
      case "audit":
        return "审计链与因果链(本地,免登录);治理侧完整审计员工作台见「治理中心」";
      case "governance":
        return "治理中心 — 需治理角色登录(admin/approver 等,演示凭据见启动说明)";
      case "publish-queue":
        return "发布队列 — 需登录并具备发布队列查看权限";
      case "marketplace":
        return "模板市场 — 官方规则集(等保 2.0 等)一键导入";
      default:
        return t.label;
    }
  }
</script>

<div class="region-jump">
  <h2 class="region-title"><span class="icon">↗</span>快速跳单页</h2>
  <div class="jump-grid">
    {#each JUMP_TARGETS as target (target.id)}
      <button
        class="jump-btn"
        class:disabled={target.loginRequired && !loggedIn}
        onclick={() => onNav(target.path, target.loginRequired)}
        title={hintOf(target, loggedIn)}
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
