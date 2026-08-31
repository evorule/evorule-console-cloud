<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:顶部用户菜单(头像/角色徽标 + 个人中心 + 改密码 + 登出)UV-017 W3
  - platform 登录:显示服务端资料/权限点数,支持本人改密码(需旧密码)
  - demo 登录:保留 我的工作台/看 demo 入口
  依赖:auth.ts / platform-auth-api / session.ts / home-mode.ts / toast.ts
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    currentUser,
    logout,
    displayName,
    roleLabel,
    refreshCurrentUser,
  } from '$lib/stores/auth';
  import { forceDemo, autoMode } from '$lib/stores/home-mode';
  import { toastSuccess, toastError } from '$lib/stores/toast';
  import { logActivity } from '$lib/stores/activity-log';
  import { netConfig } from '$lib/config/net-config';
  import { platformChangePassword, PlatformAuthError } from '$lib/backend/platform-auth-api';

  let open = $state(false);
  // 改密码表单(platform 身份)
  let showChangePw = $state(false);
  let oldPw = $state('');
  let newPw = $state('');
  let confirmPw = $state('');
  let pwBusy = $state(false);

  function toggleMenu(): void {
    open = !open;
    if (!open) {
      showChangePw = false;
      oldPw = newPw = confirmPw = '';
    }
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

  async function handleChangePw(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const u = $currentUser;
    if (!u || pwBusy) return;
    if (newPw.length < 8) {
      toastError('新密码长度至少 8 位', '密码不合规');
      return;
    }
    if (newPw !== confirmPw) {
      toastError('两次输入的新密码不一致', '密码不合规');
      return;
    }
    pwBusy = true;
    try {
      await platformChangePassword(
        $netConfig.remoteBaseUrl,
        $netConfig.authToken,
        oldPw,
        newPw
      );
      toastSuccess('密码已更新,下次登录请使用新密码', '修改成功');
      logActivity({
        userId: u.id,
        username: u.displayName,
        action: 'login',
        detail: '修改平台密码',
      });
      showChangePw = false;
      oldPw = newPw = confirmPw = '';
      // 改密不影响当前会话;强制刷新一次资料(节流旁路)
      void refreshCurrentUser(true);
    } catch (err) {
      const msg = err instanceof PlatformAuthError ? err.message : (err as Error).message;
      toastError(msg, '修改密码失败');
    } finally {
      pwBusy = false;
    }
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
        <!-- 个人资料 -->
        <div class="profile-section">
          <div class="profile-row"><span class="k">账号</span><span class="v">{$currentUser.username}</span></div>
          {#if $currentUser.email}
            <div class="profile-row"><span class="k">邮箱</span><span class="v">{$currentUser.email}</span></div>
          {/if}
          {#if $currentUser.department}
            <div class="profile-row"><span class="k">部门</span><span class="v">{$currentUser.department}</span></div>
          {/if}
          <div class="profile-row">
            <span class="k">角色</span><span class="v">{$roleLabel}</span>
          </div>
          {#if $currentUser.authKind === 'platform'}
            <div class="profile-row">
              <span class="k">权限点</span>
              <span class="v">{$currentUser.permissions?.length ?? 0} 项(服务端下发)</span>
            </div>
          {/if}
        </div>

        {#if $currentUser.authKind === 'platform'}
          {#if showChangePw}
            <form class="pw-form" onsubmit={handleChangePw}>
              <input type="password" bind:value={oldPw} placeholder="当前密码" autocomplete="current-password" required />
              <input type="password" bind:value={newPw} placeholder="新密码(至少 8 位)" minlength={8} autocomplete="new-password" required />
              <input type="password" bind:value={confirmPw} placeholder="确认新密码" autocomplete="new-password" required />
              <div class="pw-actions">
                <button class="menu-item" type="submit" disabled={pwBusy}>
                  {pwBusy ? '提交中…' : '保存新密码'}
                </button>
                <button class="menu-item" type="button" onclick={() => (showChangePw = false)}>
                  取消
                </button>
              </div>
            </form>
          {:else}
            <button class="menu-item" onclick={() => (showChangePw = true)} role="menuitem">
              🔑 修改密码
            </button>
          {/if}
        {:else}
          <button class="menu-item" onclick={handleBackToWorkbench} role="menuitem">
            💼 我的工作台
          </button>
          <button class="menu-item" onclick={handleForceDemo} role="menuitem">
            📋 看 demo
          </button>
        {/if}
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
    border: 1px solid var(--text-primary, #334155);
    border-radius: var(--radius-md, 6px);
    cursor: pointer;
    color: var(--border, #e2e8f0);
    transition: background 0.15s ease;
  }
  .user-trigger:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--brand, #2563eb);
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
    color: var(--text-secondary, #94a3b8);
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
    min-width: 240px;
    background: var(--bg-card);
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px;
    box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
    z-index: 100;
    overflow: hidden;
  }
  .profile-section {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border, #e2e8f0);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .profile-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    line-height: 1.5;
  }
  .profile-row .k {
    color: var(--text-secondary, #94a3b8);
    flex-shrink: 0;
  }
  .profile-row .v {
    color: var(--text-primary, #1e293b);
    word-break: break-all;
    text-align: right;
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
    color: var(--text-primary, #1e293b);
    transition: background 0.1s ease;
  }
  .menu-item:hover {
    background: var(--bg-page, #f8fafc);
  }
  .menu-danger {
    color: var(--danger, #dc2626);
  }
  .menu-divider {
    height: 1px;
    background: var(--border, #e2e8f0);
    margin: 4px 0;
  }
  .pw-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }
  .pw-form input {
    padding: 8px 10px;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 4px;
    background: var(--bg-page, #f8fafc);
    color: var(--text-primary, #1e293b);
    font-size: 13px;
  }
  .pw-form input:focus {
    outline: none;
    border-color: var(--brand, #2563eb);
  }
  .pw-actions {
    display: flex;
    gap: 8px;
  }
  .pw-actions .menu-item {
    flex: 1;
    padding: 8px 10px;
    text-align: center;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 4px;
  }
  .login-btn {
    padding: 6px 14px;
    background: var(--brand, #2563eb);
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
