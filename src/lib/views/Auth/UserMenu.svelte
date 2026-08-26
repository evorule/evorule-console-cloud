<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:顶部用户菜单(头像/角色徽标 + 登出 + 切换 demo)
  依赖:auth.ts / session.ts / home-mode.ts / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.2(UserMenu)
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import { currentUser, logout, displayName, roleLabel } from '$lib/stores/auth';
  import { forceDemo, autoMode } from '$lib/stores/home-mode';
  import { toastSuccess } from '$lib/stores/toast';
  import { logActivity } from '$lib/stores/activity-log';

  let open = $state(false);

  function toggleMenu(): void {
    open = !open;
  }

  function handleLogout(): void {
    const u = $currentUser;
    if (u) {
      logActivity({
        userId: u.id,
        username: u.displayName,
        action: 'logout',
      });
    }
    logout();
    open = false;
    toastSuccess('已登出', '再见');
    goto('/');
  }

  function handleForceDemo(): void {
    open = false;
    forceDemo();
    toastSuccess('已切换到 demo 模式', '查看演示');
    goto('/');
  }

  function handleBackToWorkbench(): void {
    open = false;
    autoMode();
    goto('/');
  }
</script>

{#if $currentUser}
  <div class="user-menu">
    <button
      class="user-trigger"
      onclick={toggleMenu}
      aria-expanded={open}
      aria-label="用户菜单"
    >
      <span class="user-avatar">{$displayName.charAt(0)}</span>
      <span class="user-meta">
        <span class="user-name">{$displayName}</span>
        <span class="user-role">{$roleLabel}</span>
      </span>
      <span class="caret" class:open>▾</span>
    </button>

    {#if open}
      <div class="menu-dropdown" role="menu">
        <button class="menu-item" onclick={handleBackToWorkbench} role="menuitem">
          💼 我的工作台
        </button>
        <button class="menu-item" onclick={handleForceDemo} role="menuitem">
          📋 看 demo
        </button>
        <div class="menu-divider"></div>
        <button class="menu-item menu-danger" onclick={handleLogout} role="menuitem">
          🚪 登出
        </button>
      </div>
    {/if}
  </div>
{:else}
  <button class="login-btn" onclick={() => goto('/login')}>
    🔐 登录
  </button>
{/if}

<style>
  .user-menu {
    position: relative;
  }
  .user-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--color-gray-700, #334155);
    border-radius: var(--radius-md, 6px);
    cursor: pointer;
    color: var(--color-gray-200, #e2e8f0);
    transition: background 0.15s ease;
  }
  .user-trigger:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-primary, #2563eb);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
  }
  .user-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.2;
  }
  .user-name {
    font-size: 13px;
    font-weight: 600;
  }
  .user-role {
    font-size: 11px;
    color: var(--color-gray-400, #94a3b8);
  }
  .caret {
    font-size: 10px;
    transition: transform 0.15s ease;
  }
  .caret.open {
    transform: rotate(180deg);
  }
  .menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 180px;
    background: var(--bg-card);
    border: 1px solid var(--color-gray-200, #e2e8f0);
    border-radius: 6px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
    z-index: 100;
    overflow: hidden;
  }
  .menu-item {
    display: block;
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    color: var(--color-text-primary, #1e293b);
    transition: background 0.1s ease;
  }
  .menu-item:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .menu-danger {
    color: var(--color-error, #dc2626);
  }
  .menu-divider {
    height: 1px;
    background: var(--color-gray-200, #e2e8f0);
    margin: 4px 0;
  }
  .login-btn {
    padding: 6px 14px;
    background: var(--color-primary, #2563eb);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .login-btn:hover {
    opacity: 0.9;
  }
</style>
