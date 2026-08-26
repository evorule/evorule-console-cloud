<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 EvoRule Project -->
<!--
  职责:5 预置用户卡片选择(mock 登录,P0 不输密码)
  依赖:auth.ts (loginAs) / permission-matrix.ts (ROLE_LABELS) / toast.ts
  关联设计:P08_COLLAB_WORKFLOW_DESIGN.md §7.1(LoginForm)
-->

<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    BUILTIN_USERS,
    loginAs,
    logout,
  } from '$lib/stores/auth';
  import { ROLE_LABELS } from '$lib/stores/permission-matrix';
  import { toastSuccess, toastError } from '$lib/stores/toast';
  import { logActivity } from '$lib/stores/activity-log';
  import { autoMode } from '$lib/stores/home-mode';

  let selectedUser = $state<string>('');

  function handleLogin(username: string): void {
    const result = loginAs(username);
    if (result.success) {
      const user = BUILTIN_USERS.find((u) => u.username === username);
      toastSuccess(`已登录为 ${user?.displayName ?? username}`, '登录成功');
      logActivity({
        userId: user?.id ?? '',
        username: user?.displayName ?? username,
        action: 'login',
        detail: `角色:${ROLE_LABELS[user?.role ?? 'user']}`,
      });
      autoMode();
      goto('/');
    } else {
      toastError(result.error ?? '登录失败', '登录失败');
    }
  }

  function handleLogout(): void {
    logout();
    toastSuccess('已登出', '再见');
  }
</script>

<section class="login-page">
  <header class="login-header">
    <h1>🔐 登录 evorule</h1>
    <p>P0 demo:选择预置角色登录(不校验密码)</p>
  </header>

  <div class="user-grid">
    {#each BUILTIN_USERS as user (user.id)}
      <button
        class="user-card"
        class:selected={selectedUser === user.username}
        onclick={() => (selectedUser = user.username)}
        aria-pressed={selectedUser === user.username}
      >
        <div class="user-avatar">{user.displayName.charAt(0)}</div>
        <div class="user-info">
          <span class="user-name">{user.displayName}</span>
          <span class="user-role">{ROLE_LABELS[user.role]}</span>
          <span class="user-dept">{user.department ?? '未分配科室'}</span>
        </div>
      </button>
    {/each}
  </div>

  <div class="login-actions">
    <button
      class="btn btn-primary"
      disabled={!selectedUser}
      onclick={() => selectedUser && handleLogin(selectedUser)}
    >
      登录 →
    </button>
    <button class="btn btn-ghost" onclick={handleLogout}>登出</button>
  </div>

  <div class="role-hint">
    <p>💡 5 角色:普通用户(编辑 Draft)/ 科室主任(审核+提交)/ 信息科(干预+审批+回滚)/ 院领导(同信息科)/ 审计员(只读审计链)</p>
  </div>
</section>

<style>
  .login-page {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .login-header {
    text-align: center;
  }
  .login-header h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px 0;
    color: var(--color-primary, #2563eb);
  }
  .login-header p {
    font-size: 14px;
    color: var(--color-text-secondary, #64748b);
    margin: 0;
  }
  .user-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .user-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    background: var(--bg-card);
    border: 2px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }
  .user-card:hover {
    border-color: var(--color-primary, #2563eb);
  }
  .user-card.selected {
    border-color: var(--color-primary, #2563eb);
    background: var(--color-info-bg, #eff6ff);
  }
  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--color-primary, #2563eb);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .user-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .user-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-primary, #1e293b);
  }
  .user-role {
    font-size: 13px;
    color: var(--color-primary, #2563eb);
  }
  .user-dept {
    font-size: 12px;
    color: var(--color-text-secondary, #64748b);
  }
  .login-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .btn {
    padding: 10px 24px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    transition: all 0.15s ease;
  }
  .btn-primary {
    background: var(--color-primary, #2563eb);
    color: white;
  }
  .btn-primary:disabled {
    background: var(--color-gray-300, #cbd5e1);
    cursor: not-allowed;
  }
  .btn-primary:not(:disabled):hover {
    opacity: 0.9;
  }
  .btn-ghost {
    background: transparent;
    color: var(--color-text-secondary, #64748b);
    border: 1px solid var(--color-gray-300, #cbd5e1);
  }
  .btn-ghost:hover {
    background: var(--color-gray-50, #f8fafc);
  }
  .role-hint {
    padding: 12px 16px;
    background: var(--color-info-bg, #eff6ff);
    border-radius: 6px;
    font-size: 13px;
    color: var(--color-text-secondary, #64748b);
    line-height: 1.6;
  }
</style>
